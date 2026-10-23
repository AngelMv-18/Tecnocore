/**
 * Componentes de interfaz reutilizables: ventanas, avisos, campos, estados vacíos…
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { assetUrl } from "./api.js";
import { colorFor, initials } from "./format.js";
import { Icon } from "./icons.jsx";

// ─── Avisos (toasts) ────────────────────────────────────────────────

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = "ok", ms = 3800) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), ms);
  }, []);
  const icon = { ok: "check", danger: "alert", info: "bell" };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <Icon name={icon[t.tone] ?? "info"} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** toast("Guardado") · toast("Error", "danger") · toast("Nuevo pedido", "info") */
export const useToast = () => useContext(ToastContext);

// ─── Ventana flotante ───────────────────────────────────────────────

let openModals = 0;

export function Modal({ title, onClose, children, footer, size = "", sheet = true, labelledBy }) {
  const ref = useRef(null);
  useEffect(() => {
    openModals += 1;
    document.body.classList.add("modal-open");
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => {
      openModals -= 1;
      if (openModals === 0) document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className={`modal-backdrop ${sheet ? "sheet" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : title} tabIndex={-1} ref={ref}>
        {title != null && (
          <div className="modal-head">
            <h2>{title}</h2>
            {onClose && (
              <button className="icon-btn sm" onClick={onClose} aria-label="Cerrar">
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmación simple. `danger` pinta el botón en rojo. */
export function Confirm({ title, message, confirmLabel = "Confirmar", danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Volver</button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={run} disabled={busy}>
            {busy ? <span className="spinner" /> : confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Modal>
  );
}

// ─── Campos ─────────────────────────────────────────────────────────

export function Field({ label, hint, error, children }) {
  return (
    <label className="field">
      {label && <span>{label}</span>}
      {children}
      {error ? <small className="error">{error}</small> : hint ? <small className="hint">{hint}</small> : null}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="check">
      <span className="switch">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
      {label}
    </label>
  );
}

export function Badge({ tone = "", children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Empty({ icon = "box", title, children }) {
  return (
    <div className="empty">
      <Icon name={icon} size={30} />
      <strong>{title}</strong>
      {children && <span className="small">{children}</span>}
    </div>
  );
}

export function Loading() {
  return (
    <div className="page-loading">
      <span className="spinner lg" />
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert danger">
      <Icon name="alert" />
      <div className="grow">{error.message || String(error)}</div>
      {onRetry && <button className="btn btn-sm btn-ghost" onClick={onRetry}>Reintentar</button>}
    </div>
  );
}

export function Stat({ icon, label, value, sub, mono }) {
  return (
    <div className="stat">
      <div className="label">{icon && <Icon name={icon} size={14} />}{label}</div>
      <div className={`value ${mono ? "mono" : ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

/** Foto del producto, o las iniciales si no tiene / falla la carga. */
export function ProductImage({ product, className = "thumb", style }) {
  const [broken, setBroken] = useState(false);
  const src = assetUrl(product?.imageUrl);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) {
    const color = colorFor(product?.category || product?.name);
    return (
      <div className={`${className} thumb-fallback`} style={{ ...style, color, background: `${color}1a` }} aria-hidden="true">
        {initials(product?.name)}
      </div>
    );
  }
  return <img className={className} style={style} src={src} alt={product?.name ?? ""} loading="lazy" onError={() => setBroken(true)} />;
}

export function Avatar({ name, size = 36 }) {
  const color = colorFor(name);
  return (
    <div
      className="thumb thumb-fallback"
      style={{ width: size, height: size, borderRadius: "50%", color, background: `${color}22`, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}

export function Logo({ tag, href = "index.html" }) {
  return (
    <a className="logo" href={href}>
      <span className="logo-mark" />
      <span>
        <span className="logo-text">TECNOCORE</span>
        {tag && <span className="logo-tag" style={{ display: "block" }}>{tag}</span>}
      </span>
    </a>
  );
}

// ─── Hooks ──────────────────────────────────────────────────────────

/**
 * Carga datos con estado de carga/error y permite recargar.
 * `pollMs` vuelve a pedir los datos cada tantos milisegundos (sin mostrar spinner).
 */
export function useLoader(loader, deps = [], { pollMs } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loaderRef.current();
      setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      setState((s) => ({ ...s, error: silent && s.data ? s.error : error, loading: false }));
      return null;
    }
  }, []);

  useEffect(() => {
    reload();
    if (!pollMs) return undefined;
    const timer = setInterval(() => !document.hidden && reload(true), pollMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === "function" ? fn(s.data) : fn })) };
}

/** Ejecuta una acción mostrando el error en un aviso. Devuelve [run, busy]. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (fn, successMessage) => {
      setBusy(true);
      try {
        const result = await fn();
        if (successMessage) toast(successMessage);
        return result;
      } catch (err) {
        toast(err.message || "Algo salió mal", "danger");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return [run, busy];
}

/** Valor de un formulario con un setter por campo: const [form, set] = useForm({...}); set("name")(value) */
export function useForm(initial) {
  const [form, setForm] = useState(initial);
  const set = useCallback((key) => (value) => setForm((f) => ({ ...f, [key]: value?.target ? (value.target.type === "checkbox" ? value.target.checked : value.target.value) : value })), []);
  return [form, set, setForm];
}
