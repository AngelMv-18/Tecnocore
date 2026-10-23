/**
 * HTTP: errores, respuestas JSON con CORS y un router mínimo con control de roles.
 */
import type { Db } from "./db.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-session-token",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function errorResponse(status: number, message: string): Response {
  return json({ error: message }, status);
}

export type Role = "admin" | "empleado" | "rider";

export type User = {
  id: number;
  role: Role;
  username: string;
  name: string;
  phone: string;
  active: boolean;
  available: boolean;
};

export type Ctx = {
  db: Db;
  req: Request;
  url: URL;
  params: Record<string, string>;
  ip: string;
  /** Usuario autenticado; siempre presente en rutas con roles. */
  user: User;
  body: <T = any>() => Promise<T>;
};

export type Handler = (ctx: Ctx) => Promise<unknown>;

type Route = { method: string; pattern: RegExp; keys: string[]; roles: Role[] | null; handler: Handler };

export const PUBLIC = null;
export const ADMIN: Role[] = ["admin"];
export const STAFF: Role[] = ["admin", "empleado"];
export const RIDER: Role[] = ["rider"];
export const ANY_USER: Role[] = ["admin", "empleado", "rider"];

export class Router {
  private routes: Route[] = [];

  on(method: string, path: string, roles: Role[] | null, handler: Handler): this {
    const keys: string[] = [];
    const pattern = new RegExp("^" + path.replace(/:(\w+)/g, (_, key) => (keys.push(key), "([^/]+)")) + "$");
    this.routes.push({ method, pattern, keys, roles, handler });
    return this;
  }

  match(method: string, path: string) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(path);
      if (m) {
        const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        return { route, params };
      }
    }
    return null;
  }
}

const MAX_BODY_CHARS = 4 * 1024 * 1024;

/** Lee el cuerpo JSON una sola vez, con límite de tamaño. */
export function bodyReader(req: Request): Ctx["body"] {
  let cached: Promise<any> | null = null;
  return () => {
    cached ??= (async () => {
      if (Number(req.headers.get("content-length") || 0) > MAX_BODY_CHARS) fail(413, "La solicitud es muy grande");
      const text = await req.text();
      if (text.length > MAX_BODY_CHARS) fail(413, "La solicitud es muy grande");
      if (!text) return {};
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        // cae al error de abajo
      }
      fail(400, "Formato de solicitud no válido");
    })();
    return cached;
  };
}

/**
 * Extrae la ruta de la API sin importar el prefijo con que llegue:
 * Supabase entrega "/api/..." y algunos proxies agregan "/functions/v1".
 */
export function apiPath(pathname: string): string {
  const i = pathname.indexOf("/api/");
  if (i >= 0) return pathname.slice(i);
  return pathname.endsWith("/api") ? "/api" : pathname;
}
