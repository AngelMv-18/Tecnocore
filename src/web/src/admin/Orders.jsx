/**
 * Pedidos de la tienda en línea: concretar la venta, avisar al cliente por
 * WhatsApp, asignar rider (con mensaje listo), entregar o cancelar.
 */
import { useEffect, useState } from "react";
import { dateTime, money, ORDER_STATUS, PAYMENT_LABEL, phone, relative, RIDER_STATUS } from "../shared/format.js";
import { Icon } from "../shared/icons.jsx";
import { PageHead } from "../shared/Shell.jsx";
import { Badge, Confirm, Empty, ErrorBox, Loading, Modal, useAction, useLoader } from "../shared/ui.jsx";
import { CUSTOMER_TEMPLATES, mapsLink, riderAssignmentMessage, telLink, waLink } from "../shared/whatsapp.js";

const FILTERS = [
  ["activos", "Activos"],
  ["nuevo", "Nuevos"],
  ["confirmado", "Concretados"],
  ["en_camino", "En camino"],
  ["entregado", "Entregados"],
  ["cancelado", "Cancelados"],
  ["todos", "Todos"],
];

function WaButton({ to, text, label, className = "btn btn-sm btn-wa" }) {
  return <a className={className} href={waLink(to, text)} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={15} /> {label}</a>;
}

function AssignRider({ order, riders, store, onAssign, onClose }) {
  const available = riders.filter((r) => r.active && r.hasPassword);
  const [riderId, setRiderId] = useState(available.find((r) => r.available)?.id ?? available[0]?.id);
  const [busy, setBusy] = useState(false);
  const rider = available.find((r) => r.id === riderId);

  const assign = async () => {
    setBusy(true);
    const ok = await onAssign(riderId);
    setBusy(false);
    if (ok) window.open(waLink(rider.phone, riderAssignmentMessage(order, store.storeName)), "_blank", "noopener");
  };

  return (
    <Modal title={`Asignar rider · #${order.code}`} onClose={onClose}>
      {available.length === 0 ? (
        <Empty icon="bike" title="No hay riders">Creá uno en Equipo.</Empty>
      ) : (
        <>
          <div className="stack" style={{ "--gap": "8px" }}>
            {available.map((r) => (
              <button key={r.id} className={`option ${riderId === r.id ? "active" : ""}`} style={{ justifyContent: "space-between" }} onClick={() => setRiderId(r.id)}>
                <span className="row"><Icon name="bike" size={16} /> {r.name}</span>
                <span className="row" style={{ "--gap": "6px" }}>
                  {r.stats?.active > 0 && <Badge tone="info">{r.stats.active} en curso</Badge>}
                  <Badge tone={r.available ? "ok" : ""}>{r.available ? "Disponible" : "No disponible"}</Badge>
                </span>
              </button>
            ))}
          </div>
          <p className="tiny muted">Al asignar se abre WhatsApp con el pedido listo para mandárselo al rider. Él lo acepta desde su panel; si lo rechaza, pasa solo al siguiente disponible.</p>
          <button className="btn btn-primary btn-lg btn-block" disabled={!rider || busy} onClick={assign}>{busy ? <span className="spinner" /> : <>Asignar y avisar por WhatsApp</>}</button>
        </>
      )}
    </Modal>
  );
}

