/**
 * Compila las cuatro páginas a /dist, listas para subir a GitHub Pages.
 *
 *   node web/build.mjs                       → dist/ con config.js de producción
 *   API_URL=http://localhost:8787 node web/build.mjs   → apunta al servidor local
 */
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const TOOLS = process.env.NODE_TOOLS || "/opt/npm-tools/node_modules";
const esbuild = require(join(TOOLS, "esbuild"));

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "..", "dist");

const PAGES = {
  index: { entry: "cliente/main.jsx", title: "Tecnocore · Componentes para PC gaming en Honduras", description: "Procesadores, tarjetas de video, memorias y más. Pedí por WhatsApp con envío a domicilio." },
  admin: { entry: "admin/main.jsx", title: "Tecnocore · Administración", robots: true },
  empleado: { entry: "empleado/main.jsx", title: "Tecnocore · Punto de venta", robots: true },
  rider: { entry: "rider/main.jsx", title: "Tecnocore · Entregas", robots: true },
};

const FONTS =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&family=Orbitron:wght@700;800;900&family=Space+Grotesk:wght@500;600;700&display=swap";

function html(name, page) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0d0e10" />
  <title>${page.title}</title>
  ${page.description ? `<meta name="description" content="${page.description}" />` : ""}
  ${page.robots ? '<meta name="robots" content="noindex, nofollow" />' : ""}
  <link rel="icon" href="assets/icon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="${FONTS}" />
  <link rel="stylesheet" href="assets/app.css" />
  <script src="config.js"></script>
</head>
<body>
  <div id="root"></div>
  <noscript>Necesitás activar JavaScript para usar esta página.</noscript>
  <script type="module" src="assets/${name}.js"></script>
</body>
</html>
`;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });

await esbuild.build({
  entryPoints: Object.fromEntries(Object.entries(PAGES).map(([name, p]) => [name, join(root, "src", p.entry)])),
  outdir: join(out, "assets"),
  bundle: true,
  splitting: true,
  format: "esm",
  minify: true,
  target: ["es2020", "chrome90", "safari15", "firefox90"],
  jsx: "automatic",
  chunkNames: "chunk-[hash]",
  nodePaths: [TOOLS],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  logLevel: "warning",
});

for (const [name, page] of Object.entries(PAGES)) writeFileSync(join(out, `${name}.html`), html(name, page));

cpSync(join(root, "styles", "app.css"), join(out, "assets", "app.css"));
if (existsSync(join(root, "assets"))) cpSync(join(root, "assets"), join(out, "assets"), { recursive: true });

const apiUrl = process.env.API_URL ?? readFileSync(join(root, "config.production.js"), "utf8").match(/apiUrl:\s*"([^"]*)"/)?.[1] ?? "";
const anonKey = process.env.ANON_KEY ?? readFileSync(join(root, "config.production.js"), "utf8").match(/anonKey:\s*"([^"]*)"/)?.[1] ?? "";
writeFileSync(
  join(out, "config.js"),
  `// Dirección del servidor de Tecnocore. Si cambiás de servidor, editá solo este archivo.\nwindow.TECNOCORE_CONFIG = {\n  apiUrl: "${apiUrl}",\n  anonKey: "${anonKey}",\n};\n`,
);
writeFileSync(join(out, ".nojekyll"), "");
console.log(`Listo: ${out}`);
