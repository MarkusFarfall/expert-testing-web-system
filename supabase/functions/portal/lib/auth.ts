import { db } from "./db.ts";
import { adminSessions, authLimits, settings } from "./schema.ts";
import { and, asc, count, desc, eq, gt, gte, ilike, lt, sql } from "./drizzle.ts";
import { scrypt } from "npm:@noble/hashes@1.5.0/scrypt";
import { bytesToHex, utf8ToBytes } from "npm:@noble/hashes@1.5.0/utils";
import { PortalError } from "./store.ts";

export const adminHeader = "x-admin-token";
async function hash(s: string) {
  const digest = await crypto.subtle.digest("SHA-256", utf8ToBytes(s) as unknown as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}
function scryptHex(password: string, salt: string) { return bytesToHex(scrypt(utf8ToBytes(password), utf8ToBytes(salt), { N: 2 ** 14, r: 8, p: 1, dkLen: 64 })); }
function randomHex(bytes: number) { const b = new Uint8Array(bytes); crypto.getRandomValues(b); return bytesToHex(b); }
async function safeEqual(a: string, b: string) {
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
async function passwordSetting() { return (await db.select().from(settings).where(eq(settings.key, "admin_password")))[0]?.value; }

export async function isAdmin(token: string | null) {
  if (!token || token.length > 256) return false;
  const rows = await db.select().from(adminSessions).where(and(eq(adminSessions.id, await hash(token)), gt(adminSessions.expiresAt, new Date())));
  return rows.length > 0;
}
export async function requireAdmin(token: string | null) {
  if (!(await isAdmin(token))) throw new PortalError("Войдите в панель администратора.", 401);
}
export async function adminStatus(token: string | null) {
  return { authenticated: await isAdmin(token), setupRequired: !Deno.env.get("ADMIN_PASSWORD") && !(await passwordSetting()) };
}
export async function login(password: string, setup: boolean, ip: string, setupToken = "") {
  if (!password || password.length > 256) throw new PortalError("Введите пароль.");
  const key = await hash(ip || "edge");
  // Atomic increment and threshold: concurrent requests cannot overwrite each other's counts.
  const [limit] = await db.insert(authLimits).values({ key, failures: 1, resetAt: new Date(Date.now() + 900000) })
    .onConflictDoUpdate({ target: authLimits.key, set: {
      failures: sql`case when ${authLimits.resetAt} <= now() then 1 else ${authLimits.failures} + 1 end`,
      resetAt: sql`case when ${authLimits.resetAt} <= now() then now() + interval '15 minutes' else ${authLimits.resetAt} end`,
    } }).returning({ failures: authLimits.failures });
  if (limit.failures > 10) throw new PortalError("Слишком много попыток входа. Повторите через 15 минут.", 429);
  let encoded = await passwordSetting();
  if (!encoded && !Deno.env.get("ADMIN_PASSWORD")) {
    if (setup !== true) throw new PortalError("Сначала настройте доступ администратора.");
    if (password.length < 8) throw new PortalError("Используйте пароль не короче 8 символов.");
    const expectedSetupToken = Deno.env.get("ADMIN_SETUP_TOKEN");
    if (!expectedSetupToken || setupToken.length > 256 || !(await safeEqual(setupToken, expectedSetupToken))) {
      throw new PortalError("Для первого входа нужен код настройки сервера. Обратитесь к владельцу.", 403);
    }
    const salt = randomHex(16);
    encoded = `${salt}:${scryptHex(password, salt)}`;
    const created = await db.insert(settings).values({ key: "admin_password", value: encoded }).onConflictDoNothing().returning({ key: settings.key });
    if (!created.length) throw new PortalError("Доступ уже настроен. Войдите с установленным паролем.", 409);
  } else {
    let valid = false;
    const envPassword = Deno.env.get("ADMIN_PASSWORD");
    if (envPassword) valid = await safeEqual(password, envPassword);
    else if (encoded) { const [salt, digest] = encoded.split(":"); valid = await safeEqual(scryptHex(password, salt), digest); }
    if (!valid) throw new PortalError("Неверный пароль администратора.", 401);
  }
  const token = randomHex(32);
  await db.insert(adminSessions).values({ id: await hash(token), expiresAt: new Date(Date.now() + 86400000) });
  await db.delete(authLimits).where(eq(authLimits.key, key));
  await db.execute(sql`delete from admin_sessions where expires_at < now()`);
  return token;
}
export async function logout(token: string | null) {
  if (token) await db.delete(adminSessions).where(eq(adminSessions.id, await hash(token)));
}
