const { handleRequest } = await import("./lib/router.ts");
const visit = "99999999-8888-7777-6666-555555555555";
const H = { "content-type": "application/json", "x-visitor-id": visit };
async function call(path: string, init: RequestInit = {}) {
  const r = await handleRequest(new Request("https://test/portal/" + path, init));
  const text = await r.text(); let body: unknown = text; try { body = JSON.parse(text); } catch { /* текст */ }
  return { status: r.status, body: body as Record<string, unknown> };
}
// 1) админ
const login = await call("admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "ktpp12390" }) });
const token = login.body.token as string;
const A = { ...H, "x-admin-token": token };
console.log("1. вход админа:", login.status);
// 2) создаём тест
const exam = await call("admin/exams", { method: "POST", headers: A, body: JSON.stringify({ name: "Ден-тест страницы", description: "проверка" }) });
const examId = (exam.body as { id: number }).id; console.log("2. тест создан id=", examId, "| русский текст:", (exam.body as { name: string }).name);
// 3) импорт (JSON как его отправит браузер)
const questions = [1,2,3].map((n) => ({ id: n, text: `Вопрос № ${n} ден-теста?`, blockId: 1, number: n }));
const answers = [
  { id: 1, questionId: 1, number: 1, text: "Верный 1", correct: true }, { id: 2, questionId: 1, number: 2, text: "Неверный", correct: false },
  { id: 3, questionId: 2, number: 1, text: "Неверный", correct: false }, { id: 4, questionId: 2, number: 2, text: "Верный 2", correct: true },
  { id: 5, questionId: 3, number: 1, text: "Верный 3", correct: true }, { id: 6, questionId: 3, number: 2, text: "Неверный", correct: false },
];
const imp = await call("admin/import", { method: "POST", headers: A, body: JSON.stringify({ examId, questions, answers, normalized: 4 }) });
console.log("3. импорт:", imp.status, JSON.stringify(imp.body).slice(0, 150));
// 4) прохождение
const att = await call("tests", { method: "POST", headers: H, body: JSON.stringify({ fullName: "Ден Проверка", mode: "general", examId }) });
const id = (att.body as { id: string }).id; console.log("4. попытка:", att.status, id?.slice(0, 8));
const view = await call(`tests/${id}`, { headers: H });
const qs = (view.body as { questions: { id: number; answers: { id: number }[] }[] }).questions;
console.log("   вопросы пришли:", qs.length, "| examName:", (view.body as { examName: string }).examName);
for (const [i, q] of qs.entries()) await call(`tests/${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ questionId: q.id, answerId: q.answers[i === 0 ? 0 : 1].id }) });
const fin = await call(`tests/${id}/finish`, { method: "POST", headers: H });
console.log("5. финиш:", fin.status, "верных:", (fin.body as { correctCount: number }).correctCount, "из", (fin.body as { total: number }).total);
// 6) мои результаты
const res = await call("results", { headers: H });
console.log("6. мои результаты:", res.status, JSON.stringify(res.body).slice(0, 130));
// 7) админ-статистика
const stats = await call("admin/stats", { headers: A });
console.log("7. статистика (строк):", (stats.body as unknown[]).length, "| последняя:", JSON.stringify((stats.body as Record<string, unknown>[])[0]).slice(0, 130));
// 8) удаление теста + копия + восстановление
const del = await call(`admin/exams/${examId}`, { method: "DELETE", headers: A });
console.log("8. удаление:", JSON.stringify(del.body));
const bks = await call("admin/backups", { headers: A });
const bid = (bks.body as { id: number }[])[0]?.id;
const rest = await call(`admin/backups/${bid}`, { method: "POST", headers: A });
console.log("   восстановление копии", bid, "→", JSON.stringify(rest.body).slice(0, 120));
// уборка
await call(`admin/exams/${(rest.body as { id: number }).id}`, { method: "DELETE", headers: A });
await call(`admin/backups/${bid}`, { method: "DELETE", headers: A });
await call("admin/logout", { method: "POST", headers: A });
console.log("уборка выполнена");
