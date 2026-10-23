/**
 * La dirección del servidor vive en /config.js (fuera del paquete), para poder
 * cambiarla sin volver a compilar: window.TECNOCORE_CONFIG = { apiUrl, anonKey }.
 */
const raw = (typeof window !== "undefined" && window.TECNOCORE_CONFIG) || {};

export const API_URL = String(raw.apiUrl || "").replace(/\/+$/, "");
export const ANON_KEY = raw.anonKey || "";

/** Páginas del sitio, relativas a la carpeta actual (funciona en GitHub Pages). */
export const PAGES = {
  cliente: "index.html",
  admin: "admin.html",
  empleado: "empleado.html",
  rider: "rider.html",
};

export const HONDURAS_BANKS = [
  "BAC Credomatic",
  "Banco Atlántida",
  "Banco de Occidente",
  "Ficohsa",
  "Banpaís",
  "Banrural",
  "Davivienda",
  "Lafise",
  "Banco Azteca",
  "Promerica",
];
