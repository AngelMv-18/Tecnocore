/**
 * Panel del rider: pedidos asignados, historial, ganancias y tiempos.
 */
import { asJson, type Db, one, START_OF } from "../lib/db.ts";
import { fail, RIDER, type Router, type User } from "../lib/http.ts";
import { getSettings, ORDER_SELECT, serializeOrder } from "../lib/store.ts";
import { check } from "../lib/validate.ts";

/** Rider disponible con menos pedidos activos que no haya rechazado ya este pedido. */
async function nextRider(db: Db, excluded: number[]): Promise<{ id: number; name: string } | null> {
  return one(
    db,
    `SELECT u.id, u.name
     FROM tc.users u
     LEFT JOIN tc.orders o ON o.rider_id = u.id AND o.rider_status IN ('asignado', 'aceptado', 'recogido')
     WHERE u.role = 'rider' AND u.active AND u.available AND u.password_hash IS NOT NULL
       AND NOT (u.id = ANY($1::int[]))
     GROUP BY u.id, u.name
     ORDER BY count(o.id), u.id
     LIMIT 1`,
    [`{${excluded.join(",")}}`],
  );
}

type RiderAction = (db: Db, order: any, rider: User) => Promise<Record<string, unknown>>;

const RIDER_ACTIONS: Record<string, RiderAction> = {
  async accept(db, order) {
    if (order.rider_status !== "asignado") fail(409, "Este pedido ya fue aceptado");
    await db.query("UPDATE tc.orders SET rider_status = 'aceptado', accepted_at = now() WHERE id = $1", [order.id]);
    return {};
  },

  /** Al rechazar, el pedido pasa automáticamente al siguiente rider disponible. */
  async reject(db, order, rider) {
    if (!["asignado", "aceptado"].includes(order.rider_status)) fail(409, "Ya no podés rechazar este pedido");
    const rejectedBy = [...new Set([...asJson<number[]>(order.rejected_by, []), rider.id])];
    const next = await nextRider(db, rejectedBy);
    await db.query(
      `UPDATE tc.orders
       SET rejected_by = $1::text::jsonb, rider_id = $2, rider_status = $3,
           assigned_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() END, accepted_at = NULL
       WHERE id = $4`,
      [JSON.stringify(rejectedBy), next?.id ?? null, next ? "asignado" : null, order.id],
    );
    return { reassignedTo: next?.name ?? null };
  },

  async pickup(db, order) {
    if (order.rider_status !== "aceptado") fail(409, "Primero aceptá el pedido");
    await db.query("UPDATE tc.orders SET rider_status = 'recogido', picked_at = now(), status = 'en_camino' WHERE id = $1", [order.id]);
    return {};
  },

  async deliver(db, order) {
    if (order.rider_status !== "recogido") fail(409, "Primero marcá que recogiste el pedido");
    const { riderFee } = await getSettings(db);
    await db.query(
      "UPDATE tc.orders SET rider_status = 'entregado', status = 'entregado', delivered_at = now(), rider_fee = $1 WHERE id = $2",
      [riderFee, order.id],
    );
    return { earned: riderFee };
  },
};

export function riderRoutes(router: Router): void {
  router.on("GET", "/api/rider/dashboard", RIDER, async ({ db, user }) => {
    const settings = await getSettings(db);
    const period = (since: string) =>
      one(
        db,
        `SELECT count(*)::int AS count, coalesce(sum(rider_fee), 0)::float8 AS earnings
         FROM tc.orders WHERE rider_id = $1 AND rider_status = 'entregado' AND delivered_at >= ${since}`,
        [user.id],
      );

    const [active, history, today, week, month, total, times] = await Promise.all([
      db.query(`${ORDER_SELECT} WHERE o.rider_id = $1 AND o.rider_status IN ('asignado', 'aceptado', 'recogido') ORDER BY o.assigned_at`, [user.id]),
      db.query(`${ORDER_SELECT} WHERE o.rider_id = $1 AND o.rider_status = 'entregado' ORDER BY o.delivered_at DESC LIMIT 60`, [user.id]),
      period(START_OF.day),
      period(START_OF.week),
      period(START_OF.month),
      period("'-infinity'::timestamptz"),
      // Tiempo de entrega = desde que acepta hasta que entrega.
      one(
        db,
        `SELECT min(extract(epoch FROM delivered_at - accepted_at))::int AS record,
                avg(extract(epoch FROM delivered_at - accepted_at))::int AS average
         FROM tc.orders WHERE rider_id = $1 AND rider_status = 'entregado' AND accepted_at IS NOT NULL`,
        [user.id],
      ),
    ]);

    return {
      rider: { id: user.id, name: user.name, phone: user.phone, available: user.available },
      fee: settings.riderFee,
      storeWhatsapp: settings.whatsapp,
      active: active.map(serializeOrder),
      history: history.map(serializeOrder),
      stats: { today, week, month, total, recordSeconds: times?.record ?? null, averageSeconds: times?.average ?? null },
    };
  });

  router.on("POST", "/api/rider/availability", RIDER, async ({ db, body, user }) => {
    const available = check.bool((await body()).available);
    await db.query("UPDATE tc.users SET available = $1 WHERE id = $2", [available, user.id]);
    return { available };
  });

  router.on("POST", "/api/rider/orders/:id/:action", RIDER, async ({ db, params, user }) => {
    const action = RIDER_ACTIONS[params.action];
    if (!action) fail(404, "Acción no válida");
    const id = check.int(params.id, "El pedido", { min: 1 });
    const result = await db.tx(async (tx) => {
      const order = await one(tx, "SELECT * FROM tc.orders WHERE id = $1 FOR UPDATE", [id]);
      if (!order) fail(404, "Pedido no encontrado");
      if (Number(order.rider_id) !== user.id) fail(403, "Este pedido no está asignado a vos");
      return action(tx, order, user);
    });
    return { ok: true, ...result };
  });
}
