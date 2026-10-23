/**
 * Validación de datos de entrada. Cada función devuelve el valor ya limpio
 * o corta la solicitud con un error 400 y un mensaje claro en español.
 */
import { fail } from "./http.ts";

export const round2 = (n: number) => Math.round(n * 100) / 100;

const digitsOnly = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** Los números hondureños de 8 dígitos reciben el código de país 504. */
export function normalizePhone(raw: unknown): string {
  const d = digitsOnly(raw);
  return d.length === 8 ? `504${d}` : d;
}

export const check = {
  text(value: unknown, label: string, { max = 120, optional = false } = {}): string {
    const s = value == null ? "" : String(value).trim();
    if (!s) return optional ? "" : fail(400, `${label} es obligatorio`);
    if (s.length > max) fail(400, `${label} es muy largo (máximo ${max} caracteres)`);
    return s;
  },

  int(value: unknown, label: string, { min = 0, max = 1_000_000 } = {}): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) fail(400, `${label} no es válido`);
    return n;
  },

  money(value: unknown, label: string): number {
    if (value === "" || value == null) fail(400, `${label} es obligatorio`);
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) fail(400, `${label} no es válido`);
    return round2(n);
  },

  optionalMoney(value: unknown, label: string): number | null {
    return value === "" || value == null ? null : check.money(value, label);
  },

  oneOf<T extends string>(value: unknown, label: string, options: readonly T[]): T {
    if (!options.includes(value as T)) fail(400, `${label} no es válido`);
    return value as T;
  },

  bool(value: unknown): boolean {
    return value === true || value === 1 || value === "1" || value === "true";
  },

  phone(value: unknown, label = "El teléfono", { optional = false } = {}): string {
    const p = normalizePhone(value);
    if (!p) return optional ? "" : fail(400, `${label} es obligatorio`);
    if (p.length < 8 || p.length > 15) fail(400, `${label} no es válido`);
    return p;
  },

  username(value: unknown): string {
    const u = String(value ?? "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) {
      fail(400, "El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo");
    }
    return u;
  },

  password(value: unknown, label = "La contraseña"): string {
    const p = String(value ?? "");
    if (p.length < 6) fail(400, `${label} debe tener al menos 6 caracteres`);
    if (p.length > 100) fail(400, `${label} es muy larga`);
    return p;
  },

  imageId(value: unknown): string {
    const id = String(value ?? "");
    if (!/^[a-f0-9]{32}$/.test(id)) fail(400, "La imagen no es válida, volvé a subirla");
    return id;
  },
};
