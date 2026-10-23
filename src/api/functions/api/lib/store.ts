/**
 * Reglas del negocio compartidas por todas las rutas:
 * ajustes de la tienda, imágenes, stock, sesiones y formato de salida.
 */
import { asJson, type Db, intArray, one, toHex } from "./db.ts";
import { fail, type User } from "./http.ts";
import { randomHex, sha256 } from "./security.ts";
import { round2 } from "./validate.ts";

export const TAX_RATE = 0.15; // ISV Honduras
export const SESSION_DAYS = 14;
export const PAYMENT_METHODS = ["efectivo", "transferencia"] as const;
export const INQUIRY_TYPES = ["interes", "ayuda", "reporte"] as const;

// ─── Ajustes ────────────────────────────────────────────────────────

export type Bank = { bank: string; account: string; holder: string };
export type Settings = {
  storeName: string;
  whatsapp: string;
  riderFee: number;
  lowStock: number;
  categories: string[];
  banks: Bank[];
};

export const DEFAULT_SETTINGS: Record<string, string> = {
  store_name: "Tecnocore",
  whatsapp: "50493893595",
  rider_fee: "80",
  low_stock: "3",
  categories: JSON.stringify([
    "CPU", "GPU", "RAM", "Almacenamiento", "Fuente",
    "Placa madre", "Gabinete", "Refrigeración", "Periféricos", "Otros",
  ]),
  banks: JSON.stringify([
    { bank: "BAC Credomatic", account: "", holder: "" },
    { bank: "Banco Atlántida", account: "", holder: "" },
    { bank: "Ficohsa", account: "", holder: "" },
  ]),
};

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.query<{ k: string; v: string }>("SELECT k, v FROM tc.settings");
  const raw = { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.k, r.v])) };
  return {
    storeName: raw.store_name,
    whatsapp: raw.whatsapp,
    riderFee: Number(raw.rider_fee) || 0,
    lowStock: Number(raw.low_stock) || 0,
    categories: asJson<string[]>(raw.categories, []),
    banks: asJson<Bank[]>(raw.banks, []),
  };
}

export async function saveSetting(db: Db, k: string, v: string): Promise<void> {
  await db.query("INSERT INTO tc.settings (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v", [k, v]);
}

// ─── Imágenes ───────────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
export const imagePath = (id: string) => `/api/images/${id}`;

/** Valida un data URL (JPG, PNG o WEBP) revisando también los bytes reales del archivo. */
export function decodeImage(dataUrl: unknown): { mime: string; bytes: Uint8Array } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? "").replace(/\s/g, ""));
  if (!m) fail(400, "La imagen no es válida. Usá JPG, PNG o WEBP");
  const binary = atob(m[2]);
  if (binary.length > MAX_IMAGE_BYTES) fail(413, "La imagen es muy pesada");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isWebp = String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  const valid = (m[1] === "image/jpeg" && isJpeg) || (m[1] === "image/png" && isPng) || (m[1] === "image/webp" && isWebp);
  if (!valid) fail(400, "El archivo no es una imagen válida");
  return { mime: m[1], bytes };
}

export async function saveImage(db: Db, dataUrl: unknown, isPrivate: boolean): Promise<string> {
  const { mime, bytes } = decodeImage(dataUrl);
  const id = randomHex(16);
  await db.query("INSERT INTO tc.images (id, mime, data, is_private) VALUES ($1, $2, decode($3, 'hex'), $4)", [
    id, mime, toHex(bytes), isPrivate,
  ]);
  return id;
}

/** Borra una imagen si ya ningún producto ni venta la usa. */
export async function deleteImageIfOrphan(db: Db, imageId: string | null): Promise<void> {
  if (!imageId) return;
  await db.query(
    `DELETE FROM tc.images i WHERE i.id = $1
       AND NOT EXISTS (SELECT 1 FROM tc.products WHERE image_id = $1)
       AND NOT EXISTS (SELECT 1 FROM tc.sales WHERE receipt_image_id = $1)`,
    [imageId],
  );
}

