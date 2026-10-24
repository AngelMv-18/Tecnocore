/**
 * Pruebas de punta a punta de la API contra un Postgres real.
 *   DATABASE_URL=postgres://postgres@localhost:54329/tecnocore_test bun test tests/api.test.ts
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createApp } from "../api/functions/api/app.ts";
import { createDb } from "../api/functions/api/lib/db.ts";
import { sha256 } from "../api/functions/api/lib/security.ts";

const ADMIN_URL = process.env.ADMIN_DATABASE_URL || "postgres://postgres@localhost:54329/postgres";
const TEST_DB = "tecnocore_test";
const SETUP_CODE = "TC-PRUEBA-2026";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

let handle: ReturnType<typeof createApp>;
let sql: SQL;

type Res = { status: number; data: any };

async function call(method: string, path: string, body?: unknown, token?: string, ip = "10.0.0.1"): Promise<Res> {
  const res = await handle(
    new Request(`http://local${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": ip,
        ...(token ? { "X-Session-Token": token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const isJson = (res.headers.get("content-type") || "").includes("json");
  return { status: res.status, data: isJson ? await res.json() : null };
}

beforeAll(async () => {
  const admin = new SQL(ADMIN_URL);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  await admin.close();

  sql = new SQL(ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB}`));
  await sql.unsafe(await Bun.file(new URL("../api/schema.sql", import.meta.url)).text());
  await sql.unsafe("INSERT INTO tc.settings (k, v) VALUES ('setup_code_hash', $1)", [await sha256(SETUP_CODE)]);
  handle = createApp(createDb(sql as any));
});

// Estado compartido entre pasos del escenario
const s: Record<string, any> = {};

describe("arranque y primer administrador", () => {
  test("catálogo de ejemplo y ajustes por defecto", async () => {
    const r = await call("GET", "/api/public/catalog");
    expect(r.status).toBe(200);
    expect(r.data.products).toHaveLength(5);
    expect(r.data.store.whatsapp).toBe("50493893595");
    expect(r.data.store.banks).toHaveLength(0); // sin cuentas cargadas no se muestran
    s.rtx = r.data.products.find((p: any) => p.name.includes("RTX"));
    expect(s.rtx.finalPrice).toBe(13900);
  });

  test("las rutas también responden con prefijo de Supabase", async () => {
    const r = await call("GET", "/functions/v1/api/health");
    expect(r.data).toEqual({ ok: true, version: 2 });
  });

  test("pide configuración inicial", async () => {
    expect((await call("GET", "/api/auth/setup")).data.needsSetup).toBe(true);
  });

  test("rechaza el código de configuración incorrecto", async () => {
    const r = await call("POST", "/api/auth/setup", { code: "otro", name: "X", username: "xyz", password: "123456" }, undefined, "10.9.9.9");
    expect(r.status).toBe(403);
  });

  test("crea el primer admin con el código (sin importar mayúsculas)", async () => {
    const r = await call("POST", "/api/auth/setup", { code: SETUP_CODE.toLowerCase(), name: "José", username: "Jose", password: "clave123" });
    expect(r.status).toBe(200);
    expect(r.data.user.role).toBe("admin");
    expect(r.data.user.username).toBe("jose");
    s.admin = r.data.token;
  });

  test("el código queda inutilizado después de usarse", async () => {
    expect((await call("GET", "/api/auth/setup")).data.needsSetup).toBe(false);
    const r = await call("POST", "/api/auth/setup", { code: SETUP_CODE, name: "X", username: "otro", password: "123456" });
    expect(r.status).toBe(503);
  });

  test("la contraseña se guarda cifrada", async () => {
    const [row] = await sql.unsafe("SELECT password_hash FROM tc.users WHERE username = 'jose'");
    expect(row.password_hash).toStartWith("pbkdf2$");
    expect(row.password_hash).not.toContain("clave123");
  });
});

describe("seguridad", () => {
  test("rutas privadas sin sesión → 401", async () => {
    expect((await call("GET", "/api/admin/dashboard")).status).toBe(401);
    expect((await call("GET", "/api/staff/catalog")).status).toBe(401);
    expect((await call("GET", "/api/rider/dashboard")).status).toBe(401);
  });

  test("contraseña incorrecta → 401", async () => {
    expect((await call("POST", "/api/auth/login", { portal: "admin", username: "jose", password: "mala" })).status).toBe(401);
  });

  test("demasiados intentos de inicio de sesión → 429", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call("POST", "/api/auth/login", { portal: "admin", username: "x", password: "y" }, undefined, "10.6.6.6")).status;
    expect(last).toBe(429);
  });

  test("cambiar X-Forwarded-For no salta el límite cuando llega la IP de Cloudflare", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await handle(new Request("http://local/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": "10.7.7.7", "x-forwarded-for": `10.8.0.${i}` },
        body: JSON.stringify({ portal: "admin", username: "x", password: "y" }),
      }));
      last = res.status;
    }
    expect(last).toBe(429);
  });

  test("no existe ruta de almacenamiento genérico (hueco de la v1)", async () => {
    expect((await call("GET", "/storage/catalogo-config")).status).toBe(404);
  });
});

describe("productos e imágenes (admin)", () => {
  test("subir foto de producto", async () => {
    const r = await call("POST", "/api/images", { purpose: "producto", dataUrl: PNG }, s.admin);
    expect(r.status).toBe(200);
    s.photo1 = r.data.id;
  });

  test("rechaza archivos que no son imágenes", async () => {
    const r = await call("POST", "/api/images", { purpose: "producto", dataUrl: "data:image/png;base64,SGVsbG8gbXVuZG8=" }, s.admin);
    expect(r.status).toBe(400);
  });

  test("crear producto con foto", async () => {
    const r = await call("POST", "/api/admin/products", { name: 'Monitor 27" 165Hz', category: "Periféricos", brand: "AOC", price: 4500, offerPrice: "", stock: 4, imageId: s.photo1 }, s.admin);
    expect(r.status).toBe(200);
    expect(r.data.product.imageUrl).toBe(`/api/images/${s.photo1}`);
    s.monitor = r.data.product;
  });

  test("la foto pública se sirve con caché", async () => {
    const res = await handle(new Request(`http://local/api/images/${s.photo1}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  test("cambiar la foto borra la anterior", async () => {
    const up = await call("POST", "/api/images", { purpose: "producto", dataUrl: PNG }, s.admin);
    const r = await call("PUT", `/api/admin/products/${s.monitor.id}`, { ...s.monitor, offerPrice: 4200, imageId: up.data.id }, s.admin);
    expect(r.status).toBe(200);
    expect(r.data.product.finalPrice).toBe(4200);
    expect((await handle(new Request(`http://local/api/images/${s.photo1}`))).status).toBe(404);
    s.monitor = r.data.product;
  });

  test("oferta mayor al precio → 400", async () => {
    expect((await call("PUT", `/api/admin/products/${s.monitor.id}`, { ...s.monitor, offerPrice: 9999 }, s.admin)).status).toBe(400);
  });

  test("ajustar stock", async () => {
    const r = await call("PATCH", `/api/admin/products/${s.monitor.id}/stock`, { delta: 2 }, s.admin);
    expect(r.data.product.stock).toBe(6);
  });
});

describe("equipo", () => {
  test("crear empleado y dos riders", async () => {
    expect((await call("POST", "/api/admin/users", { role: "empleado", name: "Ana Caja", username: "ana", password: "ana12345" }, s.admin)).status).toBe(200);
    const r1 = await call("POST", "/api/admin/users", { role: "rider", name: "Rider Uno", username: "rider1", password: "rider111", phone: "3333-4444" }, s.admin);
    const r2 = await call("POST", "/api/admin/users", { role: "rider", name: "Rider Dos", username: "rider2", password: "rider222", phone: "55556666" }, s.admin);
    expect(r1.data.user.phone).toBe("50433334444");
    expect(r1.data.user.available).toBe(true);
    s.rider1Id = r1.data.user.id;
    s.rider2Id = r2.data.user.id;
  });

  test("usuario duplicado → 409", async () => {
    expect((await call("POST", "/api/admin/users", { role: "rider", name: "X", username: "rider2", password: "123456", phone: "55556666" }, s.admin)).status).toBe(409);
  });

  test("cada cuenta solo entra a su portal", async () => {
    expect((await call("POST", "/api/auth/login", { portal: "admin", username: "ana", password: "ana12345" })).status).toBe(403);
    expect((await call("POST", "/api/auth/login", { portal: "admin", username: "rider1", password: "rider111" })).status).toBe(403);
    const emp = await call("POST", "/api/auth/login", { portal: "empleado", username: "ana", password: "ana12345" });
    expect(emp.status).toBe(200);
    s.emp = emp.data.token;
    s.r1 = (await call("POST", "/api/auth/login", { portal: "rider", username: "rider1", password: "rider111" })).data.token;
    s.r2 = (await call("POST", "/api/auth/login", { portal: "rider", username: "rider2", password: "rider222" })).data.token;
    expect(s.r1 && s.r2).toBeTruthy();
  });

  test("el empleado no entra al panel admin", async () => {
    expect((await call("GET", "/api/admin/dashboard", undefined, s.emp)).status).toBe(403);
  });
});

describe("pedido del cliente → panel admin → rider", () => {
  test("el cliente hace un pedido con envío (precios calculados en el servidor)", async () => {
    const r = await call("POST", "/api/public/orders", {
      name: "Cliente Prueba", phone: "9876-5432", delivery: true, address: "Col. Kennedy", paymentMethod: "transferencia",
      items: [{ productId: s.monitor.id, qty: 2, price: 1 }, { productId: s.rtx.id, qty: 1 }],
    });
    expect(r.status).toBe(200);
    expect(r.data.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(r.data.total).toBe(4200 * 2 + 13900);
    s.orderCode = r.data.code;
  });

  test("pedido sin stock suficiente → 409", async () => {
    const r = await call("POST", "/api/public/orders", { name: "X", phone: "98765432", delivery: false, paymentMethod: "efectivo", items: [{ productId: s.rtx.id, qty: 9 }] });
    expect(r.status).toBe(409);
  });

  test("consultas del cliente: interés y ayuda", async () => {
    expect((await call("POST", "/api/public/inquiries", { type: "interes", name: "Interesado", productId: s.monitor.id })).status).toBe(200);
    expect((await call("POST", "/api/public/inquiries", { type: "ayuda", name: "Ana", phone: "91112222", message: "¿Arman PC?" })).status).toBe(200);
  });

  test("el admin ve el pedido y las consultas al instante", async () => {
    const r = await call("GET", "/api/admin/summary", undefined, s.admin);
    expect(r.data).toMatchObject({ newOrders: 1, unseenOrders: 1, openInquiries: 2 });
    const orders = await call("GET", "/api/admin/orders?status=activos", undefined, s.admin);
    s.order = orders.data.orders.find((o: any) => o.code === s.orderCode);
    expect(s.order.customer.phone).toBe("50498765432");
  });

  test("no se asigna rider antes de concretar la venta", async () => {
    expect((await call("POST", `/api/admin/orders/${s.order.id}/assign`, { riderId: s.rider1Id }, s.admin)).status).toBe(409);
  });

  test("concretar la venta descuenta el stock", async () => {
    const r = await call("POST", `/api/admin/orders/${s.order.id}/confirm`, {}, s.admin);
    expect(r.data.order.status).toBe("confirmado");
    expect(r.data.order.saleId).toBeGreaterThan(0);
    const p = (await call("GET", "/api/admin/products", undefined, s.admin)).data.products.find((x: any) => x.id === s.monitor.id);
    expect(p.stock).toBe(4);
  });

  test("asignar al rider 1", async () => {
    const r = await call("POST", `/api/admin/orders/${s.order.id}/assign`, { riderId: s.rider1Id }, s.admin);
    expect(r.data.order.rider.id).toBe(s.rider1Id);
    expect(r.data.order.riderStatus).toBe("asignado");
  });

  test("el rider 1 lo ve y lo rechaza: pasa automáticamente al rider 2", async () => {
    expect((await call("GET", "/api/rider/dashboard", undefined, s.r1)).data.active).toHaveLength(1);
    const r = await call("POST", `/api/rider/orders/${s.order.id}/reject`, {}, s.r1);
    expect(r.data.reassignedTo).toBe("Rider Dos");
  });

  test("el rider 2 sigue el flujo: aceptar → recoger → entregar", async () => {
    expect((await call("POST", `/api/rider/orders/${s.order.id}/pickup`, {}, s.r2)).status).toBe(409);
    expect((await call("POST", `/api/rider/orders/${s.order.id}/accept`, {}, s.r2)).status).toBe(200);
    expect((await call("POST", `/api/rider/orders/${s.order.id}/accept`, {}, s.r1)).status).toBe(403);
    expect((await call("POST", `/api/rider/orders/${s.order.id}/pickup`, {}, s.r2)).status).toBe(200);

    const track = await call("GET", `/api/public/orders/${s.orderCode}`);
    expect(track.data).toMatchObject({ status: "en_camino", riderName: "Rider Dos" });

    const d = await call("POST", `/api/rider/orders/${s.order.id}/deliver`, {}, s.r2);
    expect(d.data.earned).toBe(80);
  });

  test("estadísticas del rider: entregas, ganancias y tiempo récord", async () => {
    const r = await call("GET", "/api/rider/dashboard", undefined, s.r2);
    expect(r.data.stats.total).toEqual({ count: 1, earnings: 80 });
    expect(r.data.stats.today).toEqual({ count: 1, earnings: 80 });
    expect(r.data.stats.recordSeconds).toBeGreaterThanOrEqual(0);
    expect(r.data.history).toHaveLength(1);
    expect(r.data.active).toHaveLength(0);
  });

  test("si nadie más está disponible, el rechazo devuelve el pedido al admin", async () => {
    const o = await call("POST", "/api/public/orders", { name: "Otro", phone: "98765432", delivery: true, address: "Col. Palmira", paymentMethod: "efectivo", items: [{ productId: s.monitor.id, qty: 1 }] });
    const id = (await call("GET", "/api/admin/orders?status=nuevo", undefined, s.admin)).data.orders.find((x: any) => x.code === o.data.code).id;
    await call("POST", `/api/admin/orders/${id}/confirm`, {}, s.admin);
    await call("POST", "/api/rider/availability", { available: false }, s.r2);
    await call("POST", `/api/admin/orders/${id}/assign`, { riderId: s.rider1Id }, s.admin);
    const r = await call("POST", `/api/rider/orders/${id}/reject`, {}, s.r1);
    expect(r.data.reassignedTo).toBeNull();
    expect((await call("GET", "/api/admin/summary", undefined, s.admin)).data.unassignedDeliveries).toBe(1);
    s.pendingDeliveryId = id;
  });
});

describe("punto de venta del empleado", () => {
  test("efectivo con vuelto", async () => {
    const r = await call("POST", "/api/staff/sales", { items: [{ productId: s.monitor.id, qty: 1 }], paymentMethod: "efectivo", cashReceived: 5000 }, s.emp);
    expect(r.status).toBe(200);
    expect(r.data.sale).toMatchObject({ total: 4200, change: 800, seller: { name: "Ana Caja" } });
  });

  test("efectivo insuficiente → 400", async () => {
    expect((await call("POST", "/api/staff/sales", { items: [{ productId: s.monitor.id, qty: 1 }], paymentMethod: "efectivo", cashReceived: 100 }, s.emp)).status).toBe(400);
  });

  test("transferencia exige el comprobante", async () => {
    expect((await call("POST", "/api/staff/sales", { items: [{ productId: s.monitor.id, qty: 1 }], paymentMethod: "transferencia", bank: "BAC Credomatic" }, s.emp)).status).toBe(400);
  });

  test("el empleado no puede subir fotos de productos", async () => {
    expect((await call("POST", "/api/images", { purpose: "producto", dataUrl: PNG }, s.emp)).status).toBe(403);
  });

  test("transferencia con descuento, ISV y comprobante privado", async () => {
    const receipt = await call("POST", "/api/images", { purpose: "comprobante", dataUrl: PNG }, s.emp);
    const r = await call("POST", "/api/staff/sales", {
      items: [{ productId: s.monitor.id, qty: 1 }], discount: 200, includeTax: true,
      paymentMethod: "transferencia", bank: "BAC Credomatic", receiptImageId: receipt.data.id,
    }, s.emp);
    expect(r.status).toBe(200);
    expect(r.data.sale).toMatchObject({ subtotal: 4200, discount: 200, tax: 600, total: 4600, bank: "BAC Credomatic" });
    s.receiptId = receipt.data.id;
  });

  test("los productos de ventas y pedidos se guardan como lista JSON (no como texto)", async () => {
    const [row] = await sql.unsafe(
      `SELECT (SELECT count(*) FROM tc.sales WHERE jsonb_typeof(items) <> 'array')::int
            + (SELECT count(*) FROM tc.orders WHERE jsonb_typeof(items) <> 'array' OR jsonb_typeof(rejected_by) <> 'array')::int AS bad`,
    );
    expect(row.bad).toBe(0);
  });

  test("el comprobante solo se ve con sesión", async () => {
    expect((await handle(new Request(`http://local/api/images/${s.receiptId}`))).status).toBe(401);
    const ok = await handle(new Request(`http://local/api/images/${s.receiptId}`, { headers: { "X-Session-Token": s.admin } }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
  });

  test("resumen de ventas del día del empleado", async () => {
    const r = await call("GET", "/api/staff/sales/today", undefined, s.emp);
    expect(r.data.totals).toEqual({ count: 2, total: 8800, efectivo: 4200, transferencia: 4600 });
  });
});

describe("cancelación, mensajes, dashboard y ajustes", () => {
  test("cancelar un pedido confirmado devuelve el stock y anula la venta", async () => {
    const before = (await call("GET", "/api/admin/products", undefined, s.admin)).data.products.find((p: any) => p.id === s.monitor.id).stock;
    const r = await call("POST", `/api/admin/orders/${s.pendingDeliveryId}/cancel`, {}, s.admin);
    expect(r.data.order.status).toBe("cancelado");
    const after = (await call("GET", "/api/admin/products", undefined, s.admin)).data.products.find((p: any) => p.id === s.monitor.id).stock;
    expect(after).toBe(before + 1);
  });

  test("un reporte sobre un pedido queda vinculado a su rider", async () => {
    await call("POST", "/api/public/inquiries", { type: "reporte", name: "Cliente Prueba", phone: "98765432", message: "Llegó tarde", orderCode: s.orderCode });
    const r = await call("GET", "/api/admin/inquiries?type=reporte", undefined, s.admin);
    expect(r.data.inquiries[0].rider.name).toBe("Rider Dos");
    expect((await call("PATCH", `/api/admin/inquiries/${r.data.inquiries[0].id}`, { status: "atendido" }, s.admin)).status).toBe(200);
  });

  test("dashboard con ventas de hoy, últimos 7 días e intereses", async () => {
    const r = await call("GET", "/api/admin/dashboard", undefined, s.admin);
    expect(r.status).toBe(200);
    expect(r.data.today.count).toBe(3); // online + 2 del POS (la cancelada no cuenta)
    expect(r.data.last7).toHaveLength(7);
    expect(r.data.last7[6].count).toBe(3);
    expect(r.data.mostInterested[0]).toMatchObject({ name: 'Monitor 27" 165Hz', count: 1 });
    expect(r.data.topProducts[0].name).toBe('Monitor 27" 165Hz');
  });

  test("ventas por rango de fechas", async () => {
    const today = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
    const r = await call("GET", `/api/admin/sales?from=${today}&to=${today}`, undefined, s.admin);
    expect(r.data.totals.count).toBe(3);
    expect(r.data.sales.some((x: any) => x.voided)).toBe(true);
  });

  test("guardar ajustes y reflejarlos en el catálogo", async () => {
    const r = await call("PUT", "/api/admin/settings", {
      storeName: "Tecnocore", whatsapp: "9389-3595", riderFee: 100, lowStock: 3, categories: ["CPU", "GPU", "CPU"],
      banks: [{ bank: "BAC Credomatic", account: "7001234", holder: "José" }, { bank: "Ficohsa", account: "", holder: "" }],
    }, s.admin);
    expect(r.data.settings).toMatchObject({ whatsapp: "50493893595", riderFee: 100, categories: ["CPU", "GPU"] });
    const cat = await call("GET", "/api/public/catalog");
    expect(cat.data.store.banks).toEqual([{ bank: "BAC Credomatic", account: "7001234", holder: "José" }]);
  });

  test("eliminar un rider con historial lo archiva", async () => {
    const r = await call("DELETE", `/api/admin/users/${s.rider2Id}`, undefined, s.admin);
    expect(r.data.archived).toBe(true);
    expect((await call("GET", "/api/rider/dashboard", undefined, s.r2)).status).toBe(401);
  });

  test("cambiar la contraseña y cerrar sesión", async () => {
    expect((await call("POST", "/api/auth/password", { current: "clave123", next: "nueva-clave-1" }, s.admin)).status).toBe(200);
    await call("POST", "/api/auth/logout", {}, s.admin);
    expect((await call("GET", "/api/auth/me", undefined, s.admin)).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { portal: "admin", username: "jose", password: "nueva-clave-1" }, undefined, "10.0.0.2")).status).toBe(200);
  });
});
