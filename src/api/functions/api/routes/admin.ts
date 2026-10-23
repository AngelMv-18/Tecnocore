/**
 * Panel de administración.
 */
import { asJson, type Db, isUniqueViolation, one, START_OF, TZ } from "../lib/db.ts";
import { ADMIN, fail, type Router, type User } from "../lib/http.ts";
import { hashPassword } from "../lib/security.ts";
import {
  deleteImageIfOrphan, getSettings, INQUIRY_TYPES, type LineItem, ORDER_SELECT, returnStock, saveSetting,
  serializeInquiry, serializeOrder, serializeProduct, serializeSale, serializeUser, takeStock,
} from "../lib/store.ts";
import { check, round2 } from "../lib/validate.ts";

// ─── Productos ──────────────────────────────────────────────────────

async function readProductInput(db: Db, b: any) {
  const price = check.money(b.price, "El precio");
  const offerPrice = check.optionalMoney(b.offerPrice, "El precio de oferta");
  if (offerPrice != null && offerPrice >= price) fail(400, "La oferta tiene que ser menor al precio normal");

  const imageId = b.imageId ? check.imageId(b.imageId) : null;
  if (imageId && !(await one(db, "SELECT 1 FROM tc.images WHERE id = $1 AND NOT is_private", [imageId]))) {
    fail(400, "No se encontró la foto, volvé a subirla");
  }
  // Un link externo solo se usa cuando no hay una foto subida.
  const imageUrl = imageId ? "" : check.text(b.imageUrl, "El link de la foto", { max: 500, optional: true });
  if (imageUrl && !/^https:\/\//i.test(imageUrl)) fail(400, "El link de la foto tiene que empezar con https://");

  return {
    name: check.text(b.name, "El nombre", { max: 120 }),
    category: check.text(b.category, "La categoría", { max: 40 }),
    brand: check.text(b.brand, "La marca", { max: 60, optional: true }),
    specs: check.text(b.specs, "Las especificaciones", { max: 500, optional: true }),
    price,
    offerPrice,
    stock: check.int(b.stock, "El stock", { min: 0, max: 100_000 }),
    sku: check.text(b.sku, "El SKU", { max: 40, optional: true }),
    imageId,
    imageUrl: imageUrl || null,
    active: b.active === undefined ? true : check.bool(b.active),
  };
}

// ─── Pedidos ────────────────────────────────────────────────────────

type OrderAction = (db: Db, order: any, admin: User, body: any) => Promise<void>;

const ORDER_ACTIONS: Record<string, OrderAction> = {
  async seen(db, order) {
    await db.query("UPDATE tc.orders SET seen = true WHERE id = $1", [order.id]);
  },

  /** Concretar la venta: descuenta el stock y registra la venta en línea. */
  async confirm(db, order, admin) {
    if (order.status !== "nuevo") fail(409, "Este pedido ya fue procesado");
    const items = asJson<LineItem[]>(order.items, []);
    await takeStock(db, items);
    const total = Number(order.total);
    const sale = await one(
      db,
      `INSERT INTO tc.sales (channel, seller_id, seller_name, items, subtotal, total, payment_method, order_id)
       VALUES ('online', $1, $2, $3::text::jsonb, $4, $4, $5, $6) RETURNING id`,
      [admin.id, admin.name, JSON.stringify(items), total, order.payment_method, order.id],
    );
    await db.query("UPDATE tc.orders SET status = 'confirmado', sale_id = $1, seen = true WHERE id = $2", [sale!.id, order.id]);
  },

  async cancel(db, order) {
    if (!["nuevo", "confirmado"].includes(order.status)) fail(409, "Este pedido ya no se puede cancelar");
    if (order.rider_status === "recogido") fail(409, "El rider ya recogió este pedido");
    if (order.status === "confirmado") {
      await returnStock(db, asJson<LineItem[]>(order.items, []));
      if (order.sale_id) await db.query("UPDATE tc.sales SET voided = true WHERE id = $1", [order.sale_id]);
    }
    await db.query(
      "UPDATE tc.orders SET status = 'cancelado', rider_id = NULL, rider_status = NULL, seen = true WHERE id = $1",
      [order.id],
    );
  },

  async assign(db, order, _admin, b) {
    if (!order.delivery) fail(409, "Este pedido es para retirar en la tienda");
    if (order.status !== "confirmado") fail(409, "Primero concretá la venta del pedido");
    if (order.rider_status && order.rider_status !== "asignado") fail(409, "El rider ya está trabajando en este pedido");
    const riderId = check.int(b.riderId, "El rider", { min: 1 });
    const rider = await one(db, "SELECT id FROM tc.users WHERE id = $1 AND role = 'rider' AND active", [riderId]);
    if (!rider) fail(404, "Rider no encontrado");
    await db.query(
      "UPDATE tc.orders SET rider_id = $1, rider_status = 'asignado', assigned_at = now(), accepted_at = NULL WHERE id = $2",
      [riderId, order.id],
    );
  },

  async unassign(db, order) {
    if (order.rider_status === "recogido" || order.rider_status === "entregado") fail(409, "El pedido ya salió con el rider");
    await db.query("UPDATE tc.orders SET rider_id = NULL, rider_status = NULL WHERE id = $1", [order.id]);
  },

  /** Cierre manual: retiro en tienda, o entrega que el rider no marcó. */
  async deliver(db, order) {
    if (!["confirmado", "en_camino"].includes(order.status)) fail(409, "Primero concretá la venta del pedido");
    const { riderFee } = await getSettings(db);
    await db.query(
      `UPDATE tc.orders SET status = 'entregado', delivered_at = now(),
              rider_status = CASE WHEN rider_id IS NULL THEN rider_status ELSE 'entregado' END,
              rider_fee    = CASE WHEN rider_id IS NULL THEN rider_fee ELSE $1 END
       WHERE id = $2`,
      [riderFee, order.id],
    );
  },
};

// ─── Rutas ──────────────────────────────────────────────────────────

export function adminRoutes(router: Router): void {
  /** Contadores livianos para las notificaciones del panel (se consulta cada pocos segundos). */
  router.on("GET", "/api/admin/summary", ADMIN, async ({ db }) => {
    return one(
      db,
      `SELECT
         (SELECT count(*)::int FROM tc.orders WHERE status = 'nuevo') AS "newOrders",
         (SELECT count(*)::int FROM tc.orders WHERE status = 'nuevo' AND NOT seen) AS "unseenOrders",
         (SELECT count(*)::int FROM tc.inquiries WHERE status = 'nuevo') AS "openInquiries",
         (SELECT count(*)::int FROM tc.orders WHERE delivery AND status = 'confirmado' AND rider_id IS NULL) AS "unassignedDeliveries",
         (SELECT coalesce(max(id), 0)::int FROM tc.orders) AS "lastOrderId",
         (SELECT coalesce(max(id), 0)::int FROM tc.inquiries) AS "lastInquiryId"`,
    );
  });

  router.on("GET", "/api/admin/dashboard", ADMIN, async ({ db }) => {
    const settings = await getSettings(db);
    const totalsSince = (since: string) =>
      one(db, `SELECT count(*)::int AS count, coalesce(sum(total), 0)::float8 AS total FROM tc.sales WHERE NOT voided AND created_at >= ${since}`);

    const [today, month, byMethod, bySeller, series, lowStock, recentSales, topProducts, interested, viewed, counts] = await Promise.all([
      totalsSince(START_OF.day),
      totalsSince(START_OF.month),
      db.query(`SELECT payment_method AS method, count(*)::int AS count, sum(total)::float8 AS total
                FROM tc.sales WHERE NOT voided AND created_at >= ${START_OF.day} GROUP BY payment_method`),
      db.query(`SELECT seller_name AS name, count(*)::int AS count, sum(total)::float8 AS total
                FROM tc.sales WHERE NOT voided AND created_at >= ${START_OF.day} GROUP BY seller_name ORDER BY 3 DESC`),
      db.query(`SELECT to_char(d.day, 'YYYY-MM-DD') AS day, count(s.id)::int AS count, coalesce(sum(s.total), 0)::float8 AS total
                FROM generate_series((now() AT TIME ZONE '${TZ}')::date - 6, (now() AT TIME ZONE '${TZ}')::date, interval '1 day') AS d(day)
                LEFT JOIN tc.sales s ON NOT s.voided AND (s.created_at AT TIME ZONE '${TZ}')::date = d.day::date
                GROUP BY d.day ORDER BY d.day`),
      db.query("SELECT * FROM tc.products WHERE active AND stock <= $1 ORDER BY stock, name LIMIT 8", [settings.lowStock]),
      db.query("SELECT * FROM tc.sales WHERE NOT voided ORDER BY id DESC LIMIT 6"),
      db.query(`SELECT it->>'name' AS name, sum((it->>'qty')::int)::int AS qty, sum((it->>'lineTotal')::numeric)::float8 AS revenue
                FROM tc.sales s, jsonb_array_elements(s.items) AS it
                WHERE NOT s.voided AND s.created_at >= now() - interval '30 days'
                GROUP BY 1 ORDER BY 2 DESC LIMIT 5`),
      db.query(`SELECT product_id AS id, product_name AS name, count(*)::int AS count FROM tc.inquiries
                WHERE type = 'interes' AND created_at >= now() - interval '30 days'
                GROUP BY product_id, product_name ORDER BY 3 DESC LIMIT 5`),
      db.query("SELECT id, name, views FROM tc.products WHERE views > 0 ORDER BY views DESC LIMIT 5"),
      one(db, `SELECT
                 (SELECT count(*)::int FROM tc.orders WHERE status = 'nuevo') AS "newOrders",
                 (SELECT count(*)::int FROM tc.orders WHERE status IN ('confirmado', 'en_camino')) AS "activeOrders",
                 (SELECT count(*)::int FROM tc.inquiries WHERE status = 'nuevo') AS "openInquiries",
                 (SELECT count(*)::int FROM tc.users WHERE role = 'rider' AND active AND available) AS "ridersAvailable"`),
    ]);

    return {
      today,
      month,
      todayByMethod: byMethod,
      todayBySeller: bySeller,
      last7: series,
      lowStock: lowStock.map(serializeProduct),
      recentSales: recentSales.map(serializeSale),
      topProducts,
      mostInterested: interested,
      mostViewed: viewed.map((p) => ({ id: Number(p.id), name: p.name, views: Number(p.views) })),
      counts,
      lowStockThreshold: settings.lowStock,
    };
  });

  // Productos
  router.on("GET", "/api/admin/products", ADMIN, async ({ db }) => {
    const rows = await db.query("SELECT * FROM tc.products ORDER BY active DESC, category, name");
    return { products: rows.map(serializeProduct) };
  });

  router.on("POST", "/api/admin/products", ADMIN, async ({ db, body }) => {
    const p = await readProductInput(db, await body());
    const row = await one(
      db,
      `INSERT INTO tc.products (name, category, brand, specs, price, offer_price, stock, sku, image_id, image_url, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [p.name, p.category, p.brand, p.specs, p.price, p.offerPrice, p.stock, p.sku || `SKU-${Date.now().toString().slice(-6)}`,
        p.imageId, p.imageUrl, p.active],
    );
    return { product: serializeProduct(row) };
  });

  router.on("PUT", "/api/admin/products/:id", ADMIN, async ({ db, params, body }) => {
    const id = check.int(params.id, "El producto", { min: 1 });
    const current = await one(db, "SELECT * FROM tc.products WHERE id = $1", [id]);
    if (!current) fail(404, "Producto no encontrado");
    const p = await readProductInput(db, await body());
    const row = await one(
      db,
      `UPDATE tc.products SET name = $1, category = $2, brand = $3, specs = $4, price = $5, offer_price = $6, stock = $7,
              sku = $8, image_id = $9, image_url = $10, active = $11, updated_at = now()
       WHERE id = $12 RETURNING *`,
      [p.name, p.category, p.brand, p.specs, p.price, p.offerPrice, p.stock, p.sku || current.sku, p.imageId, p.imageUrl, p.active, id],
    );
    if (current.image_id && current.image_id !== p.imageId) await deleteImageIfOrphan(db, current.image_id);
    return { product: serializeProduct(row) };
  });

  router.on("PATCH", "/api/admin/products/:id/stock", ADMIN, async ({ db, params, body }) => {
    const id = check.int(params.id, "El producto", { min: 1 });
    const delta = check.int((await body()).delta, "El ajuste", { min: -10_000, max: 10_000 });
    const row = await one(db, "UPDATE tc.products SET stock = greatest(0, stock + $1), updated_at = now() WHERE id = $2 RETURNING *", [delta, id]);
    if (!row) fail(404, "Producto no encontrado");
    return { product: serializeProduct(row) };
  });

  router.on("DELETE", "/api/admin/products/:id", ADMIN, async ({ db, params }) => {
    const id = check.int(params.id, "El producto", { min: 1 });
    const row = await one(db, "DELETE FROM tc.products WHERE id = $1 RETURNING image_id", [id]);
    if (!row) fail(404, "Producto no encontrado");
    await deleteImageIfOrphan(db, row.image_id);
    return { ok: true };
  });

  // Pedidos
  router.on("GET", "/api/admin/orders", ADMIN, async ({ db, url }) => {
    const status = url.searchParams.get("status") || "activos";
    const filters: Record<string, string> = {
      activos: "WHERE o.status IN ('nuevo', 'confirmado', 'en_camino')",
      todos: "",
    };
    const valid = ["nuevo", "confirmado", "en_camino", "entregado", "cancelado"];
    const where = filters[status] ?? (valid.includes(status) ? "WHERE o.status = $1" : fail(400, "Filtro no válido"));
    const rows = await db.query(`${ORDER_SELECT} ${where} ORDER BY o.id DESC LIMIT 200`, where.includes("$1") ? [status] : []);
    return { orders: rows.map(serializeOrder) };
  });

  router.on("POST", "/api/admin/orders/:id/:action", ADMIN, async ({ db, params, body, user }) => {
    const action = ORDER_ACTIONS[params.action];
    if (!action) fail(404, "Acción no válida");
    const id = check.int(params.id, "El pedido", { min: 1 });
    const b = await body();
    await db.tx(async (tx) => {
      const order = await one(tx, "SELECT * FROM tc.orders WHERE id = $1 FOR UPDATE", [id]);
      if (!order) fail(404, "Pedido no encontrado");
      await action(tx, order, user, b);
    });
    return { order: serializeOrder(await one(db, `${ORDER_SELECT} WHERE o.id = $1`, [id])) };
  });

  // Ventas (rango de fechas en hora de Honduras)
  router.on("GET", "/api/admin/sales", ADMIN, async ({ db, url }) => {
    const isDate = (s: string | null) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
    const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from") : null;
    const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to") : null;
    const rows = await db.query(
      `SELECT * FROM tc.sales
       WHERE created_at >= coalesce(($1::date)::timestamp AT TIME ZONE '${TZ}', ${START_OF.day} - interval '6 days')
         AND created_at <  coalesce((($2::date) + 1)::timestamp AT TIME ZONE '${TZ}', now() + interval '1 minute')
       ORDER BY id DESC LIMIT 500`,
      [from, to],
    );
    const sales = rows.map(serializeSale);
    const valid = sales.filter((s) => !s.voided);
    const sum = (list: typeof sales) => round2(list.reduce((s, x) => s + x.total, 0));
    return {
      sales,
      totals: {
        count: valid.length,
        total: sum(valid),
        efectivo: sum(valid.filter((s) => s.paymentMethod === "efectivo")),
        transferencia: sum(valid.filter((s) => s.paymentMethod === "transferencia")),
      },
    };
  });

  // Mensajes y consultas
  router.on("GET", "/api/admin/inquiries", ADMIN, async ({ db, url }) => {
    const type = url.searchParams.get("type");
    const status = url.searchParams.get("status");
    const where: string[] = [];
    const params: unknown[] = [];
    if (type && (INQUIRY_TYPES as readonly string[]).includes(type)) where.push(`i.type = $${params.push(type)}`);
    if (status === "nuevo" || status === "atendido") where.push(`i.status = $${params.push(status)}`);
    const rows = await db.query(
      `SELECT i.*, r.name AS rider_name, r.phone AS rider_phone
       FROM tc.inquiries i LEFT JOIN tc.users r ON r.id = i.rider_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY i.id DESC LIMIT 300`,
      params,
    );
    return { inquiries: rows.map(serializeInquiry) };
  });

  router.on("PATCH", "/api/admin/inquiries/:id", ADMIN, async ({ db, params, body }) => {
    const id = check.int(params.id, "La consulta", { min: 1 });
    const status = check.oneOf((await body()).status, "El estado", ["nuevo", "atendido"] as const);
    await db.query("UPDATE tc.inquiries SET status = $1 WHERE id = $2", [status, id]);
    return { ok: true };
  });

  // Equipo
  router.on("GET", "/api/admin/users", ADMIN, async ({ db }) => {
    const rows = await db.query(
      `SELECT u.*,
              coalesce(st.delivered, 0)::int AS delivered,
              coalesce(st.earnings, 0)::float8 AS earnings,
              coalesce(st.active_orders, 0)::int AS active_orders
       FROM tc.users u
       LEFT JOIN (
         SELECT rider_id,
                count(*) FILTER (WHERE rider_status = 'entregado') AS delivered,
                sum(rider_fee) FILTER (WHERE rider_status = 'entregado') AS earnings,
                count(*) FILTER (WHERE rider_status IN ('asignado', 'aceptado', 'recogido')) AS active_orders
         FROM tc.orders WHERE rider_id IS NOT NULL GROUP BY rider_id
       ) st ON st.rider_id = u.id
       ORDER BY array_position(ARRAY['admin', 'empleado', 'rider'], u.role), u.active DESC, u.name`,
    );
    return {
      users: rows.map((u) => ({
        ...serializeUser(u),
        stats: u.role === "rider" ? { delivered: u.delivered, earnings: u.earnings, active: u.active_orders } : undefined,
      })),
    };
  });

  router.on("POST", "/api/admin/users", ADMIN, async ({ db, body }) => {
    const b = await body();
    const role = check.oneOf(b.role, "El rol", ["admin", "empleado", "rider"] as const);
    const username = check.username(b.username);
    const password = check.password(b.password);
    const name = check.text(b.name, "El nombre", { max: 80 });
    const phone = check.phone(b.phone, "El teléfono", { optional: role !== "rider" });
    try {
      const row = await one(
        db,
        "INSERT INTO tc.users (role, username, password_hash, name, phone, available) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
        [role, username, await hashPassword(password), name, phone, role === "rider"],
      );
      return { user: serializeUser(row) };
    } catch (err) {
      if (isUniqueViolation(err)) fail(409, "Ese usuario ya existe, elegí otro");
      throw err;
    }
  });

  router.on("PUT", "/api/admin/users/:id", ADMIN, async ({ db, params, body, user }) => {
    const id = check.int(params.id, "El usuario", { min: 1 });
    const target = await one(db, "SELECT * FROM tc.users WHERE id = $1", [id]);
    if (!target) fail(404, "Usuario no encontrado");
    const b = await body();

    const name = check.text(b.name ?? target.name, "El nombre", { max: 80 });
    const phone = check.phone(b.phone ?? target.phone, "El teléfono", { optional: target.role !== "rider" });
    const active = b.active === undefined ? Boolean(target.active) : check.bool(b.active);
    const available = b.available === undefined ? Boolean(target.available) : check.bool(b.available);
    if (id === user.id && !active) fail(400, "No podés desactivar tu propia cuenta");
    const passwordHash = b.password ? await hashPassword(check.password(b.password)) : null;

    const row = await one(
      db,
      `UPDATE tc.users SET name = $1, phone = $2, active = $3, available = $4, password_hash = coalesce($5, password_hash)
       WHERE id = $6 RETURNING *`,
      [name, phone, active, available, passwordHash, id],
    );
    // Cambiar la contraseña o desactivar la cuenta cierra sus sesiones abiertas.
    if ((passwordHash && id !== user.id) || !active) await db.query("DELETE FROM tc.sessions WHERE user_id = $1", [id]);
    return { user: serializeUser(row) };
  });

  router.on("DELETE", "/api/admin/users/:id", ADMIN, async ({ db, params, user }) => {
    const id = check.int(params.id, "El usuario", { min: 1 });
    if (id === user.id) fail(400, "No podés eliminar tu propia cuenta");
    const history = await one(
      db,
      `SELECT EXISTS (SELECT 1 FROM tc.sales WHERE seller_id = $1)
           OR EXISTS (SELECT 1 FROM tc.orders WHERE rider_id = $1)
           OR EXISTS (SELECT 1 FROM tc.inquiries WHERE rider_id = $1) AS has_history`,
      [id],
    );
    // Con historial (ventas o entregas) la cuenta se archiva para no perder los registros.
    if (history?.has_history) {
      await db.query("UPDATE tc.users SET active = false, available = false WHERE id = $1", [id]);
      await db.query("DELETE FROM tc.sessions WHERE user_id = $1", [id]);
      return { archived: true };
    }
    const deleted = await one(db, "DELETE FROM tc.users WHERE id = $1 RETURNING id", [id]);
    if (!deleted) fail(404, "Usuario no encontrado");
    return { archived: false };
  });

  // Ajustes
  router.on("GET", "/api/admin/settings", ADMIN, async ({ db }) => ({ settings: await getSettings(db) }));

  router.on("PUT", "/api/admin/settings", ADMIN, async ({ db, body }) => {
    const b = await body();
    const categories = [...new Set<string>((Array.isArray(b.categories) ? b.categories : []).map((c: unknown) => check.text(c, "La categoría", { max: 40 })))];
    if (categories.length === 0 || categories.length > 30) fail(400, "Definí entre 1 y 30 categorías");
    const banks = (Array.isArray(b.banks) ? b.banks : []).slice(0, 8).map((x: any) => ({
      bank: check.text(x.bank, "El nombre del banco", { max: 40 }),
      account: check.text(x.account, "El número de cuenta", { max: 40, optional: true }),
      holder: check.text(x.holder, "El titular de la cuenta", { max: 80, optional: true }),
    }));

    const values: Record<string, string> = {
      store_name: check.text(b.storeName, "El nombre de la tienda", { max: 60 }),
      whatsapp: check.phone(b.whatsapp, "El WhatsApp de la tienda"),
      rider_fee: String(check.money(b.riderFee, "La tarifa por entrega")),
      low_stock: String(check.int(b.lowStock, "El aviso de stock bajo", { min: 0, max: 1000 })),
      categories: JSON.stringify(categories),
      banks: JSON.stringify(banks),
    };
    await db.tx(async (tx) => {
      for (const [k, v] of Object.entries(values)) await saveSetting(tx, k, v);
    });
    return { settings: await getSettings(db) };
  });
}