// ─── Stock ──────────────────────────────────────────────────────────

export type LineItem = { productId: number | null; name: string; qty: number; unitPrice: number; lineTotal: number };

export function effectivePrice(p: { price?: unknown; offer_price?: unknown }): number {
  const price = Number(p.price);
  const offer = p.offer_price == null ? null : Number(p.offer_price);
  return offer != null && offer > 0 && offer < price ? offer : price;
}

/**
 * Arma las líneas de una venta o pedido con los precios actuales del catálogo
 * (el cliente nunca decide el precio).
 */
export async function priceItems(db: Db, requested: unknown, maxQty: number): Promise<{ items: LineItem[]; subtotal: number }> {
  const list = Array.isArray(requested) ? requested : [];
  if (list.length === 0) fail(400, "Agregá al menos un producto");
  if (list.length > 40) fail(400, "Demasiados productos en una sola orden");

  const ids = list.map((it: any) => Number(it?.productId));
  if (ids.some((id) => !Number.isInteger(id) || id < 1)) fail(400, "Hay un producto no válido");
  const rows = await db.query("SELECT * FROM tc.products WHERE id = ANY($1::int[]) AND active", [intArray(ids)]);
  const byId = new Map(rows.map((p) => [Number(p.id), p]));

  const merged = new Map<number, number>();
  for (const it of list as any[]) {
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > maxQty) fail(400, "La cantidad no es válida");
    merged.set(Number(it.productId), (merged.get(Number(it.productId)) ?? 0) + qty);
  }

  const items: LineItem[] = [];
  for (const [id, qty] of merged) {
    const p = byId.get(id);
    if (!p) fail(409, "Uno de los productos ya no está disponible");
    if (Number(p.stock) < qty) fail(409, `No hay suficiente stock de ${p.name} (quedan ${p.stock})`);
    const unitPrice = effectivePrice(p);
    items.push({ productId: id, name: p.name, qty, unitPrice, lineTotal: round2(unitPrice * qty) });
  }
  return { items, subtotal: round2(items.reduce((s, it) => s + it.lineTotal, 0)) };
}

/** Bloquea los productos, verifica stock y lo descuenta (usar dentro de una transacción). */
export async function takeStock(db: Db, items: LineItem[]): Promise<void> {
  const ids = items.map((it) => it.productId).filter((id): id is number => Boolean(id));
  if (ids.length === 0) return;
  const rows = await db.query("SELECT id, name, stock FROM tc.products WHERE id = ANY($1::int[]) FOR UPDATE", [intArray(ids)]);
  const byId = new Map(rows.map((p) => [Number(p.id), p]));
  for (const it of items) {
    if (!it.productId) continue;
    const p = byId.get(it.productId);
    if (!p) fail(409, `${it.name} ya no existe en el catálogo`);
    if (Number(p.stock) < it.qty) fail(409, `Stock insuficiente de ${p.name} (quedan ${p.stock})`);
  }
  for (const it of items) {
    if (it.productId) await db.query("UPDATE tc.products SET stock = stock - $1 WHERE id = $2", [it.qty, it.productId]);
  }
}

export async function returnStock(db: Db, items: LineItem[]): Promise<void> {
  for (const it of items) {
    if (it.productId) await db.query("UPDATE tc.products SET stock = stock + $1 WHERE id = $2", [it.qty, it.productId]);
  }
}

// ─── Sesiones ───────────────────────────────────────────────────────

export async function createSession(db: Db, userId: number): Promise<string> {
  const token = randomHex(32);
  await db.query(
    "INSERT INTO tc.sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))",
    [await sha256(token), userId, SESSION_DAYS],
  );
  return token;
}

