/**
 * Panel del rider: pedidos pendientes (aceptar → recoger → entregar),
 * historial de entregas, tiempo récord y ganancias.
 */
import { useEffect, useRef, useState } from "react";
import { dateTime, duration, minutesBetween, money, PAYMENT_LABEL, phone, RIDER_STATUS } from "../shared/format.js";
import { Icon } from "../shared/icons.jsx";
import { beep, notify } from "../shared/media.js";
import { mount, Portal } from "../shared/Portal.jsx";
import { PageHead, Shell, useHashTab } from "../shared/Shell.jsx";
import { Badge, Confirm, Empty, ErrorBox, Loading, Stat, Switch, useAction, useLoader, useToast } from "../shared/ui.jsx";
import { mapsLink, telLink, waLink } from "../shared/whatsapp.js";

const TABS = [
  { id: "pedidos", label: "Pendientes", icon: "box" },
  { id: "historial", label: "Entregados", icon: "check" },
  { id: "ganancias", label: "Ganancias", icon: "wallet" },
];

/** Cronómetro en vivo desde una fecha. */
function useElapsed(since) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since ? Math.max(0, Math.round((now - new Date(since).getTime()) / 1000)) : null;
}

function Timer({ since, record }) {
  const seconds = useElapsed(since);
  if (seconds == null) return null;
  const beating = record != null && seconds < record;
  return (
    <div className={`rider-timer ${beating ? "record" : ""}`}>
      <Icon name="clock" size={15} />
      <span className="mono">{duration(seconds)}</span>
      {record != null && <span className="tiny">{beating ? "¡vas para récord!" : `récord ${duration(record)}`}</span>}
    </div>
  );
}

const STEPS = ["asignado", "aceptado", "recogido", "entregado"];

function ActiveOrder({ order, fee, record, storeWhatsapp, onAction, busy }) {
  const [confirmReject, setConfirmReject] = useState(false);
  const step = STEPS.indexOf(order.riderStatus);
  const status = RIDER_STATUS[order.riderStatus];
  const cash = order.paymentMethod === "efectivo";

  return (
    <article className={`card rider-order ${order.riderStatus === "asignado" ? "new" : ""}`}>
      <div className="row between">
        <div>
          <div className="mono tiny faint">PEDIDO #{order.code}</div>
          <h3 style={{ fontSize: 18 }}>{order.customer.name}</h3>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="steps" aria-label={`Paso ${step + 1} de 4`}>{STEPS.map((s, i) => <i key={s} className={i <= step ? "done" : ""} />)}</div>

      <a className="rider-address" href={mapsLink(order.address)} target="_blank" rel="noreferrer">
        <Icon name="map" size={18} />
        <span className="grow">{order.address}</span>
        <Icon name="chevronRight" size={16} />
      </a>

      <div className="stack" style={{ "--gap": "4px" }}>
        {order.items.map((it, i) => (
          <div key={i} className="row small"><span className="mono muted">{it.qty}x</span><span className="grow">{it.name}</span></div>
        ))}
        {order.notes && <div className="tiny muted">📝 {order.notes}</div>}
      </div>

      <div className="rider-money">
        <div>
          <div className="tiny muted">{cash ? "Cobrar al cliente" : "Pagado por transferencia"}</div>
          <div className="mono strong" style={{ fontSize: 20, color: cash ? "var(--warn)" : "var(--ok)" }}>{cash ? money(order.total) : "L. 0.00"}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="tiny muted">Tu ganancia</div>
          <div className="mono strong" style={{ fontSize: 20, color: "var(--ok)" }}>+{money(fee)}</div>
        </div>
      </div>

      {order.riderStatus === "recogido" && <Timer since={order.acceptedAt} record={record} />}

      <div className="row" style={{ "--gap": "8px" }}>
        <a className="btn btn-sm btn-ghost grow" href={telLink(order.customer.phone)}><Icon name="phone" size={15} /> Llamar</a>
        <a className="btn btn-sm btn-wa grow" href={waLink(order.customer.phone, `Hola ${order.customer.name} 👋, soy tu repartidor de Tecnocore con el pedido #${order.code}.`)} target="_blank" rel="noreferrer">
          <Icon name="whatsapp" size={15} /> Cliente
        </a>
        <a className="btn btn-sm btn-ghost grow" href={waLink(storeWhatsapp, `Hola, soy el rider del pedido #${order.code}. `)} target="_blank" rel="noreferrer"><Icon name="store" size={15} /> Tienda</a>
      </div>
      <div className="tiny faint mono">{phone(order.customer.phone)}</div>

      {order.riderStatus === "asignado" && (
        <div className="grid-2">
          <button className="btn btn-danger btn-lg" disabled={busy} onClick={() => setConfirmReject(true)}><Icon name="close" /> Rechazar</button>
          <button className="btn btn-ok btn-lg" disabled={busy} onClick={() => onAction(order, "accept")}><Icon name="check" /> Aceptar</button>
        </div>
      )}
      {order.riderStatus === "aceptado" && (
        <div className="grid-2">
          <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmReject(true)}>No puedo llevarlo</button>
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => onAction(order, "pickup")}><Icon name="box" /> Ya lo recogí</button>
        </div>
      )}
      {order.riderStatus === "recogido" && (
        <button className="btn btn-rgb btn-lg btn-block" disabled={busy} onClick={() => onAction(order, "deliver")}><Icon name="check" /> Marcar como entregado</button>
      )}

      {confirmReject && (
        <Confirm
          title="¿Rechazar este pedido?"
          message="Se le pasa automáticamente al siguiente rider disponible."
          confirmLabel="Sí, rechazar"
          danger
          onConfirm={() => onAction(order, "reject")}
          onClose={() => setConfirmReject(false)}
        />
      )}
    </article>
  );
}

