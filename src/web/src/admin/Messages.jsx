/**
 * Módulo WhatsApp: todo lo que escriben los clientes desde la tienda
 * (interés en productos, pedidos de ayuda y reportes), con respuestas listas
 * para mandar por WhatsApp en un toque. Los reportes sobre una entrega se le
 * pueden reenviar al rider.
 */
import { useState } from "react";
import { phone, relative } from "../shared/format.js";
import { Icon } from "../shared/icons.jsx";
import { PageHead } from "../shared/Shell.jsx";
import { Badge, Empty, ErrorBox, Loading, Modal, useAction, useLoader } from "../shared/ui.jsx";
import { CUSTOMER_TEMPLATES, INQUIRY_TEMPLATES, riderReportMessage, waLink } from "../shared/whatsapp.js";

const TYPES = {
  interes: { label: "Le interesa", icon: "heart", tone: "violet" },
  ayuda: { label: "Pide ayuda", icon: "help", tone: "info" },
  reporte: { label: "Reporte", icon: "alert", tone: "danger" },
};

/** Respuestas rápidas que el admin puede editar antes de abrir WhatsApp. */
function Reply({ inquiry, store, onSent, onClose }) {
  const quick = [
    ["Respuesta sugerida", INQUIRY_TEMPLATES[inquiry.type](inquiry, store.storeName)],
    ["Hay stock, ¿lo apartamos?", `Hola ${inquiry.customer.name} 👋, sí tenemos${inquiry.product ? ` *${inquiry.product.name}*` : ""} disponible. ¿Querés que te lo apartemos o te lo enviamos? — *${store.storeName}*`],
    ["Datos para transferir", CUSTOMER_TEMPLATES.transferencia({ customer: inquiry.customer, code: inquiry.orderCode ?? "—", total: 0 }, store.storeName, store.banks.filter((b) => b.account)).replace(" (*L. 0.00*)", "")],
    ["Saludo", `Hola ${inquiry.customer.name} 👋, te saluda *${store.storeName}*. ¿En qué te podemos ayudar?`],
  ];
  const [text, setText] = useState(quick[0][1]);

  return (
    <Modal title={`Responder a ${inquiry.customer.name}`} onClose={onClose}>
      <div className="chips" style={{ flexWrap: "wrap" }}>
        {quick.map(([label, t]) => <button key={label} className={`chip ${text === t ? "active" : ""}`} onClick={() => setText(t)}>{label}</button>)}
      </div>
      <textarea className="textarea" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
      <a className="btn btn-wa btn-lg btn-block" href={waLink(inquiry.customer.phone, text)} target="_blank" rel="noreferrer" onClick={onSent}>
        <Icon name="whatsapp" /> Abrir WhatsApp con este mensaje
      </a>
      <p className="tiny faint">Al enviarlo, la consulta queda marcada como atendida.</p>
    </Modal>
  );
}

function InquiryCard({ inquiry, store, onStatus, onReply }) {
  const t = TYPES[inquiry.type];
  const done = inquiry.status === "atendido";
  return (
    <article className={`card inquiry ${done ? "done" : ""} ${inquiry.type}`}>
      <div className="row top">
        <div className={`inquiry-icon ${t.tone}`}><Icon name={t.icon} size={18} /></div>
        <div className="grow stack" style={{ "--gap": "4px", minWidth: 0 }}>
          <div className="row between wrap" style={{ "--gap": "6px" }}>
            <span className="row" style={{ "--gap": "8px" }}>
              <strong>{inquiry.customer.name}</strong>
              <Badge tone={t.tone}>{t.label}</Badge>
              {done && <Badge tone="ok">Atendido</Badge>}
            </span>
            <span className="tiny faint">{relative(inquiry.createdAt)}</span>
          </div>
          {inquiry.customer.phone ? <span className="tiny muted mono">{phone(inquiry.customer.phone)}</span> : <span className="tiny faint">Sin teléfono (solo marcó interés)</span>}
          {inquiry.product && <div className="small"><Icon name="tag" size={13} className="faint" /> {inquiry.product.name}</div>}
          {inquiry.orderCode && <div className="small"><Icon name="receipt" size={13} className="faint" /> Pedido <span className="mono">#{inquiry.orderCode}</span>{inquiry.rider && <> · rider <strong>{inquiry.rider.name}</strong></>}</div>}
          {inquiry.message && <p className="inquiry-message">{inquiry.message}</p>}
        </div>
      </div>
      <div className="row wrap" style={{ "--gap": "8px" }}>
        {inquiry.customer.phone && <button className="btn btn-sm btn-wa" onClick={() => onReply(inquiry)}><Icon name="whatsapp" size={15} /> Responder</button>}
        {inquiry.type === "reporte" && inquiry.rider?.phone && (
          <a className="btn btn-sm btn-danger" href={waLink(inquiry.rider.phone, riderReportMessage(inquiry, store.storeName))} target="_blank" rel="noreferrer"><Icon name="bike" size={15} /> Avisar al rider</a>
        )}
        <button className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }} onClick={() => onStatus(inquiry, done ? "nuevo" : "atendido")}>
          <Icon name={done ? "refresh" : "check"} size={14} /> {done ? "Reabrir" : "Marcar atendido"}
        </button>
      </div>
    </article>
  );
}

