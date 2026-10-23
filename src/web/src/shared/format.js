/**
 * Formatos de presentación: lempiras, fechas en hora de Honduras, duraciones y teléfonos.
 */

const TZ = "America/Tegucigalpa";

/** L. 1,234.56 — siempre con dos decimales. */
export function money(value) {
  const n = Number(value) || 0;
  return `L. ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function dateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("es-HN", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function time(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("es-HN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function weekday(isoDate) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("es-HN", { weekday: "short" }).replace(".", "");
}

/** Fecha "AAAA-MM-DD" de hoy en Honduras, desplazada `days` días. */
export function hnDate(days = 0) {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function relative(value) {
  if (!value) return "";
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 45) return "recién";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return dateTime(value);
}

/** 754 → "12 min 34 s" */
export function duration(seconds) {
  if (seconds == null) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${s % 60} s`;
  return `${s} s`;
}

export function minutesBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b) - new Date(a)) / 1000);
}

/** 50498765432 → +504 9876-5432 */
export function phone(value) {
  const d = String(value || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("504")) return `+504 ${d.slice(3, 7)}-${d.slice(7)}`;
  return d ? `+${d}` : "";
}

export function initials(text) {
  const words = String(text || "?").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

const PALETTE = ["#e8823c", "#5b9bd5", "#4caf6d", "#e0b341", "#b565d8", "#4fbdba", "#e2574c", "#8aa6c1"];
export function colorFor(text) {
  let hash = 0;
  for (const ch of String(text || "?")) hash = ch.charCodeAt(0) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export const ORDER_STATUS = {
  nuevo: { label: "Nuevo", tone: "warn" },
  confirmado: { label: "Venta concretada", tone: "info" },
  en_camino: { label: "En camino", tone: "violet" },
  entregado: { label: "Entregado", tone: "ok" },
  cancelado: { label: "Cancelado", tone: "danger" },
};

export const RIDER_STATUS = {
  asignado: { label: "Esperando que acepte", tone: "warn" },
  aceptado: { label: "Aceptado", tone: "info" },
  recogido: { label: "En camino", tone: "violet" },
  entregado: { label: "Entregado", tone: "ok" },
};

export const PAYMENT_LABEL = { efectivo: "Efectivo", transferencia: "Transferencia" };

export function stockStatus(stock, low = 3) {
  if (stock <= 0) return { label: "Agotado", tone: "danger" };
  if (stock <= low) return { label: `Quedan ${stock}`, tone: "warn" };
  return { label: "Disponible", tone: "ok" };
}