function Pending({ data, onAction, busy, onToggle }) {
  const { rider, active, fee, stats, storeWhatsapp } = data;
  return (
    <>
      <PageHead title={`Hola, ${rider.name.split(" ")[0]} 🏍️`} subtitle="Tus pedidos para entregar." />
      <div className={`card rider-availability ${rider.available ? "on" : ""}`}>
        <div className="grow">
          <strong>{rider.available ? "Estás disponible" : "No estás disponible"}</strong>
          <div className="small muted">{rider.available ? "Te pueden asignar pedidos nuevos." : "No te van a llegar pedidos nuevos."}</div>
        </div>
        <Switch checked={rider.available} onChange={onToggle} />
      </div>
      <div className="grid" style={{ "--min": "140px", margin: "14px 0" }}>
        <Stat icon="wallet" label="Ganado hoy" value={money(stats.today.earnings)} mono sub={`${stats.today.count} entregas`} />
        <Stat icon="trophy" label="Tiempo récord" value={duration(stats.recordSeconds)} mono />
      </div>
      {active.length === 0 ? (
        <Empty icon="bike" title="No tenés pedidos pendientes">Cuando te asignen uno vas a escuchar un aviso. Esta pantalla se actualiza sola.</Empty>
      ) : (
        <div className="stack" style={{ "--gap": "14px" }}>
          {active.map((o) => <ActiveOrder key={o.id} order={o} fee={fee} record={stats.recordSeconds} storeWhatsapp={storeWhatsapp} onAction={onAction} busy={busy} />)}
        </div>
      )}
    </>
  );
}

