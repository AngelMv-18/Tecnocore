/**
 * Estructura de los paneles internos: menú lateral en computadora y barra
 * inferior en el celular. La pestaña activa queda en la URL (#pedidos) para
 * que al recargar se vuelva al mismo lugar.
 */
import { useEffect, useState } from "react";
import { PAGES } from "./config.js";
import { Icon } from "./icons.jsx";
import { ChangePasswordModal } from "./Portal.jsx";
import { Avatar, Logo } from "./ui.jsx";

export function useHashTab(tabs, fallback) {
  const read = () => {
    const hash = window.location.hash.slice(1);
    return tabs.some((t) => t.id === hash) ? hash : fallback;
  };
  const [tab, setTab] = useState(read);
  useEffect(() => {
    const onHash = () => setTab(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const go = (id) => {
    if (id !== tab) history.replaceState(null, "", `#${id}`);
    setTab(id);
    window.scrollTo({ top: 0 });
  };
  return [tab, go];
}

/**
 * tabs: [{ id, label, icon, badge?, mobile? }] — `mobile: false` la oculta en la barra inferior
 * (queda accesible desde el menú de cuenta).
 */
export function Shell({ tabs, tab, onTab, user, api, onLogout, tag, actions, children }) {
  const [menu, setMenu] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const current = tabs.find((t) => t.id === tab);

  return (
    <div className="shell">
      <nav className="shell-nav" aria-label="Secciones">
        <Logo tag={tag} href={PAGES.cliente} />
        {tabs.map((t) => (
          <button key={t.id} className={`nav-item ${tab === t.id ? "active" : ""} ${t.mobile === false ? "extra" : ""}`} onClick={() => onTab(t.id)} aria-current={tab === t.id ? "page" : undefined}>
            <Icon name={t.icon} size={20} />
            <span className="nav-label">{t.label}</span>
            {t.badge > 0 && <span className="counter">{t.badge > 99 ? "99+" : t.badge}</span>}
          </button>
        ))}
        {actions && <div className="nav-actions">{actions}</div>}
        <div className="nav-spacer" />
        <div className="nav-desktop stack" style={{ "--gap": "2px" }}>
          <div className="row" style={{ padding: "10px 12px" }}>
            <Avatar name={user.name} size={32} />
            <div className="grow">
              <div className="small strong truncate">{user.name}</div>
              <div className="tiny faint">@{user.username}</div>
            </div>
          </div>
          <button className="nav-item" onClick={() => setChangingPassword(true)}><Icon name="lock" size={18} /> Cambiar contraseña</button>
          <button className="nav-item" onClick={onLogout}><Icon name="logout" size={18} /> Cerrar sesión</button>
        </div>
      </nav>

      <div className="grow">
        <header className="topbar shell-topbar">
          <div className="container topbar-inner">
            <Logo tag={tag} href={PAGES.cliente} />
            <div className="grow" />
            {actions}
            <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="Cuenta">
              <Icon name="user" />
            </button>
          </div>
          {menu && (
            <div className="container" style={{ paddingBottom: 12 }}>
              <div className="card flat stack" style={{ "--gap": "6px", padding: 10 }}>
                <div className="row" style={{ padding: 6 }}>
                  <Avatar name={user.name} size={32} />
                  <div className="grow"><div className="small strong">{user.name}</div><div className="tiny faint">@{user.username}</div></div>
                </div>
                {tabs.filter((t) => t.mobile === false).map((t) => (
                  <button key={t.id} className="btn btn-ghost btn-sm" style={{ justifyContent: "flex-start" }} onClick={() => { setMenu(false); onTab(t.id); }}>
                    <Icon name={t.icon} size={15} /> {t.label}
                  </button>
                ))}
                <button className="btn btn-ghost btn-sm" style={{ justifyContent: "flex-start" }} onClick={() => { setMenu(false); setChangingPassword(true); }}><Icon name="lock" size={15} /> Cambiar contraseña</button>
                <button className="btn btn-ghost btn-sm" style={{ justifyContent: "flex-start" }} onClick={onLogout}><Icon name="logout" size={15} /> Cerrar sesión</button>
              </div>
            </div>
          )}
        </header>
        <main className="shell-main">
          <div className="container" aria-label={current?.label}>{children}</div>
        </main>
      </div>

      {changingPassword && <ChangePasswordModal api={api} onClose={() => setChangingPassword(false)} />}
    </div>
  );
}

export function PageHead({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="row wrap">{children}</div>}
    </div>
  );
}
