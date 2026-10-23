/**
 * Puerta de entrada de los paneles internos (admin, empleado, rider).
 * Verifica la sesión guardada, muestra el login y —solo en el portal admin—
 * la configuración inicial con el código de instalación.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createApi } from "./api.js";
import { CircuitBackground } from "./background.jsx";
import { PAGES } from "./config.js";
import { Icon } from "./icons.jsx";
import { ErrorBox, Field, Loading, Logo, Modal, ToastProvider, useAction, useForm } from "./ui.jsx";

const PORTALS = {
  admin: { title: "Panel de administración", badge: "ADMIN", icon: "settings" },
  empleado: { title: "Punto de venta", badge: "EMPLEADO", icon: "receipt" },
  rider: { title: "Panel de entregas", badge: "RIDER", icon: "bike" },
};

/** Monta una página completa con los proveedores comunes. */
export function mount(App) {
  createRoot(document.getElementById("root")).render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
}

function PasswordInput({ value, onChange, autoComplete = "current-password", placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        className="input"
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        placeholder={placeholder}
        style={{ paddingRight: 44 }}
        required
      />
      <button
        type="button"
        className="icon-btn sm"
        style={{ position: "absolute", right: 6, top: 6, border: "none" }}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
      >
        <Icon name={visible ? "ban" : "eye"} size={16} />
      </button>
    </div>
  );
}

function LoginForm({ portal, api, onLogin }) {
  const [form, set] = useForm({ username: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.post("/api/auth/login", { portal, ...form });
      api.setSession({ token, user });
      onLogin(user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" style={{ "--gap": "14px" }} onSubmit={submit}>
      <Field label="Usuario">
        <input className="input" value={form.username} onChange={set("username")} autoComplete="username" autoCapitalize="none" required />
      </Field>
      <Field label="Contraseña">
        <PasswordInput value={form.password} onChange={set("password")} />
      </Field>
      <ErrorBox error={error} />
      <button className="btn btn-rgb btn-lg btn-block" disabled={busy}>
        {busy ? <span className="spinner" /> : <>Entrar <Icon name="arrowRight" size={16} /></>}
      </button>
    </form>
  );
}

function SetupForm({ api, onLogin }) {
  const [form, set] = useForm({ code: "", name: "", username: "", password: "", confirm: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError(new Error("Las contraseñas no coinciden"));
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.post("/api/auth/setup", form);
      api.setSession({ token, user });
      onLogin(user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" style={{ "--gap": "12px" }} onSubmit={submit}>
      <div className="alert info">
        <Icon name="info" />
        <span>Primera vez: creá tu cuenta de administrador con el código de instalación que te dieron.</span>
      </div>
      <Field label="Código de instalación">
        <input className="input mono" value={form.code} onChange={set("code")} placeholder="TC-XXXX-XXXX" autoCapitalize="characters" required />
      </Field>
      <Field label="Tu nombre">
        <input className="input" value={form.name} onChange={set("name")} required />
      </Field>
      <Field label="Usuario" hint="Minúsculas, números, punto o guion (3 a 30)">
        <input className="input" value={form.username} onChange={(e) => set("username")(e.target.value.toLowerCase())} autoCapitalize="none" autoComplete="username" required />
      </Field>
      <Field label="Contraseña" hint="Mínimo 6 caracteres">
        <PasswordInput value={form.password} onChange={set("password")} autoComplete="new-password" />
      </Field>
      <Field label="Repetí la contraseña">
        <PasswordInput value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />
      </Field>
      <ErrorBox error={error} />
      <button className="btn btn-rgb btn-lg btn-block" disabled={busy}>
        {busy ? <span className="spinner" /> : "Crear cuenta de administrador"}
      </button>
    </form>
  );
}

/**
 * <Portal portal="admin">{({ user, api, logout }) => <Panel/>}</Portal>
 */
export function Portal({ portal, children }) {
  const api = useMemo(() => createApi(portal), [portal]);
  const [user, setUser] = useState(null);
  const [phase, setPhase] = useState("checking"); // checking | login | setup | ready | offline
  const [offlineError, setOfflineError] = useState(null);
  const info = PORTALS[portal];

  const check = useCallback(async () => {
    setPhase("checking");
    try {
      if (api.session?.token) {
        try {
          const { user: me } = await api.get("/api/auth/me");
          setUser(me);
          return setPhase("ready");
        } catch (err) {
          if (err.status !== 401 && err.status !== 403) throw err;
          api.setSession(null);
        }
      }
      if (portal === "admin") {
        const { needsSetup } = await api.get("/api/auth/setup");
        if (needsSetup) return setPhase("setup");
      }
      setPhase("login");
    } catch (err) {
      setOfflineError(err);
      setPhase("offline");
    }
  }, [api, portal]);

  useEffect(() => {
    check();
    api.onUnauthorized(() => {
      setUser(null);
      setPhase("login");
    });
  }, [api, check]);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // aunque falle, cerramos la sesión local
    }
    api.setSession(null);
    setUser(null);
    setPhase("login");
  }, [api]);

  if (phase === "checking") return <Loading />;
  if (phase === "ready" && user) return children({ user, api, logout, setUser });

  return (
    <>
      <CircuitBackground />
      <main className="portal above-bg">
        <div className="portal-card glass stack" style={{ "--gap": "18px" }}>
          <div className="stack" style={{ alignItems: "center", "--gap": "10px" }}>
            <Logo href={PAGES.cliente} />
            <span className="badge accent portal-role"><Icon name={info.icon} size={13} /> {info.badge}</span>
            <h1 className="portal-title">{info.title}</h1>
          </div>
          {phase === "offline" && <ErrorBox error={offlineError} onRetry={check} />}
          {phase === "setup" && <SetupForm api={api} onLogin={(u) => { setUser(u); setPhase("ready"); }} />}
          {phase === "login" && <LoginForm portal={portal} api={api} onLogin={(u) => { setUser(u); setPhase("ready"); }} />}
          <a className="small muted" style={{ textAlign: "center" }} href={PAGES.cliente}>← Volver a la tienda</a>
        </div>
      </main>
    </>
  );
}

/** Ventana para que cualquier usuario cambie su propia contraseña. */
export function ChangePasswordModal({ api, onClose }) {
  const [form, set] = useForm({ current: "", next: "", confirm: "" });
  const [run, busy] = useAction();
  const submit = async (e) => {
    e.preventDefault();
    if (form.next !== form.confirm) return run(async () => { throw new Error("Las contraseñas nuevas no coinciden"); });
    const ok = await run(() => api.post("/api/auth/password", { current: form.current, next: form.next }), "Contraseña actualizada");
    if (ok) onClose();
  };
  return (
    <Modal title="Cambiar contraseña" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Contraseña actual"><PasswordInput value={form.current} onChange={set("current")} /></Field>
        <Field label="Nueva contraseña" hint="Mínimo 6 caracteres"><PasswordInput value={form.next} onChange={set("next")} autoComplete="new-password" /></Field>
        <Field label="Repetí la nueva"><PasswordInput value={form.confirm} onChange={set("confirm")} autoComplete="new-password" /></Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? <span className="spinner" /> : "Guardar"}</button>
      </form>
    </Modal>
  );
}

export { PasswordInput };
