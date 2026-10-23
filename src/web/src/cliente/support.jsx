/**
 * Seguimiento de pedidos y formulario de ayuda / reporte de problemas.
 */
import { useEffect, useState } from "react";
import { dateTime, money } from "../shared/format.js";
import { Icon } from "../shared/icons.jsx";
import { ErrorBox, Field, Modal, useToast } from "../shared/ui.jsx";
import { helpMessage, openWhatsApp } from "../shared/whatsapp.js";

const TRACK_STEPS = [
  { key: "nuevo", label: "Recibido", icon: "receipt" },
  { key: "confirmado", label: "Confirmado", icon: "check" },
  { key: "en_camino", label: "En camino", icon: "bike" },
  { key: "entregado", label: "Entregado", icon: "heart" },
];

function TrackResult({ order }) {
  if (order.status === "cancelado") {
    return <div className="alert danger"><Icon name="ban" /> Este pedido fue cancelado. Escribinos si tenés dudas.</div>;
  }
  const steps = order.delivery ? TRACK_STEPS : TRACK_STEPS.filter((s) => s.key !== "en_camino").map((s) => (s.key === "entregado" ? { ...s, label: "Retirado" } : s));
  const current = steps.findIndex((s) => s.key === order.status);
  return (
    <div className="stack" style={{ "--gap": "14px" }}>
      <div className="track">
        {steps.map((s, i) => (
          <div key={s.key} className={`track-step ${i <= current ? "done" : ""} ${i === current ? "current" : ""}`}>
            <span className="track-dot"><Icon name={s.icon} size={15} /></span>
            <span className="tiny">{s.label}</span>
          </div>
        ))}
      </div>
      {order.riderName && order.status === "en_camino" && <div className="alert info"><Icon name="bike" /> {order.riderName} va en camino con tu pedido.</div>}
      {order.status === "confirmado" && order.riderName && <div className="alert info"><Icon name="bike" /> {order.riderName} va a llevar tu pedido.</div>}
      <div className="pos-totals">
        {order.items.map((it, i) => <div key={i} className="row between small"><span>{it.qty}x {it.name}</span><span className="mono">{money(it.lineTotal)}</span></div>)}
        <div className="row between"><strong>Total</strong><strong className="mono">{money(order.total)}</strong></div>
      </div>
      <div className="tiny faint">Pedido hecho el {dateTime(order.createdAt)}{order.deliveredAt ? ` · entregado el ${dateTime(order.deliveredAt)}` : ""}</div>
    </div>
  );
}

export function TrackModal({ api, initialCode = "", myOrders, onHelp, onClose }) {
  const [code, setCode] = useState(initialCode);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const lookup = async (value = code) => {
    const clean = value.trim().toUpperCase().replace(/^#/, "");
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      setOrder(await api.get(`/api/public/orders/${encodeURIComponent(clean)}`));
      setCode(clean);
    } catch (err) {
      setOrder(null);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialCode) lookup(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title="Seguí tu pedido" onClose={onClose}>
      <form className="row" onSubmit={(e) => { e.preventDefault(); lookup(); }}>
        <input className="input mono grow" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Número de pedido (ej.: K7M2QX)" maxLength={7} autoCapitalize="characters" />
        <button className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : "Buscar"}</button>
      </form>
      {myOrders.length > 0 && !order && (
        <div className="stack" style={{ "--gap": "6px" }}>
          <span className="tiny muted">Tus pedidos recientes</span>
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {myOrders.map((o) => <button key={o.code} className="chip mono" onClick={() => lookup(o.code)}>#{o.code} · {money(o.total)}</button>)}
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      {order && (
        <>
          <TrackResult order={order} />
          <button className="btn btn-ghost btn-sm" onClick={() => onHelp(order.code)}><Icon name="alert" size={14} /> ¿Algún problema con este pedido?</button>
        </>
      )}
    </Modal>
  );
}

export function HelpModal({ api, store, contact, setContact, orderCode = "", initialType = "ayuda", onClose }) {
  const toast = useToast();
  const [type, setType] = useState(orderCode ? "reporte" : initialType);
  const [message, setMessage] = useState("");
  const [code, setCode] = useState(orderCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/public/inquiries", { type, name: contact.name, phone: contact.phone, message, orderCode: code || undefined });
      toast(type === "reporte" ? "Reporte enviado. Lo revisamos y te escribimos." : "Consulta enviada. Te respondemos pronto.");
      openWhatsApp(store.whatsapp, helpMessage(type, contact.name, message, code));
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="¿En qué te ayudamos?" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <button type="button" className={`option ${type === "ayuda" ? "active" : ""}`} onClick={() => setType("ayuda")}><Icon name="help" /> Tengo una consulta</button>
          <button type="button" className={`option ${type === "reporte" ? "active" : ""}`} onClick={() => setType("reporte")}><Icon name="alert" /> Reportar un problema</button>
        </div>
        <div className="grid-2">
          <Field label="Tu nombre"><input className="input" required value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} /></Field>
          <Field label="Tu WhatsApp"><input className="input" required inputMode="tel" value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} placeholder="9999-9999" /></Field>
        </div>
        {type === "reporte" && (
          <Field label="Número de pedido (si aplica)"><input className="input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={7} /></Field>
        )}
        <Field label={type === "reporte" ? "¿Qué pasó?" : "Tu consulta"}>
          <textarea className="textarea" required value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} placeholder={type === "reporte" ? "Contanos el problema con tu pedido o la entrega" : "Ej.: ¿Esta tarjeta es compatible con mi fuente?"} />
        </Field>
        <ErrorBox error={error} />
        <button className="btn btn-wa btn-lg btn-block" disabled={busy}>{busy ? <span className="spinner" /> : <><Icon name="send" /> Enviar</>}</button>
      </form>
    </Modal>
  );
}
