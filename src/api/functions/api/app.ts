/**
 * ══════════════════════════════════════════════════════════════════════
 *  Tecnocore API
 * ══════════════════════════════════════════════════════════════════════
 *    /api/public/*   catálogo, pedidos, seguimiento y consultas (sin sesión)
 *    /api/auth/*     portal de acceso de admin, empleado y rider
 *    /api/admin/*    panel de administración          (admin)
 *    /api/staff/*    punto de venta                   (admin, empleado)
 *    /api/rider/*    panel del rider                  (rider)
 *    /api/images/*   fotos de productos y comprobantes
 *
 *  `createApp(db)` devuelve un manejador estándar Request → Response,
 *  independiente de la plataforma donde corra.
 * ══════════════════════════════════════════════════════════════════════
 */
import { type Db, one } from "./lib/db.ts";
import { type Ctx, bodyReader, CORS_HEADERS, errorResponse, HttpError, json, Router, apiPath } from "./lib/http.ts";
import { DEFAULT_SETTINGS, userFromRequest } from "./lib/store.ts";
import { adminRoutes } from "./routes/admin.ts";
import { authRoutes } from "./routes/auth.ts";
import { publicRoutes } from "./routes/public.ts";
import { riderRoutes } from "./routes/rider.ts";
import { staffRoutes } from "./routes/staff.ts";

const SEED_PRODUCTS = [
  { name: "Ryzen 7 7800X3D", category: "CPU", brand: "AMD", specs: "8 núcleos / 16 hilos, socket AM5", price: 11200, offer: null, stock: 4, sku: "CPU-001", image: "https://commons.wikimedia.org/wiki/Special:FilePath/AMD_Ryzen_9_7900X.jpg" },
  { name: "GeForce RTX 4070 Super", category: "GPU", brand: "NVIDIA", specs: "12GB GDDR6X", price: 14800, offer: 13900, stock: 2, sku: "GPU-014", image: "https://commons.wikimedia.org/wiki/Special:FilePath/2023_Gigabyte_GeForce_RTX_4070_Aero_OC_12GB_(1).jpg" },
  { name: "Vengeance RGB 32GB", category: "RAM", brand: "Corsair", specs: "DDR5 6000MHz (2x16GB)", price: 2750, offer: null, stock: 0, sku: "RAM-022", image: "https://commons.wikimedia.org/wiki/Special:FilePath/2023_Pami%C4%99ci_Corsair_Vengeance_RGB.jpg" },
  { name: "NVMe 2TB Gen4", category: "Almacenamiento", brand: "WD Black SN850X", specs: "Lectura 7300MB/s", price: 3700, offer: null, stock: 9, sku: "ALM-007", image: "https://commons.wikimedia.org/wiki/Special:FilePath/Samsung_980_PRO_PCIe_4.0_NVMe_SSD_1TB-top_PNr%C2%B00915.jpg" },
  { name: "RM850x", category: "Fuente", brand: "Corsair", specs: "850W 80+ Gold, full modular", price: 3450, offer: 2999, stock: 1, sku: "FTE-003", image: "https://commons.wikimedia.org/wiki/Special:FilePath/Full_modular_ATX_power_supply_unit.jpg" },
];

/** Ajustes por defecto y catálogo de ejemplo la primera vez que arranca. */
async function prepareDatabase(db: Db): Promise<void> {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await db.query("INSERT INTO tc.settings (k, v) VALUES ($1, $2) ON CONFLICT (k) DO NOTHING", [k, v]);
  }
  const products = await one<{ n: number }>(db, "SELECT count(*)::int AS n FROM tc.products");
  if (products?.n === 0) {
    for (const p of SEED_PRODUCTS) {
      await db.query(
        `INSERT INTO tc.products (name, category, brand, specs, price, offer_price, stock, sku, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [p.name, p.category, p.brand, p.specs, p.price, p.offer, p.stock, p.sku, p.image],
      );
    }
  }
  await db.query("DELETE FROM tc.sessions WHERE expires_at < now()");
}

/** Las fotos de producto son públicas y se cachean; los comprobantes requieren sesión de admin o empleado. */
async function serveImage(db: Db, req: Request, id: string): Promise<Response> {
  if (!/^[a-f0-9]{32}$/.test(id)) return errorResponse(404, "Imagen no encontrada");
  const img = await one(db, "SELECT mime, data, is_private FROM tc.images WHERE id = $1", [id]);
  if (!img) return errorResponse(404, "Imagen no encontrada");
  if (img.is_private) {
    const user = await userFromRequest(db, req);
    if (!user || (user.role !== "admin" && user.role !== "empleado")) return errorResponse(401, "Iniciá sesión para ver este comprobante");
  }
  return new Response(img.data, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": img.mime,
      "Cache-Control": img.is_private ? "private, no-store" : "public, max-age=31536000, immutable",
    },
  });
}

export function createApp(db: Db) {
  const router = new Router();
  publicRoutes(router);
  authRoutes(router);
  staffRoutes(router);
  adminRoutes(router);
  riderRoutes(router);

  let ready: Promise<void> | null = null;
  const ensureReady = () => (ready ??= prepareDatabase(db).catch((err) => {
    ready = null; // reintenta en la próxima solicitud
    throw err;
  }));

  return async function handle(req: Request, clientIp = ""): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    const url = new URL(req.url);
    const path = apiPath(url.pathname);

    try {
      await ensureReady();

      const image = /^\/api\/images\/([^/]+)$/.exec(path);
      if (image && req.method === "GET") return await serveImage(db, req, image[1]);

      const found = router.match(req.method, path);
      if (!found) return errorResponse(404, "Ruta no encontrada");
      const { route, params } = found;

      const user = route.roles ? await userFromRequest(db, req) : null;
      if (route.roles && !user) return errorResponse(401, "Tu sesión expiró. Volvé a iniciar sesión");
      if (route.roles && !route.roles.includes(user!.role)) return errorResponse(403, "No tenés permiso para esto");

      const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || clientIp || "desconocida";
      const ctx: Ctx = { db, req, url, params, ip, user: user!, body: bodyReader(req) };
      return json((await route.handler(ctx)) ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.message);
      console.error(`${req.method} ${path} →`, err);
      return errorResponse(500, "Error interno del servidor");
    }
  };
}