export function Messages({ api, store, refreshKey, onChange }) {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("nuevo");
  const [replying, setReplying] = useState(null);
  const [run] = useAction();
  const { data, error, loading, reload, setData } = useLoader(
    () => api.get(`/api/admin/inquiries?status=${status}${type ? `&type=${type}` : ""}`),
    [type, status, refreshKey],
    { pollMs: 20000 },
  );

  const setInquiryStatus = (inquiry, next) =>
    run(async () => {
      await api.patch(`/api/admin/inquiries/${inquiry.id}`, { status: next });
      setData((d) => ({ inquiries: status ? d.inquiries.filter((i) => i.id !== inquiry.id) : d.inquiries.map((i) => (i.id === inquiry.id ? { ...i, status: next } : i)) }));
      onChange?.();
    }, next === "atendido" ? "Marcado como atendido" : "Consulta reabierta");

  const list = data?.inquiries ?? [];
  const interestByProduct = Object.values(
    list.filter((i) => i.type === "interes" && i.product).reduce((acc, i) => {
      acc[i.product.name] = { name: i.product.name, count: (acc[i.product.name]?.count ?? 0) + 1 };
      return acc;
    }, {}),
  ).sort((a, b) => b.count - a.count);

  return (
    <>
      <PageHead title="Mensajes · WhatsApp" subtitle="Qué les interesa a tus clientes y quién necesita ayuda. Respondé en un toque.">
        <a className="btn btn-sm btn-wa" href={waLink(store.whatsapp)} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={15} /> Abrir mi WhatsApp</a>
      </PageHead>
      <div className="row wrap between" style={{ marginBottom: 14 }}>
        <div className="chips scroll-x">
          <button className={`chip ${type === "" ? "active" : ""}`} onClick={() => setType("")}>Todos</button>
          {Object.entries(TYPES).map(([k, t]) => <button key={k} className={`chip ${type === k ? "active" : ""}`} onClick={() => setType(k)}><Icon name={t.icon} size={13} /> {t.label}</button>)}
        </div>
        <div className="chips">
          {[["nuevo", "Sin atender"], ["atendido", "Atendidos"], ["", "Todos"]].map(([k, l]) => <button key={k || "all"} className={`chip ${status === k ? "active" : ""}`} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
      </div>

      {interestByProduct.length > 0 && (
        <div className="card flat row wrap" style={{ marginBottom: 14, "--gap": "8px" }}>
          <span className="small muted row" style={{ "--gap": "6px" }}><Icon name="heart" size={14} /> Interés en esta lista:</span>
          {interestByProduct.slice(0, 6).map((p) => <Badge key={p.name} tone="violet">{p.name} · {p.count}</Badge>)}
        </div>
      )}

      {loading && !data ? <Loading /> : error && !data ? <ErrorBox error={error} onRetry={reload} /> : list.length === 0 ? (
        <Empty icon="message" title={status === "nuevo" ? "Todo atendido 🎉" : "No hay mensajes"}>Cuando un cliente toque “Me interesa” o pida ayuda, aparece acá con aviso.</Empty>
      ) : (
        <div className="stack" style={{ "--gap": "10px" }}>
          {list.map((i) => <InquiryCard key={i.id} inquiry={i} store={store} onStatus={setInquiryStatus} onReply={setReplying} />)}
        </div>
      )}
      {replying && (
        <Reply
          inquiry={replying}
          store={store}
          onClose={() => setReplying(null)}
          onSent={() => { if (replying.status === "nuevo") setInquiryStatus(replying, "atendido"); setReplying(null); }}
        />
      )}
    </>
  );
}
