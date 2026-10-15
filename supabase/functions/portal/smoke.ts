// Destructive integration checks: isolated database only, never the production DB.
if (Deno.env.get("ALLOW_TEST_DB_WRITES") !== "yes") throw new Error("Set ALLOW_TEST_DB_WRITES=yes only for an isolated test database.");
const testPassword = Deno.env.get("TEST_ADMIN_PASSWORD");
if (!testPassword) throw new Error("TEST_ADMIN_PASSWORD is required.");
// Локальный прогон роутера без сети: обращаемся напрямую к handleRequest
Deno.env.set("DB_URL", Deno.env.get("DB_URL")!);
const { handleRequest } = await import("./lib/router.ts");
async function call(path: string, init: RequestInit = {}) {
  const r = await handleRequest(new Request("https://test/portal/" + path, init));
  const text = await r.text();
  let body: unknown = text; try { body = JSON.parse(text); } catch { /* оставим как текст */ }
  return { status: r.status, body };
}
const visit = "11111111-2222-3333-4444-555555555555";
console.log("exams:", JSON.stringify(await call("exams")));
console.log("overview:", JSON.stringify(await call("overview")).slice(0, 220));
console.log("questions (публичный):", JSON.stringify(await call("questions")).slice(0, 200));
console.log("results без visitor:", JSON.stringify(await call("results")));
console.log("admin/session без токена:", JSON.stringify(await call("admin/session")));
console.log("admin/exams без токена:", JSON.stringify(await call("admin/exams")));
console.log("login неверный:", JSON.stringify(await call("admin/login", { method: "POST", body: JSON.stringify({ password: "неверный-пароль" }), headers: { "content-type": "application/json" } })));
const authenticated = await call("admin/login", { method: "POST", body: JSON.stringify({ password: testPassword }), headers: { "content-type": "application/json" } });
console.log("login верный: HTTP", authenticated.status); // never print the returned session token
