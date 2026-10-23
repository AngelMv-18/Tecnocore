/**
 * Panel del empleado: punto de venta y resumen de sus ventas del día.
 */
import { useState } from "react";
import { dateTime, money, PAYMENT_LABEL, time } from "../shared/format.js";
import { Icon } from "../shared/icons.jsx";
import { mount, Portal } from "../shared/Portal.jsx";
import { Pos } from "../shared/Pos.jsx";
import { PageHead, Shell, useHashTab } from "../shared/Shell.jsx";
import { Badge, Empty, ErrorBox, Loading, Modal, Stat, useLoader } from "../shared/ui.jsx";
import { ReceiptImage } from "../shared/Receipt.jsx";

const TABS = [
  { id: "vender", label: "Vender", icon: "receipt" },
  { id: "ventas", label: "Mis ventas", icon: "chart" },
];

function SaleDetail({ sale, api, store, onClose }) {
  return (
    <Modal title={`Venta #${sale.id}`} onClose={onClose}>
      <div className="row between small muted">
        <span>{dateTime(sale.createdAt)}</span>
        <Badge tone={sale.paymentMethod === "efectivo" ? "ok" : "info"}>{PAYMENT_LABEL[sale.paymentMethod]}{sale.bank ? ` · ${sale.bank}` : ""}</Badge>
      </div>
      <div>
        {sale.items.map((it, i) => (
          <div key={i} className="list-row small">
            <span className="mono muted">{it.qty}x</span>
            <span className="grow">{it.name}</span>
            <span className="mono">{money(it.lineTotal)}</span>
          </div>
        ))}
      </div>
      <div className="pos-totals">
        {sale.discount > 0 && <div className="row between small muted"><span>Descuento</span><span className="mono">-{money(sale.discount)}</span></div>}
        {sale.tax > 0 && <div className="row between small muted"><span>ISV</span><span className="mono">{money(sale.tax)}</span></div>}
        <div className="row between"><strong>Total</strong><strong className="mono">{money(sale.total)}</strong></div>
        {sale.paymentMethod === "efectivo" && <div className="row between small muted"><span>Recibido / vuelto</span><span className="mono">{money(sale.cashReceived)} / {money(sale.change)}</span></div>}
      </div>
      {sale.receiptUrl && <ReceiptImage api={api} sale={sale} store={store} />}
    </Modal>
  );
}

function TodaySales({ api, refreshKey }) {
  const { data, error, loading, reload } = useLoader(async () => {
    const [today, catalog] = await Promise.all([api.get("/api/staff/sales/today"), api.get("/api/staff/catalog")]);
    return { ...today, store: catalog.store };
  }, [refreshKey]);
  const [open, setOpen] = useState(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { sales, totals, store } = data;

  return (
    <>
      <PageHead title="Mis ventas de hoy" subtitle="Lo que vendiste desde las 12:00 a. m.">
        <button className="btn btn-ghost btn-sm" onClick={() => reload()}><Icon name="refresh" size={14} /> Actualizar</button>
      </PageHead>
      <div className="grid" style={{ "--min": "150px", marginBottom: 16 }}>
        <Stat icon="receipt" label="Ventas" value={totals.count} />
        <Stat icon="wallet" label="Total vendido" value={money(totals.total)} mono />
        <Stat icon="cash" label="En efectivo" value={money(totals.efectivo)} mono sub="Lo que debe haber en caja" />
        <Stat icon="bank" label="Transferencias" value={money(totals.transferencia)} mono />
      </div>
      {sales.length === 0 ? (
        <Empty icon="receipt" title="Todavía no hay ventas hoy">Las ventas que hagas aparecen acá.</Empty>
      ) : (
        <div className="card" style={{ padding: "4px 16px" }}>
          {sales.map((s) => (
            <button key={s.id} className="list-row" style={{ width: "100%", background: "none", border: "none", borderBottom: "1px solid var(--border)", textAlign: "left", cursor: "pointer" }} onClick={() => setOpen(s)}>
              <div className="mono small faint" style={{ width: 52 }}>{time(s.createdAt)}</div>
              <div className="grow">
                <div className="small strong truncate">{s.items.map((it) => `${it.qty}x ${it.name}`).join(", ")}</div>
                <div className="tiny muted">#{s.id} · {PAYMENT_LABEL[s.paymentMethod]}{s.bank ? ` · ${s.bank}` : ""}</div>
              </div>
              {s.receiptUrl && <Icon name="image" size={16} className="faint" />}
              <span className="mono strong">{money(s.total)}</span>
            </button>
          ))}
        </div>
      )}
      {open && <SaleDetail sale={open} api={api} store={store} onClose={() => setOpen(null)} />}
    </>
  );
}

function EmpleadoApp({ user, api, logout }) {
  const [tab, setTab] = useHashTab(TABS, "vender");
  const [salesVersion, setSalesVersion] = useState(0);

  return (
    <Shell tabs={TABS} tab={tab} onTab={setTab} user={user} api={api} onLogout={logout} tag="Punto de venta">
      {tab === "vender" && (
        <>
          <PageHead title="Nueva venta" subtitle={`Hola ${user.name.split(" ")[0]} 👋 Tocá los productos para armar la venta.`} />
          <Pos api={api} onSale={() => setSalesVersion((v) => v + 1)} />
        </>
      )}
      {tab === "ventas" && <TodaySales api={api} refreshKey={salesVersion} />}
    </Shell>
  );
}

mount(() => <Portal portal="empleado">{(props) => <EmpleadoApp {...props} />}</Portal>);
