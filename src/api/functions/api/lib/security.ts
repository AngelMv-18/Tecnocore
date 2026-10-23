/**
 * Seguridad: contraseñas cifradas, tokens de sesión, códigos y límite de intentos.
 * Usa solo Web Crypto, disponible igual en Deno (Supabase) y en Bun.
 */
import { type Db, one } from "./db.ts";
import { fail } from "./http.ts";

const encoder = new TextEncoder();
const PBKDF2_ITERATIONS = 100_000;

export function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(password: string, saltHex: string, iterations: number): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Formato guardado: pbkdf2$<iteraciones>$<sal>$<hash>. Nunca se guarda la contraseña. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomHex(16);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [scheme, iterations, salt, expected] = String(stored ?? "").split("$");
  if (scheme !== "pbkdf2" || !salt || !expected) return false;
  const actual = await pbkdf2(password, salt, Number(iterations));
  // Comparación en tiempo constante
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < Math.min(actual.length, expected.length); i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const ORDER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Código corto de pedido, sin letras que se confunden (0/O, 1/I). */
export function randomOrderCode(length = 6): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => ORDER_CODE_ALPHABET[b % ORDER_CODE_ALPHABET.length]).join("");
}

/**
 * Límite de intentos guardado en la base de datos, para que funcione aunque
 * Supabase reparta las solicitudes entre varias instancias de la función.
 */
export async function rateLimit(db: Db, key: string, limit: number, windowSeconds: number): Promise<void> {
  const row = await one<{ hits: number }>(
    db,
    `INSERT INTO tc.rate_limits (key, hits, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET
       hits     = CASE WHEN tc.rate_limits.reset_at < now() THEN 1 ELSE tc.rate_limits.hits + 1 END,
       reset_at = CASE WHEN tc.rate_limits.reset_at < now() THEN EXCLUDED.reset_at ELSE tc.rate_limits.reset_at END
     RETURNING hits`,
    [key, windowSeconds],
  );
  if (Math.random() < 0.02) await db.query("DELETE FROM tc.rate_limits WHERE reset_at < now() - interval '1 day'");
  if ((row?.hits ?? 0) > limit) fail(429, "Demasiados intentos. Esperá unos minutos y volvé a probar");
}