function History({ data }) {
  const { history, stats } = data;
  return (
    <>
      <PageHead title="Entregados" subtitle={`${stats.total.count} entregas en total`} />
      {history.length === 0 ? (
        <Empty icon="check" title="Todavía no hiciste entregas" />
      ) : (
        <div className="card" style={{ padding: "4px 16px" }}>
          {history.map((o) => {
            const seconds = minutesBetween(o.acceptedAt, o.deliveredAt);
            const isRecord = seconds != null && seconds === stats.recordSeconds;
            return (
              <div key={o.id} className="list-row">
                <div className="grow">
                  <div className="small strong">{o.customer.name} <span className="mono faint tiny">#{o.code}</span></div>
                  <div className="tiny muted truncate">{o.address}</div>
                  <div className="tiny faint">{dateTime(o.deliveredAt)} · {PAYMENT_LABEL[o.paymentMethod]}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="mono small" style={{ color: "var(--ok)" }}>+{money(o.riderFee)}</div>
                  <div className={`tiny mono ${isRecord ? "" : "faint"}`} style={isRecord ? { color: "var(--warn)" } : undefined}>
                    {isRecord && "🏆 "}{duration(seconds)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function Earnings({ data }) {
  const { stats, fee } = data;
  const periods = [
    ["Hoy", stats.today],
    ["Esta semana", stats.week],
    ["Este mes", stats.month],
    ["Total", stats.total],
  ];
  return (
    <>
      <PageHead title="Mis ganancias" subtitle={`Ganás ${money(fee)} por cada entrega completada.`} />
      <div className="grid" style={{ "--min": "150px", marginBottom: 16 }}>
        {periods.map(([label, p]) => <Stat key={label} icon="wallet" label={label} value={money(p.earnings)} mono sub={`${p.count} ${p.count === 1 ? "entrega" : "entregas"}`} />)}
      </div>
      <div className="grid" style={{ "--min": "150px" }}>
        <Stat icon="trophy" label="Tiempo récord" value={duration(stats.recordSeconds)} mono sub="Entrega más rápida (desde que aceptás)" />
        <Stat icon="clock" label="Tiempo promedio" value={duration(stats.averageSeconds)} mono />
      </div>
    </>
  );
}

function RiderApp({ user, api, logout }) {
  const [tab, setTab] = useHashTab(TABS, "pedidos");
  const toast = useToast();
  const [run, busy] = useAction();
  const known = useRef(null);
  const { data, error, loading, reload, setData } = useLoader(() => api.get("/api/rider/dashboard"), [], { pollMs: 15000 });

  // Aviso con sonido cuando llega un pedido nuevo
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.active.map((o) => o.id));
    if (known.current) {
      const fresh = data.active.filter((o) => !known.current.has(o.id));
      if (fresh.length) {
        beep();
        toast(`Nuevo pedido asignado: #${fresh[0].code}`, "info", 6000);
        notify("Nuevo pedido 🏍️", `${fresh[0].customer.name} · ${fresh[0].address}`);
      }
    }
    known.current = ids;
  }, [data, toast]);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  }, []);

  if (loading && !data) return <Loading />;
  if (error && !data) return <div className="container" style={{ paddingTop: 30 }}><ErrorBox error={error} onRetry={reload} /></div>;

  const onAction = (order, action) =>
    run(async () => {
      const result = await api.post(`/api/rider/orders/${order.id}/${action}`);
      const messages = {
        accept: "Pedido aceptado. ¡A recogerlo!",
        pickup: "¡En camino! El cronómetro está corriendo.",
        deliver: `¡Entregado! Ganaste ${money(result.earned)} 💰`,
        reject: result.reassignedTo ? `Pedido pasado a ${result.reassignedTo}` : "Pedido rechazado. La tienda lo va a reasignar.",
      };
      toast(messages[action]);
      await reload(true);
    });

  const onToggle = (available) =>
    run(async () => {
      await api.post("/api/rider/availability", { available });
      setData((d) => ({ ...d, rider: { ...d.rider, available } }));
    }, available ? "Ahora estás disponible" : "Quedaste como no disponible");

  const tabs = TABS.map((t) => (t.id === "pedidos" ? { ...t, badge: data.active.length } : t));

  return (
    <Shell tabs={tabs} tab={tab} onTab={setTab} user={user} api={api} onLogout={logout} tag="Entregas">
      {tab === "pedidos" && <Pending data={data} onAction={onAction} busy={busy} onToggle={onToggle} />}
      {tab === "historial" && <History data={data} />}
      {tab === "ganancias" && <Earnings data={data} />}
    </Shell>
  );
}

mount(() => <Portal portal="rider">{(props) => <RiderApp {...props} />}</Portal>);
