/**
 * Rutas públicas (sin sesión): lo que usa la página del cliente.
 */
import { isUniqueViolation, one } from "../lib/db.ts";
import { fail, PUBLIC, type Router } from "../lib/http.ts";
import { randomOrderCode, rateLimit } from "../lib/security.ts";
import { getSettings, INQUIRY_TYPES, ORDER_SELECT, PAYMENT_METHODS, priceItems, serializeProduct } from "../lib/store.ts";
import { check } from "../lib/validate.ts";

export function publicRoutes(router: Router): void {
  router.on("GET", "/api/health", PUBLIC, async () => ({ ok: true, version: 2 }));

  router.on("GET", "/api/public/catalog", PUBLIC, async ({ db }) => {
    const [settings, products] = await Promise.all([
      getSettings(db),
      db.query("SELECT * FROM tc.products WHERE active ORDER BY (offer_price IS NOT NULL) DESC, name"),
    ]);
    return {
      store: {
        name: settings.storeName,
        whatsapp: settings.whatsapp,
        categories: settings.categories,
        banks: settings.banks.filter((b) => b.account),
      },
      products: products.map(serializeProduct),
    };
  });

  // Cuenta una vista del producto (una por visitante cada 30 minutos).
  router.on("POST", "/api/public/products/:id/view", PUBLIC, async ({ db, params, ip }) => {
    const id = check.int(params.id, "El producto", { min: 1 });
    try {
      await rateLimit(db, `view:${ip}:${id}`, 1, 30 * 60);
    } catch {
      return { counted: false };
    }
    await db.query("UPDATE tc.products SET views = views + 1 WHERE id = $1 AND active", [id]);
    return { counted: true };
  });

  router.on("POST", "/api/public/orders", PUBLIC, async ({ db, body, ip }) => {
    await rateLimit(db, `order:${ip}`, 6, 10 * 60);
    const b = await body();
    const name = check.text(b.name, "Tu nombre", { max: 80 });
    const phone = check.phone(b.phone, "Tu teléfono");
    const delivery = check.bool(b.delivery);
    const address = delivery ? check.text(b.address, "La dirección de entrega", { max: 300 }) : "";
    const paymentMethod = check.oneOf(b.paymentMethod, "El método de pago", PAYMENT_METHODS);
    const notes = check.text(b.notes, "La nota", { max: 500, optional: true });
    const { items, subtotal } = await priceItems(db, b.items, 20);

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomOrderCode();
      try {
        await db.query(
          `INSERT INTO tc.orders (code, customer_name, customer_phone, delivery, address, payment_method, notes, items, total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb, $9)`,
          [code, name, phone, delivery, address, paymentMethod, notes, JSON.stringify(items), subtotal],
        );
        return { code, total: subtotal, items, status: "nuevo" };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    fail(500, "No se pudo generar el pedido, intentá de nuevo");
  });

  router.on("GET", "/api/public/orders/:code", PUBLIC, async ({ db, params, ip }) => {
    await rateLimit(db, `track:${ip}`, 40, 60);
    const code = String(params.code).toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) fail(404, "Pedido no encontrado");
    const o = await one(db, `${ORDER_SELECT} WHERE o.code = $1`, [code]);
    if (!o) fail(404, "Pedido no encontrado");
    return {
      code: o.code,
      status: o.status,
      riderStatus: o.rider_status,
      delivery: Boolean(o.delivery),
      total: Number(o.total),
      items: o.items,
      riderName: o.rider_id ? o.rider_name : null,
      createdAt: o.created_at,
      deliveredAt: o.delivered_at,
    };
  });

  router.on("POST", "/api/public/inquiries", PUBLIC, async ({ db, body, ip }) => {
    await rateLimit(db, `inquiry:${ip}`, 10, 10 * 60);
    const b = await body();
    const type = check.oneOf(b.type, "El tipo de consulta", INQUIRY_TYPES);
    const name = check.text(b.name, "Tu nombre", { max: 80 });
    const phone = check.phone(b.phone, "Tu teléfono", { optional: type === "interes" });
    const message = check.text(b.message, "El mensaje", { max: 1000, optional: type === "interes" });

    let product: { id: number; name: string } | null = null;
    if (b.productId) {
      product = await one(db, "SELECT id, name FROM tc.products WHERE id = $1", [check.int(b.productId, "El producto", { min: 1 })]);
    }
    if (type === "interes" && !product) fail(400, "Elegí el producto que te interesa");

    let orderCode: string | null = null;
    let riderId: number | null = null;
    if (b.orderCode) {
      orderCode = String(b.orderCode).trim().toUpperCase().slice(0, 12);
      const order = await one(db, "SELECT rider_id FROM tc.orders WHERE code = $1", [orderCode]);
      riderId = order?.rider_id ?? null;
    }

    const row = await one(
      db,
      `INSERT INTO tc.inquiries (type, customer_name, customer_phone, product_id, product_name, order_code, rider_id, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [type, name, phone, product?.id ?? null, product?.name ?? null, orderCode, riderId, message],
    );
    return { id: Number(row!.id) };
  });
}
