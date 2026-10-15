import { db } from "@/db";
import { adminSessions, authLimits, settings } from "@/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { PortalError } from "@/lib/store";

export const adminCookie = "ktpp_admin";
export const visitorCookie = "ktpp_visitor";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function safeEqual(a: string, b: string) { return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b))); }
async function passwordSetting() { return (await db.select().from(settings).where(eq(settings.key, "admin_password")))[0]?.value; }
export async function isAdmin(request: NextRequest) {
  const token = request.cookies.get(adminCookie)?.value;
  if (!token) return false;
  return (await db.select().from(adminSessions).where(and(eq(adminSessions.id, hash(token)), gt(adminSessions.expiresAt, new Date())))).length > 0;
}
export async function requireAdmin(request: NextRequest) {
  if (!(await isAdmin(request))) throw new PortalError("Войдите в панель администратора.", 401);
}
export async function adminStatus(request: NextRequest) {
  return { authenticated: await isAdmin(request), setupRequired: !process.env.ADMIN_PASSWORD && !(await passwordSetting()) };
}
export async function login(request: NextRequest, input: Record<string, unknown>) {
  const password = typeof input.password === "string" ? input.password : "";
  if (password.length > 256 || !password) throw new PortalError("Введите пароль.");
  const key = hash(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local");
  const [limit] = await db.select().from(authLimits).where(eq(authLimits.key, key));
  if (limit && limit.resetAt > new Date() && limit.failures >= 10) throw new PortalError("Слишком много попыток входа. Повторите через 15 минут.", 429);
  await db.insert(authLimits).values({ key, failures: 1, resetAt: new Date(Date.now() + 900000) }).onConflictDoUpdate({ target: authLimits.key, set: { failures: sql`case when ${authLimits.resetAt} < now() then 1 else ${authLimits.failures} + 1 end`, resetAt: sql`case when ${authLimits.resetAt} < now() then now() + interval '15 minutes' else ${authLimits.resetAt} end` } });
  let encoded = await passwordSetting();
  if (!encoded && !process.env.ADMIN_PASSWORD) {
    if (input.setup !== true) throw new PortalError("Сначала настройте доступ администратора.");
    if (password.length < 8) throw new PortalError("Используйте пароль не короче 8 символов.");
    const expected = process.env.ADMIN_SETUP_TOKEN;
    const setupToken = typeof input.setupToken === "string" ? input.setupToken : "";
    if (!expected || setupToken.length > 256 || !safeEqual(setupToken, expected)) throw new PortalError("Для первого входа нужен код настройки сервера.", 403);
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(82342)`);
      if ((await tx.select().from(settings).where(eq(settings.key, "admin_password"))).length) throw new PortalError("Доступ уже настроен. Войдите с установленным паролем.", 409);
      const salt = randomBytes(16).toString("hex");
      encoded = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
      await tx.insert(settings).values({ key: "admin_password", value: encoded });
    });
  } else {
    let valid = false;
    if (process.env.ADMIN_PASSWORD) valid = safeEqual(password, process.env.ADMIN_PASSWORD);
    else if (encoded) { const [salt, digest] = encoded.split(":"); valid = safeEqual(scryptSync(password, salt, 64).toString("hex"), digest); }
    if (!valid) throw new PortalError("Неверный пароль администратора.", 401);
  }
  const token = randomBytes(32).toString("hex");
  await db.insert(adminSessions).values({ id: hash(token), expiresAt: new Date(Date.now() + 86400000) });
  await db.delete(authLimits).where(eq(authLimits.key, key));
  return token;
}
export async function logout(request: NextRequest) {
  const token = request.cookies.get(adminCookie)?.value;
  if (token) await db.delete(adminSessions).where(eq(adminSessions.id, hash(token)));
}
