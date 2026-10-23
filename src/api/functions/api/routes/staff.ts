/**
 * Punto de venta (admin y empleado) y subida de imágenes.
 */
import { one, START_OF } from "../lib/db.ts";
import { fail, type Router, STAFF } from "../lib/http.ts";
import {
  getSettings, imagePath, PAYMENT_METHODS, priceItems, saveImage, serializeProduct, serializeSale, takeStock, TAX_RATE,
} from "../lib/store.ts";
import { check, round2 } from "../lib/validate.ts";

export function staffRoutes(router: Router): void {
  /** Fotos de producto (solo admin, públicas) o comprobantes de transferencia (privados). */
  router.on("POST", "/api/images", STAFF, async ({ db, body, user }) => {
    const b = await body();
    const purpose = check.oneOf(b.purpose, "El uso de la imagen", ["producto", "comprobante"] as const);
    if (purpose === "producto" && user.role !== "admin") fail(403, "Solo el admin puede cambiar fotos de productos");
    const id = await saveImage(db, b.dataUrl, purpose === "comprobante");
    return { id, url: imagePath(id) };
  });

  router.on("GET", "/api/staff/catalog", STAFF, async ({ db }) => {
    const [settings, products] = await Promise.all([
      getSettings(db),
      db.query("SELECT * FROM tc.products WHERE active ORDER BY category, name"),
    ]);
    return {
      store: { name: settings.storeName, whatsapp: settings.whatsapp, categories: settings.categories, banks: settings.banks },
      taxRate: TAX_RATE,
      products: products.map(serializeProduct),
    };
  });

  router.on("POST", "/api/staff/sales", STAFF, async ({ db, body, user }) => {
    const b = await body();
    const paymentMethod = check.oneOf(b.paymentMethod, "El método de pago", PAYMENT_METHODS);
    const discountInput = b.discount ? check.money(b.discount, "El descuento") : 0;
    const includeTax = check.bool(b.includeTax);

    return db.tx(async (tx) => {
      const { items, subtotal } = await priceItems(tx, b.items, 999);
      const discount = Math.min(discountInput, subtotal);
      const tax = includeTax ? round2((subtotal - discount) * TAX_RATE) : 0;
      const total = round2(subtotal - discount + tax);

      let cashReceived: number | null = null;
      let change: number | null = null;
      let bank: string | null = null;
      let receiptId: string | null = null;

      if (paymentMethod === "efectivo") {
        cashReceived = check.money(b.cashReceived, "El monto recibido");
        if (cashReceived < total) fail(400, "El monto recibido es menor al total");
        change = round2(cashReceived - total);
      } else {
        bank = check.text(b.bank, "El banco", { max: 60 });
        receiptId = check.imageId(b.receiptImageId);
        const receipt = await one(tx, "SELECT id FROM tc.images WHERE id = $1 AND is_private", [receiptId]);
        if (!receipt) fail(400, "No se encontró el comprobante, volvé a subirlo");
      }

      await takeStock(tx, items);
      const sale = await one(
        tx,
        `INSERT INTO tc.sales (channel, seller_id, seller_name, items, subtotal, discount, tax, total, payment_method,
                               bank, cash_received, change_given, receipt_image_id)
         VALUES ('pos', $1, $2, $3::text::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [user.id, user.name, JSON.stringify(items), subtotal, discount, tax, total, paymentMethod, bank, cashReceived, change, receiptId],
      );
      return { sale: serializeSale(sale) };
    });
  });

  router.on("GET", "/api/staff/sales/today", STAFF, async ({ db, user }) => {
    const rows = await db.query(
      `SELECT * FROM tc.sales WHERE seller_id = $1 AND NOT voided AND created_at >= ${START_OF.day} ORDER BY id DESC`,
      [user.id],
    );
    const sales = rows.map(serializeSale);
    const sum = (list: typeof sales) => round2(list.reduce((s, x) => s + x.total, 0));
    return {
      sales,
      totals: {
        count: sales.length,
        total: sum(sales),
        efectivo: sum(sales.filter((s) => s.paymentMethod === "efectivo")),
        transferencia: sum(sales.filter((s) => s.paymentMethod === "transferencia")),
      },
    };
  });
}
