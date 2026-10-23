/**
 * Panel de administración: inicio, pedidos, mensajes (WhatsApp), productos,
 * ventas, equipo y ajustes. Revisa cada pocos segundos si llegaron pedidos o
 * mensajes nuevos y avisa con sonido y notificación.
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../shared/icons.jsx";
import { beep, notify } from "../shared/media.js";
import { mount, Portal } from "../shared/Portal.jsx";
import { Pos } from "../shared/Pos.jsx";
import { Shell, useHashTab } from "../shared/Shell.jsx";
import { ErrorBox, Loading, Modal, useLoader, useToast } from "../shared/ui.jsx";
import { Dashboard } from "./Dashboard.jsx";
import { Messages } from "./Messages.jsx";
import { Orders } from "./Orders.jsx";
import { Products } from "./Products.jsx";
import { Sales } from "./Sales.jsx";
import { Settings } from "./Settings.jsx";
import { Team } from "./Team.jsx";

const TABS = [
  { id: "inicio", label: "Inicio", icon: "grid" },
  { id: "pedidos", label: "Pedidos", icon: "cart" },
  { id: "mensajes", label: "Mensajes", icon: "whatsapp" },
  { id: "productos", label: "Productos", icon: "box" },
  { id: "ventas", label: "Ventas", icon: "chart" },
  { id: "equipo", label: "Equipo", icon: "users", mobile: false },
  { id: "ajustes", label: "Ajustes", icon: "settings", mobile: false },
];

const SUMMARY_EVERY_MS = 12000;

/** Consulta liviana de pendientes; avisa cuando aparece algo nuevo. */
function useSummary(api, onNew) {
  const [summary, setSummary] = useState(null);
  const last = useRef(null);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  const refresh = async () => {
    try {
      const s = await api.get("/api/admin/summary");
      if (last.current) {
        if (s.lastOrderId > last.current.lastOrderId) onNewRef.current("pedido", s);
        else if (s.lastInquiryId > last.current.lastInquiryId) onNewRef.current("mensaje", s);
      }
      last.current = s;
      setSummary(s);
    } catch {
      // sin conexión momentánea: se reintenta en el próximo ciclo
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(() => !document.hidden && refresh(), SUMMARY_EVERY_MS);
    const onVisible = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [summary, refresh];
}

function AdminApp({ user, api, logout }) {
  const [tab, setTab] = useHashTab(TABS, "inicio");
  const toast = useToast();
  const [version, setVersion] = useState(0); // fuerza recarga de la pestaña cuando llega algo nuevo
  const [posOpen, setPosOpen] = useState(false);
  const settings = useLoader(() => api.get("/api/admin/settings").then((r) => r.settings), []);

  const [summary, refreshSummary] = useSummary(api, (kind) => {
    beep();
    setVersion((v) => v + 1);
    if (kind === "pedido") {
      toast("🛒 ¡Llegó un pedido nuevo!", "info", 7000);
      notify("Nuevo pedido en Tecnocore", "Abrí el panel para concretar la venta");
    } else {
      toast("💬 Un cliente escribió desde la tienda", "info", 7000);
      notify("Nuevo mensaje de un cliente", "Revisalo en Mensajes");
    }
  });

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  }, []);

  useEffect(() => {
    const pending = (summary?.newOrders ?? 0) + (summary?.openInquiries ?? 0);
    document.title = `${pending ? `(${pending}) ` : ""}Tecnocore · Administración`;
  }, [summary]);

  if (settings.loading && !settings.data) return <Loading />;
  if (settings.error && !settings.data) return <div className="container" style={{ paddingTop: 30 }}><ErrorBox error={settings.error} onRetry={settings.reload} /></div>;
  const store = settings.data;

  const tabs = TABS.map((t) => ({
    ...t,
    badge: t.id === "pedidos" ? summary?.newOrders : t.id === "mensajes" ? summary?.openInquiries : 0,
  }));

  const sellButton = (
    <button className="btn btn-sm btn-rgb" onClick={() => setPosOpen(true)}><Icon name="receipt" size={15} /> Vender</button>
  );

  return (
    <Shell tabs={tabs} tab={tab} onTab={setTab} user={user} api={api} onLogout={logout} tag="Administración" actions={sellButton}>
      {tab === "inicio" && <Dashboard api={api} onTab={setTab} refreshKey={version} />}
      {tab === "pedidos" && <Orders api={api} store={store} refreshKey={version} onChange={refreshSummary} />}
      {tab === "mensajes" && <Messages api={api} store={store} refreshKey={version} onChange={refreshSummary} />}
      {tab === "productos" && <Products api={api} store={store} />}
      {tab === "ventas" && <Sales api={api} store={store} refreshKey={version} />}
      {tab === "equipo" && <Team api={api} me={user} />}
      {tab === "ajustes" && <Settings api={api} settings={store} onSaved={(s) => settings.setData(s)} />}

      {posOpen && (
        <Modal title="Punto de venta" onClose={() => setPosOpen(false)} size="xl" sheet={false}>
          <Pos api={api} onSale={() => setVersion((v) => v + 1)} />
        </Modal>
      )}
    </Shell>
  );
}

mount(() => <Portal portal="admin">{(props) => <AdminApp {...props} />}</Portal>);
