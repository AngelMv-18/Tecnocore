/**
 * Ventas por rango de fechas: totales, detalle, comprobantes y exportación CSV.
 */
import { useState } from "react";
import { dateTime, hnDate, money, PAYMENT_LABEL } from "../shared/format.js";
import { Icon } from "../shared/icons.jsx";
import { downloadCsv } from "../shared/media.js";
import { ReceiptImage } from "../shared/Receipt.jsx";
import { PageHead } from "../shared/Shell.jsx";
import { Badge, Empty, ErrorBox, Loading, Modal, Stat, useLoader } from "../shared/ui.jsx";

const RANGES = {
  hoy: { label: "Hoy", from: () => hnDate(0) },
  semana: { label: "7 días", from: () => hnDate(-6) },
  mes: { label: "30 días", from: () => hnDate(-29) },
};

function SaleDetail({ sale, api, store, onClose }) {
  return (
    <Modal title={`Venta #${sale.id}`} onClose={onClose}>
      <div className="row between small muted wrap">
        <span>{dateTime(sale.createdAt)} · {sale.seller.name}</span>
        <span className="row" style={{ "--gap": "6px" }}>
          <Badge tone={sale.channel === "online" ? "violet" : ""}>{sale.channel === "online" ? "Tienda en línea" : "Punto de venta"}</Badge>
          <Badge tone={sale.paymentMethod === "efectivo" ? "ok" : "info"}>{PAYMENT_LABEL[sale.paymentMethod]}{sale.bank ? ` · ${sale.bank}` : ""}</Badge>
        </span>
      </div>
      {sale.voided && <div className="alert danger"><Icon name="ban" /> Venta anulada (pedido cancelado)</div>}
      <div>
        {sale.items.map((it, i) => (
          <div key={i} className="list-row small"><span className="mono muted">{it.qty}x</span><span className="grow">{it.name}</span><span className="mono">{money(it.lineTotal)}</span></div>
        ))}
      </div>
      <div className="pos-totals">
        <div className="row between small muted"><span>Subtotal</span><span className="mono">{money(sale.subtotal)}</span></div>
        {sale.discount > 0 && <div className="row between small muted"><span>Descuento</span><span className="mono">-{money(sale.discount)}</span></div>}
        {sale.tax > 0 && <div className="row between small muted"><span>ISV 15%</span><span className="mono">{money(sale.tax)}</span></div>}
        <div className="row between"><strong>Total</strong><strong className="mono">{money(sale.total)}</strong></div>
        {sale.cashReceived != null && <div className="row between small muted"><span>Recibido · vuelto</span><span className="mono">{money(sale.cashReceived)} · {money(sale.change)}</span></div>}
      </div>
      {sale.receiptUrl && <ReceiptImage api={api} sale={sale} store={{ name: store.storeName, whatsapp: store.whatsapp }} />}
    </Modal>
  );
}

export function Sales({ api, store, refreshKey }) {
  const [range, setRange] = useState("semana");
  const [custom, setCustom] = useState({ from: hnDate(-6), to: hnDate(0) });
  const [open, setOpen] = useState(null);
  const from = range === "custom" ? custom.from : RANGES[range].from();
  const to = range === "custom" ? custom.to : hnDate(0);
  const { data, error, loading, reload } = useLoader(() => api.get(`/api/admin/sales?from=${from}&to=${to}`), [from, to, refreshKey]);

  const exportCsv = () =>
    downloadCsv(`ventas-${from}-a-${to}.csv`, [
      ["Venta", "Fecha", "Canal", "Vendedor", "Productos", "Subtotal", "Descuento", "ISV", "Total", "Pago", "Banco", "Anulada"],
      ...data.sales.map((s) => [
        s.id, dateTime(s.createdAt), s.channel === "online" ? "En línea" : "Tienda", s.seller.name,
        s.items.map((it) => `${it.qty}x ${it.name}`).join(" | "), s.subtotal, s.discount, s.tax, s.total,
        PAYMENT_LABEL[s.paymentMethod], s.bank ?? "", s.voided ? "Sí" : "No",
      ]),
    ]);

  return (
    <>
      <PageHead title="Ventas" subtitle="Punto de venta y pedidos en línea concretados.">
        <button className="btn btn-ghost btn-sm" disabled={!data?.sales.length} onClick={exportCsv}><Icon name="download" size={14} /> Exportar a Excel</button>
      </PageHead>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <div className="chips">
          {Object.entries(RANGES).map(([k, r]) => <button key={k} className={`chip ${range === k ? "active" : ""}`} onClick={() => setRange(k)}>{r.label}</button>)}
          <button className={`chip ${range === "custom" ? "active" : ""}`} onClick={() => setRange("custom")}>Elegir fechas</button>
        </div>
        {range === "custom" && (
          <div className="row" style={{ "--gap": "6px" }}>
            <input className="input" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <span className="muted">a</span>
            <input className="input" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        )}
      </div>

      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <>
          <div className="grid" style={{ "--min": "150px", marginBottom: 16 }}>
            <Stat icon="receipt" label="Ventas" value={data.totals.count} />
            <Stat icon="wallet" label="Total" value={money(data.totals.total)} mono />
            <Stat icon="cash" label="Efectivo" value={money(data.totals.efectivo)} mono />
            <Stat icon="bank" label="Transferencia" value={money(data.totals.transferencia)} mono />
          </div>
          {data.sales.length === 0 ? <Empty icon="receipt" title="Sin ventas en estas fechas" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>#</th><th>Fecha</th><th>Vendedor</th><th className="hide-mobile">Productos</th><th>Pago</th><th className="num">Total</th></tr>
                </thead>
                <tbody>
                  {data.sales.map((s) => (
                    <tr key={s.id} className={s.voided ? "muted" : ""} onClick={() => setOpen(s)} style={{ cursor: "pointer" }}>
                      <td className="mono">{s.id}</td>
                      <td className="nowrap">{dateTime(s.createdAt)}</td>
                      <td>{s.seller.name}{s.channel === "online" && <span className="tiny faint"> · web</span>}</td>
                      <td className="hide-mobile truncate" style={{ maxWidth: 280 }}>{s.items.map((it) => `${it.qty}x ${it.name}`).join(", ")}</td>
                      <td className="nowrap">
                        <Badge tone={s.voided ? "danger" : s.paymentMethod === "efectivo" ? "ok" : "info"}>{s.voided ? "Anulada" : PAYMENT_LABEL[s.paymentMethod]}</Badge>
                        {s.receiptUrl && <Icon name="image" size={14} className="faint" style={{ marginLeft: 6, verticalAlign: "middle" }} />}
                      </td>
                      <td className="num">{money(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {open && <SaleDetail sale={open} api={api} store={store} onClose={() => setOpen(null)} />}
    </>
  );
}
