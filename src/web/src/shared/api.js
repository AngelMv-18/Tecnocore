/**
 * Cliente de la API. Cada portal (admin, empleado, rider) guarda su propia
 * sesión, así se puede tener abierta más de una en el mismo navegador.
 */
import { ANON_KEY, API_URL } from "./config.js";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const storageKey = (portal) => `tecnocore.session.${portal}`;

function readSession(portal) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(portal)) || "null");
  } catch {
    return null;
  }
}

function writeSession(portal, session) {
  try {
    if (session) localStorage.setItem(storageKey(portal), JSON.stringify(session));
    else localStorage.removeItem(storageKey(portal));
  } catch {
    // Modo privado o almacenamiento bloqueado: la sesión dura lo que dure la pestaña.
  }
}

/** URL absoluta para imágenes que devuelve la API ("/api/images/…") o links externos. */
export function assetUrl(path) {
  if (!path) return "";
  return /^https?:\/\//i.test(path) ? path : `${API_URL}${path}`;
}

export function createApi(portal = null) {
  let session = portal ? readSession(portal) : null;
  let onUnauthorized = () => {};

  async function request(method, path, body) {
    if (!API_URL) throw new ApiError(0, "Falta configurar la dirección del servidor (config.js)");
    const headers = { "Content-Type": "application/json" };
    if (ANON_KEY) {
      headers.apikey = ANON_KEY;
      headers.Authorization = `Bearer ${ANON_KEY}`;
    }
    if (session?.token) headers["X-Session-Token"] = session.token;

    let res;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "No hay conexión con el servidor. Revisá tu internet e intentá de nuevo");
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && session) {
        setSession(null);
        onUnauthorized();
      }
      throw new ApiError(res.status, data.error || "Algo salió mal, intentá de nuevo");
    }
    return data;
  }

  function setSession(next) {
    session = next;
    if (portal) writeSession(portal, next);
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body = {}) => request("POST", path, body),
    put: (path, body = {}) => request("PUT", path, body),
    patch: (path, body = {}) => request("PATCH", path, body),
    del: (path) => request("DELETE", path),
    get session() {
      return session;
    },
    setSession,
    onUnauthorized(fn) {
      onUnauthorized = fn;
    },
    /** Imágenes privadas (comprobantes): se descargan con la sesión y se muestran como blob. */
    async privateImage(path) {
      const headers = session?.token ? { "X-Session-Token": session.token } : {};
      if (ANON_KEY) Object.assign(headers, { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` });
      const res = await fetch(assetUrl(path), { headers });
      if (!res.ok) throw new ApiError(res.status, "No se pudo cargar el comprobante");
      return URL.createObjectURL(await res.blob());
    },
  };
}
