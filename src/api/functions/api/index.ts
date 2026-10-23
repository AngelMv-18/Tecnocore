/**
 * Punto de entrada en Supabase Edge Functions (Deno).
 * Supabase define SUPABASE_DB_URL automáticamente con la conexión a la base.
 */
import postgres from "npm:postgres@3.4.5";
import { createApp } from "./app.ts";
import { createDb } from "./lib/db.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, {
  max: 3,
  prepare: false, // compatible con el pooler de conexiones de Supabase
  idle_timeout: 20,
});

const handle = createApp(createDb(sql as any));

Deno.serve((req, info) => handle(req, (info?.remoteAddr as Deno.NetAddr | undefined)?.hostname ?? ""));