function OrderCard({ order, store, riders, act }) {
  const [assigning, setAssigning] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const st = ORDER_STATUS[order.status];
  const templateKey = order.status === "nuevo" ? null : order.status === "confirmado" ? (order.delivery ? "confirmado" : "listo") : order.status;
  const closed = order.status === "entregado" || order.status === "cancelado";

  return (
    <article className={`card order-card ${order.status === "nuevo" && !order.seen ? "unseen" : ""}`} onMouseEnter={() => order.status === "nuevo" && !order.seen && act(order, "seen", undefined, true)}>
      <div className="row between top">
        <div>
          <div className="row" style={{ "--gap": "8px" }}>
            <span className="mono strong">#{order.code}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
            {order.status === "nuevo" && !order.seen && <Badge tone="accent">NUEVO</Badge>}
          </div>
          <div className="tiny faint" style={{ marginTop: 2 }} title={dateTime(order.createdAt)}>{relative(order.createdAt)}</div>
        </div>
        <div className="mono strong" style={{ fontSize: 18 }}>{money(order.total)}</div>
      </div>

      <div className="order-grid">
        <div className="stack" style={{ "--gap": "4px" }}>
          <div className="strong">{order.customer.name}</div>
          <div className="row small muted" style={{ "--gap": "10px" }}>
            <a href={telLink(order.customer.phone)} className="link"><Icon name="phone" size={13} /> {phone(order.customer.phone)}</a>
          </div>
          <div className="small row" style={{ "--gap": "6px" }}>
            <Icon name={order.delivery ? "truck" : "store"} size={14} className="faint" />
            {order.delivery ? <a className="link" href={mapsLink(order.address)} target="_blank" rel="noreferrer">{order.address}</a> : "Retira en tienda"}
          </div>
          <div className="small row" style={{ "--gap": "6px" }}><Icon name={order.paymentMethod === "efectivo" ? "cash" : "bank"} size={14} className="faint" /> {PAYMENT_LABEL[order.paymentMethod]}</div>
          {order.notes && <div className="small muted">📝 {order.notes}</div>}
        </div>
        <div className="stack" style={{ "--gap": "3px" }}>
          {order.items.map((it, i) => (
            <div key={i} className="row between small"><span><span className="mono muted">{it.qty}x</span> {it.name}</span><span className="mono muted">{money(it.lineTotal)}</span></div>
          ))}
        </div>
      </div>

      {order.delivery && order.rider && (
        <div className="row small rider-line">
          <Icon name="bike" size={15} />
          <span className="grow">{order.rider.name}</span>
          {order.riderStatus && <Badge tone={RIDER_STATUS[order.riderStatus].tone}>{RIDER_STATUS[order.riderStatus].label}</Badge>}
          <a className="icon-btn sm" href={waLink(order.rider.phone, riderAssignmentMessage(order, store.storeName))} target="_blank" rel="noreferrer" aria-label="WhatsApp al rider"><Icon name="whatsapp" size={14} /></a>
        </div>
      )}

      <div className="row wrap" style={{ "--gap": "8px" }}>
        {order.status === "nuevo" && (
          <>
            <button className="btn btn-ok btn-sm" onClick={() => act(order, "confirm", "Venta concretada: se descontó el stock")}><Icon name="check" size={15} /> Concretar venta</button>
            <WaButton to={order.customer.phone} text={`Hola ${order.customer.name} 👋, te saluda *${store.storeName}*. Recibimos tu pedido #${order.code}. `} label="Escribir al cliente" />
            {order.paymentMethod === "transferencia" && <WaButton to={order.customer.phone} text={CUSTOMER_TEMPLATES.transferencia(order, store.storeName, store.banks.filter((b) => b.account))} label="Mandar cuentas" className="btn btn-sm btn-ghost" />}
          </>
        )}
        {templateKey && !closed && <WaButton to={order.customer.phone} text={CUSTOMER_TEMPLATES[templateKey](order, store.storeName)} label="Avisar al cliente" />}
        {order.status === "entregado" && <WaButton to={order.customer.phone} text={CUSTOMER_TEMPLATES.entregado(order, store.storeName)} label="Agradecer" className="btn btn-sm btn-ghost" />}
        {order.status === "confirmado" && order.delivery && (
          order.rider
            ? (order.riderStatus === "asignado" || order.riderStatus === "aceptado") && <button className="btn btn-sm btn-ghost" onClick={() => act(order, "unassign", "Rider quitado")}>Quitar rider</button>
            : <button className="btn btn-sm btn-primary" onClick={() => setAssigning(true)}><Icon name="bike" size={15} /> Asignar rider</button>
        )}
        {(order.status === "confirmado" || order.status === "en_camino") && (
          <button className="btn btn-sm btn-ok" onClick={() => act(order, "deliver", "Pedido marcado como entregado")}><Icon name="check" size={15} /> {order.delivery ? "Entregado" : "Ya lo retiró"}</button>
        )}
        {!closed && <button className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }} onClick={() => setConfirmCancel(true)}>Cancelar</button>}
      </div>

      {assigning && <AssignRider order={order} riders={riders} store={store} onClose={() => setAssigning(false)} onAssign={async (riderId) => { const ok = await act(order, "assign", "Rider asignado", false, { riderId }); if (ok) setAssigning(false); return ok; }} />}
      {confirmCancel && (
        <Confirm title={`¿Cancelar el pedido #${order.code}?`} message={order.saleId ? "Se devuelve el stock y se anula la venta registrada." : "El pedido queda como cancelado."} confirmLabel="Sí, cancelar" danger onConfirm={() => act(order, "cancel", "Pedido cancelado")} onClose={() => setConfirmCancel(false)} />
      )}
    </article>
  );
}

export function Orders({ api, store, refreshKey, onChange }) {
  const [filter, setFilter] = useState("activos");
  const [run] = useAction();
  const orders = useLoader(() => api.get(`/api/admin/orders?status=${filter}`), [filter, refreshKey], { pollMs: 20000 });
  const riders = useLoader(() => api.get("/api/admin/users").then((r) => r.users.filter((u) => u.role === "rider")), [refreshKey]);

  useEffect(() => { onChange?.(); }, [orders.data]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Ejecuta una acción sobre el pedido y lo reemplaza en la lista. */
  const act = async (order, action, message, silent = false, body = {}) => {
    const fn = () => api.post(`/api/admin/orders/${order.id}/${action}`, body);
    const result = silent ? await fn().catch(() => null) : await run(fn, message);
    if (result?.order) {
      orders.setData((d) => ({ ...d, orders: d.orders.map((o) => (o.id === order.id ? result.order : o)) }));
      if (!silent) riders.reload(true);
    }
    return Boolean(result);
  };

  return (
    <>
      <PageHead title="Pedidos" subtitle="Lo que piden los clientes desde la tienda. Se actualiza solo.">
        <button className="btn btn-ghost btn-sm" onClick={() => orders.reload()}><Icon name="refresh" size={14} /> Actualizar</button>
      </PageHead>
      <div className="chips scroll-x" style={{ marginBottom: 14 }}>
        {FILTERS.map(([k, label]) => <button key={k} className={`chip ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>{label}</button>)}
      </div>
      {orders.loading && !orders.data ? <Loading /> : orders.error && !orders.data ? <ErrorBox error={orders.error} onRetry={orders.reload} /> : orders.data.orders.length === 0 ? (
        <Empty icon="cart" title="No hay pedidos acá">Cuando un cliente haga un pedido, aparece al instante con aviso y sonido.</Empty>
      ) : (
        <div className="stack" style={{ "--gap": "12px" }}>
          {orders.data.orders.map((o) => <OrderCard key={o.id} order={o} store={store} riders={riders.data ?? []} act={act} />)}
        </div>
      )}
    </>
  );
}
