/**
 * Servidor local para desarrollo y pruebas (Bun + Postgres local).
 * Corre exactamente el mismo código que la Edge Function de Supabase.
 *
 *   DATABASE_URL=postgres://postgres@localhost:54329/postgres PORT=8787 bun api/local/server.ts
 */
import { SQL } from "bun";
import { createApp } from "../functions/api/app.ts";
import { createDb } from "../functions/api/lib/db.ts";

const sql = new SQL(process.env.DATABASE_URL || "postgres://postgres@localhost:54329/postgres");
const handle = createApp(createDb(sql as any));
const port = Number(process.env.PORT || 8787);

Bun.serve({
  port,
  fetch: (req, server) => handle(req, server.requestIP(req)?.address ?? ""),
});

console.log(`Tecnocore API local en http://localhost:${port}`);
