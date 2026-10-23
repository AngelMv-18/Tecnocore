/**
 * Inicio del admin: ventas de hoy y del mes, gráfico de 7 días, pendientes,
 * stock bajo y lo que más interesa a los clientes.
 */
import { money, PAYMENT_LABEL, time, weekday } from "../shared/format.js";
import { Icon } from "../shared/icons.jsx";
import { PageHead } from "../shared/Shell.jsx";
import { Badge, Empty, ErrorBox, Loading, ProductImage, Stat, useLoader } from "../shared/ui.jsx";

/** Barras de una sola serie (ventas por día). El valor exacto aparece al pasar el mouse o tocar. */
function SalesChart({ days }) {
  const max = Math.max(...days.map((d) => d.total), 1);
  const last = days.length - 1;
  return (
    <div className="bar-chart" role="img" aria-label={`Ventas de los últimos 7 días: ${days.map((d) => `${weekday(d.day)} ${money(d.total)}`).join(", ")}`}>
      {days.map((d, i) => (
        <div key={d.day} className="bar-col" tabIndex={0}>
          <span className={`bar-value ${i === last ? "always" : ""}`}>{d.total ? money(d.total).replace("L. ", "L ") : "—"}</span>
          <div className={`bar ${i === last ? "today" : ""}`} style={{ height: `${(d.total / max) * 100}%` }} title={`${weekday(d.day)}: ${money(d.total)} · ${d.count} ventas`} />
          <span className="bar-label">{i === last ? "hoy" : weekday(d.day)}</span>
        </div>
      ))}
    </div>
  );
}

function RankList({ title, icon, rows, value, empty }) {
  const max = Math.max(...rows.map(value), 1);
  return (
    <div className="card stack">
      <h3 className="card-title row"><Icon name={icon} size={16} /> {title}</h3>
      {rows.length === 0 ? (
        <p className="small faint">{empty}</p>
      ) : (
        rows.map((r, i) => (
          <div key={i} className="stack" style={{ "--gap": "4px" }}>
            <div className="row between small"><span className="truncate">{r.name}</span><span className="mono muted">{value(r)}</span></div>
            <div className="meter"><i style={{ width: `${(value(r) / max) * 100}%` }} /></div>
          </div>
        ))
      )}
    </div>
  );
}

export function Dashboard({ api, onTab, refreshKey }) {
  const { data, error, loading, reload } = useLoader(() => api.get("/api/admin/dashboard"), [refreshKey], { pollMs: 60000 });
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const d = data;
  const byMethod = Object.fromEntries(d.todayByMethod.map((m) => [m.method, m.total]));
  const alerts = [
    d.counts.newOrders > 0 && { tone: "warn", icon: "cart", text: `${d.counts.newOrders} ${d.counts.newOrders === 1 ? "pedido nuevo espera" : "pedidos nuevos esperan"} confirmación`, tab: "pedidos" },
    d.counts.openInquiries > 0 && { tone: "info", icon: "message", text: `${d.counts.openInquiries} ${d.counts.openInquiries === 1 ? "mensaje sin atender" : "mensajes sin atender"}`, tab: "mensajes" },
    d.lowStock.length > 0 && { tone: "danger", icon: "box", text: `${d.lowStock.length} productos con stock bajo o agotados`, tab: "productos" },
  ].filter(Boolean);

  return (
    <>
      <PageHead title="Inicio" subtitle="Cómo va la tienda hoy.">
        <button className="btn btn-ghost btn-sm" onClick={() => reload()}><Icon name="refresh" size={14} /> Actualizar</button>
      </PageHead>

      {alerts.length > 0 && (
        <div className="stack" style={{ "--gap": "8px", marginBottom: 16 }}>
          {alerts.map((a) => (
            <button key={a.tab} className={`alert ${a.tone}`} style={{ cursor: "pointer", textAlign: "left", width: "100%" }} onClick={() => onTab(a.tab)}>
              <Icon name={a.icon} /><span className="grow">{a.text}</span><Icon name="chevronRight" size={16} />
            </button>
          ))}
        </div>
      )}

      <div className="grid" style={{ "--min": "150px", marginBottom: 16 }}>
        <Stat icon="wallet" label="Vendido hoy" value={money(d.today.total)} mono sub={`${d.today.count} ventas`} />
        <Stat icon="cash" label="Efectivo hoy" value={money(byMethod.efectivo ?? 0)} mono />
        <Stat icon="bank" label="Transferencias hoy" value={money(byMethod.transferencia ?? 0)} mono />
        <Stat icon="chart" label="Este mes" value={money(d.month.total)} mono sub={`${d.month.count} ventas`} />
        <Stat icon="truck" label="Pedidos en curso" value={d.counts.activeOrders} sub={`${d.counts.ridersAvailable} riders disponibles`} />
      </div>

      <div className="dash-grid">
        <div className="card stack">
          <div className="row between"><h3 className="card-title">Ventas de los últimos 7 días</h3><span className="tiny faint">Tocá una barra para ver el monto</span></div>
          <SalesChart days={d.last7} />
        </div>

        <div className="card stack">
          <h3 className="card-title">Hoy por vendedor</h3>
          {d.todayBySeller.length === 0 ? <p className="small faint">Todavía no hay ventas hoy.</p> : d.todayBySeller.map((s) => (
            <div key={s.name} className="row between small"><span>{s.name} <span className="faint">· {s.count}</span></span><span className="mono">{money(s.total)}</span></div>
          ))}
          <h3 className="card-title" style={{ marginTop: 8 }}>Últimas ventas</h3>
          {d.recentSales.length === 0 ? <p className="small faint">Sin ventas registradas.</p> : d.recentSales.map((s) => (
            <div key={s.id} className="row small">
              <span className="mono faint tiny nowrap" style={{ width: 40 }}>{time(s.createdAt)}</span>
              <span className="grow truncate">{s.seller.name}</span>
              <Badge tone={s.paymentMethod === "efectivo" ? "ok" : "info"}>{PAYMENT_LABEL[s.paymentMethod]}</Badge>
              <span className="mono">{money(s.total)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid" style={{ "--min": "260px", marginTop: 16 }}>
        <div className="card stack">
          <h3 className="card-title row"><Icon name="alert" size={16} /> Stock bajo (≤ {d.lowStockThreshold})</h3>
          {d.lowStock.length === 0 ? <Empty icon="check" title="Todo con stock" /> : d.lowStock.map((p) => (
            <div key={p.id} className="row small">
              <ProductImage product={p} style={{ width: 34, height: 34 }} />
              <span className="grow truncate">{p.name}</span>
              <Badge tone={p.stock === 0 ? "danger" : "warn"}>{p.stock === 0 ? "Agotado" : `${p.stock} u.`}</Badge>
            </div>
          ))}
        </div>
        <RankList title="Más vendidos (30 días)" icon="trophy" rows={d.topProducts} value={(r) => r.qty} empty="Todavía no hay ventas." />
        <RankList title="Les interesa a los clientes" icon="heart" rows={d.mostInterested} value={(r) => r.count} empty="Nadie tocó “Me interesa” todavía." />
        <RankList title="Más vistos en la tienda" icon="eye" rows={d.mostViewed} value={(r) => r.views} empty="Sin visitas registradas." />
      </div>
    </>
  );
}
