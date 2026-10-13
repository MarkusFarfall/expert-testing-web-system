import { db } from "./db.ts";
import { adminSessions, authLimits, settings } from "./schema.ts";
import { and, asc, count, desc, eq, gt, gte, ilike, lt, sql } from "./drizzle.ts";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { PortalError } from "./store.ts";

export const adminHeader = "x-admin-token";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function safeEqual(a: string, b: string) { return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b))); }
async function passwordSetting() { return (await db.select().from(settings).where(eq(settings.key, "admin_password")))[0]?.value; }

export async function isAdmin(token: string | null) {
  if (!token || token.length > 256) return false;
  const rows = await db.select().from(adminSessions).where(and(eq(adminSessions.id, hash(token)), gt(adminSessions.expiresAt, new Date())));
  return rows.length > 0;
}
export async function requireAdmin(token: string | null) {
  if (!(await isAdmin(token))) throw new PortalError("Войдите в панель администратора.", 401);
}
export async function adminStatus(token: string | null) {
  return { authenticated: await isAdmin(token), setupRequired: !Deno.env.get("ADMIN_PASSWORD") && !(await passwordSetting()) };
}
export async function login(password: string, setup: boolean, ip: string) {
  if (!password || password.length > 256) throw new PortalError("Введите пароль.");
  const key = hash(ip || "edge");
  const [limit] = await db.select().from(authLimits).where(eq(authLimits.key, key));
  if (limit && limit.resetAt > new Date() && limit.failures >= 10) throw new PortalError("Слишком много попыток входа. Повторите через 15 минут.", 429);
  await db.insert(authLimits).values({ key, failures: 1, resetAt: new Date(Date.now() + 900000) })
    .onConflictDoUpdate({ target: authLimits.key, set: { failures: (limit?.resetAt && limit.resetAt > new Date() ? limit.failures : 0) + 1, resetAt: new Date(Date.now() + 900000) } });
  let encoded = await passwordSetting();
  if (!encoded && !Deno.env.get("ADMIN_PASSWORD")) {
    if (setup !== true) throw new PortalError("Сначала настройте доступ администратора.");
    if (password.length < 8) throw new PortalError("Используйте пароль не короче 8 символов.");
    const salt = randomBytes(16).toString("hex");
    encoded = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
    await db.insert(settings).values({ key: "admin_password", value: encoded }).onConflictDoNothing();
  } else {
    let valid = false;
    const envPassword = Deno.env.get("ADMIN_PASSWORD");
    if (envPassword) valid = safeEqual(password, envPassword);
    else if (encoded) { const [salt, digest] = encoded.split(":"); valid = safeEqual(scryptSync(password, salt, 64).toString("hex"), digest); }
    if (!valid) throw new PortalError("Неверный пароль администратора.", 401);
  }
  const token = randomBytes(32).toString("hex");
  await db.insert(adminSessions).values({ id: hash(token), expiresAt: new Date(Date.now() + 86400000) });
  await db.delete(authLimits).where(eq(authLimits.key, key));
  await db.execute(sql`delete from admin_sessions where expires_at < now()`);
  return token;
}
export async function logout(token: string | null) {
  if (token) await db.delete(adminSessions).where(eq(adminSessions.id, hash(token)));
}
