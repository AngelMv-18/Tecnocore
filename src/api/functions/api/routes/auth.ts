/**
 * Portal de acceso: primer administrador, inicio y cierre de sesión, cambio de contraseña.
 */
import { type Db, one } from "../lib/db.ts";
import { ANY_USER, fail, PUBLIC, type Router } from "../lib/http.ts";
import { hashPassword, rateLimit, sha256, verifyPassword } from "../lib/security.ts";
import { createSession, getSettings, serializeUser, sessionToken } from "../lib/store.ts";
import { check } from "../lib/validate.ts";

/** Qué roles pueden entrar por cada portal. El admin también puede usar el punto de venta. */
const PORTAL_ROLES: Record<string, string[]> = {
  admin: ["admin"],
  empleado: ["empleado", "admin"],
  rider: ["rider"],
};

async function adminCount(db: Db): Promise<number> {
  const row = await one<{ n: number }>(db, "SELECT count(*)::int AS n FROM tc.users WHERE role = 'admin'");
  return row?.n ?? 0;
}

export function authRoutes(router: Router): void {
  router.on("GET", "/api/auth/setup", PUBLIC, async ({ db }) => {
    const settings = await getSettings(db);
    return { needsSetup: (await adminCount(db)) === 0, storeName: settings.storeName };
  });

  /**
   * Crea el primer administrador. Exige el código de configuración que se
   * entrega al dueño al instalar el sistema, para que nadie más pueda adelantarse.
   */
  router.on("POST", "/api/auth/setup", PUBLIC, async ({ db, body, ip }) => {
    await rateLimit(db, `setup:${ip}`, 5, 15 * 60);
    const b = await body();
    const stored = await one<{ v: string }>(db, "SELECT v FROM tc.settings WHERE k = 'setup_code_hash'");
    if (!stored) fail(503, "La configuración inicial no está habilitada");
    if ((await sha256(String(b.code ?? "").trim().toUpperCase())) !== stored.v) {
      fail(403, "El código de configuración no es correcto");
    }
    if ((await adminCount(db)) > 0) fail(409, "Ya existe un administrador. Iniciá sesión");

    const name = check.text(b.name, "Tu nombre", { max: 80 });
    const username = check.username(b.username);
    const password = check.password(b.password);

    const user = await db.tx(async (tx) => {
      const created = await one(
        tx,
        "INSERT INTO tc.users (role, username, password_hash, name) VALUES ('admin', $1, $2, $3) RETURNING *",
        [username, await hashPassword(password), name],
      );
      await tx.query("DELETE FROM tc.settings WHERE k = 'setup_code_hash'");
      return created!;
    });
    return { token: await createSession(db, user.id), user: serializeUser(user) };
  });

  router.on("POST", "/api/auth/login", PUBLIC, async ({ db, body, ip }) => {
    await rateLimit(db, `login:${ip}`, 10, 5 * 60);
    const b = await body();
    const portal = check.oneOf(b.portal, "El portal", ["admin", "empleado", "rider"] as const);
    const username = String(b.username ?? "").trim().toLowerCase();

    const user = await one(db, "SELECT * FROM tc.users WHERE username = $1 AND active", [username]);
    const valid = user ? await verifyPassword(String(b.password ?? ""), user.password_hash) : false;
    if (!user || !valid) fail(401, "Usuario o contraseña incorrectos");
    if (!PORTAL_ROLES[portal].includes(user.role)) fail(403, "Esta cuenta no tiene acceso a este portal");

    await db.query("DELETE FROM tc.sessions WHERE user_id = $1 AND expires_at < now()", [user.id]);
    return { token: await createSession(db, user.id), user: serializeUser(user) };
  });

  router.on("GET", "/api/auth/me", ANY_USER, async ({ user }) => ({ user: serializeUser(user) }));

  router.on("POST", "/api/auth/logout", ANY_USER, async ({ db, req }) => {
    await db.query("DELETE FROM tc.sessions WHERE token_hash = $1", [await sha256(sessionToken(req)!)]);
    return { ok: true };
  });

  router.on("POST", "/api/auth/password", ANY_USER, async ({ db, body, user, ip, req }) => {
    await rateLimit(db, `password:${ip}`, 5, 15 * 60);
    const b = await body();
    const row = await one(db, "SELECT password_hash FROM tc.users WHERE id = $1", [user.id]);
    if (!(await verifyPassword(String(b.current ?? ""), row?.password_hash))) fail(400, "La contraseña actual no es correcta");
    const next = check.password(b.next, "La nueva contraseña");
    await db.query("UPDATE tc.users SET password_hash = $1 WHERE id = $2", [await hashPassword(next), user.id]);
    // Cierra las demás sesiones de esta cuenta
    await db.query("DELETE FROM tc.sessions WHERE user_id = $1 AND token_hash <> $2", [user.id, await sha256(sessionToken(req)!)]);
    return { ok: true };
  });
}