/** El token llega en "X-Session-Token" (o "Authorization: Bearer" como alternativa). */
export function sessionToken(req: Request): string | null {
  const header = req.headers.get("x-session-token") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const token = header.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export async function userFromRequest(db: Db, req: Request): Promise<User | null> {
  const token = sessionToken(req);
  if (!token) return null;
  return one<User>(
    db,
    `SELECT u.id, u.role, u.username, u.name, u.phone, u.active, u.available
     FROM tc.sessions s JOIN tc.users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
    [await sha256(token)],
  );
}

// ─── Formato de salida ──────────────────────────────────────────────

const num = (v: unknown) => (v == null ? null : Number(v));

export function serializeProduct(p: any) {
  return {
    id: Number(p.id),
    name: p.name,
    category: p.category,
    brand: p.brand,
    specs: p.specs,
    price: Number(p.price),
    offerPrice: num(p.offer_price),
    finalPrice: effectivePrice(p),
    stock: Number(p.stock),
    sku: p.sku,
    imageUrl: p.image_id ? imagePath(p.image_id) : p.image_url || null,
    imageId: p.image_id || null,
    externalImageUrl: p.image_id ? null : p.image_url || null,
    active: Boolean(p.active),
    views: Number(p.views),
  };
}

export const ORDER_SELECT = `
  SELECT o.*, r.name AS rider_name, r.phone AS rider_phone
  FROM tc.orders o LEFT JOIN tc.users r ON r.id = o.rider_id`;

export function serializeOrder(o: any) {
  return {
    id: Number(o.id),
    code: o.code,
    customer: { name: o.customer_name, phone: o.customer_phone },
    delivery: Boolean(o.delivery),
    address: o.address,
    paymentMethod: o.payment_method,
    notes: o.notes,
    items: asJson<LineItem[]>(o.items, []),
    total: Number(o.total),
    status: o.status,
    seen: Boolean(o.seen),
    saleId: num(o.sale_id),
    rider: o.rider_id ? { id: Number(o.rider_id), name: o.rider_name ?? "Rider", phone: o.rider_phone ?? "" } : null,
    riderStatus: o.rider_status,
    riderFee: num(o.rider_fee),
    createdAt: o.created_at,
    assignedAt: o.assigned_at,
    acceptedAt: o.accepted_at,
    pickedAt: o.picked_at,
    deliveredAt: o.delivered_at,
  };
}

export function serializeSale(s: any) {
  return {
    id: Number(s.id),
    channel: s.channel,
    seller: { id: num(s.seller_id), name: s.seller_name },
    items: asJson<LineItem[]>(s.items, []),
    subtotal: Number(s.subtotal),
    discount: Number(s.discount),
    tax: Number(s.tax),
    total: Number(s.total),
    paymentMethod: s.payment_method,
    bank: s.bank,
    cashReceived: num(s.cash_received),
    change: num(s.change_given),
    receiptUrl: s.receipt_image_id ? imagePath(s.receipt_image_id) : null,
    orderId: num(s.order_id),
    voided: Boolean(s.voided),
    createdAt: s.created_at,
  };
}

export function serializeInquiry(i: any) {
  return {
    id: Number(i.id),
    type: i.type,
    customer: { name: i.customer_name, phone: i.customer_phone },
    product: i.product_id || i.product_name ? { id: num(i.product_id), name: i.product_name } : null,
    orderCode: i.order_code,
    rider: i.rider_id ? { id: Number(i.rider_id), name: i.rider_name ?? "Rider", phone: i.rider_phone ?? "" } : null,
    message: i.message,
    status: i.status,
    createdAt: i.created_at,
  };
}

export function serializeUser(u: any) {
  return {
    id: Number(u.id),
    role: u.role,
    username: u.username,
    name: u.name,
    phone: u.phone,
    active: Boolean(u.active),
    available: Boolean(u.available),
    ...("password_hash" in u ? { hasPassword: Boolean(u.password_hash) } : {}),
  };
}
