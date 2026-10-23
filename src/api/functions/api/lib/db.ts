/**
 * Acceso a la base de datos.
 *
 * La API trabaja contra esta pequeña interfaz y no contra un driver concreto:
 * en Supabase se usa postgres.js (Deno) y en las pruebas locales Bun.sql.
 * Ambos exponen `unsafe(texto, parámetros)` y `begin(fn)` con el mismo contrato.
 */

export interface Db {
  /** Ejecuta una consulta con parámetros posicionales ($1, $2, ...) y devuelve las filas. */
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Ejecuta `work` dentro de una transacción; se revierte si lanza un error. */
  tx<T>(work: (db: Db) => Promise<T>): Promise<T>;
}

export type Row = Record<string, any>;

/** Cliente con la API común de postgres.js y Bun.sql. */
export interface SqlClient {
  unsafe(text: string, params?: unknown[]): Promise<any>;
  begin<T>(fn: (sql: SqlClient) => Promise<T>): Promise<T>;
}

export function createDb(sql: SqlClient): Db {
  return {
    async query(text, params = []) {
      const rows = await sql.unsafe(text, params as any[]);
      return Array.from(rows) as any[];
    },
    tx(work) {
      return sql.begin((trx) => work(createDb(trx)));
    },
  };
}

/** Primera fila del resultado o null. */
export async function one<T = Row>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  return (await db.query<T>(text, params))[0] ?? null;
}

/** Literal de arreglo de Postgres para usar con `= ANY($1::int[])`. */
export function intArray(values: number[]): string {
  return `{${values.map((v) => Math.trunc(Number(v))).join(",")}}`;
}

/** Bytes → hex, para insertar binarios con `decode($1, 'hex')` sin depender del driver. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Algunos drivers devuelven jsonb ya parseado y otros como texto. */
export function asJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; errno?: string; message?: string };
  return e?.code === "23505" || e?.errno === "23505" || /duplicate key|unique constraint/i.test(e?.message ?? "");
}

/** Zona horaria de la tienda: todo "hoy / esta semana / este mes" se calcula en hora de Honduras. */
export const TZ = "America/Tegucigalpa";
export const START_OF = {
  day: `(date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`,
  week: `(date_trunc('week', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`,
  month: `(date_trunc('month', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`,
};
