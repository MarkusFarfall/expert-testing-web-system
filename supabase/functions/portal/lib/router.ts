import { accessAttempt, createAttempt, createExam, deleteBackup, deleteExam, deleteQuestion, ensureSeed, getOverview, getQuestionBank, listBackups, listExams, listResults, PortalError, restoreBackup, saveQuestion, updateExam } from "./store.ts";
import { adminHeader, adminStatus, isAdmin, login, logout, requireAdmin } from "./auth.ts";
import { importBankJson } from "./import.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-admin-token, x-visitor-id",
  "Access-Control-Max-Age": "86400",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
const uuid = /^[\da-f-]{36}$/i;
export async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    await ensureSeed();
    const url = new URL(request.url);
    const key = url.pathname.replace(/^.*\/portal\/?/, "").replace(/\/$/, "");
    const path = key ? key.split("/") : [];
    const method = request.method, params = url.searchParams;
    const adminToken = request.headers.get(adminHeader);
    const visitorHeader = request.headers.get("x-visitor-id");
    const visitor = visitorHeader && uuid.test(visitorHeader) ? visitorHeader : null;
    const examParam = params.get("examId");
    const examId = examParam && /^\d+$/.test(examParam) ? Number(examParam) : undefined;
    if (method === "GET" && key === "exams") return json(await listExams());
    if (method === "GET" && key === "overview") return json(await getOverview(examId));
    if (method === "GET" && key === "questions") return json(await getQuestionBank(false, examId));
    if (method === "GET" && key === "results") return json(visitor ? await listResults(params, visitor) : []);
    if (method === "POST" && key === "tests") {
      const visitorId = visitor ?? crypto.randomUUID();
      const result = await createAttempt(await request.json(), visitorId);
      return new Response(JSON.stringify(result), { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store", "x-visitor-id": visitorId } });
    }
    if (path[0] === "tests" && path[1]) {
      const admin = await isAdmin(adminToken);
      if (method === "GET" && path.length === 2) return json(await accessAttempt(path[1], visitor ?? undefined, admin));
      if (method === "PATCH" && path.length === 2) return json(await accessAttempt(path[1], visitor ?? undefined, false, "answer", await request.json()));
      if (method === "POST" && path[2] === "finish") return json(await accessAttempt(path[1], visitor ?? undefined, false, "finish"));
    }
    if (key === "admin/session" && method === "GET") return json(await adminStatus(adminToken));
    if (key === "admin/login" && method === "POST") {
      const input = await request.json();
      const password = typeof input?.password === "string" ? input.password : "";
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "edge";
      const token = await login(password, input?.setup === true, ip);
      return json({ authenticated: true, setupRequired: false, token });
    }
    if (key === "admin/logout" && method === "POST") { await logout(adminToken); return json({ ok: true }); }
    if (path[0] === "admin") {
      await requireAdmin(adminToken);
      if (key === "admin/exams" && method === "GET") return json(await listExams());
      if (key === "admin/exams" && method === "POST") return json(await createExam(await request.json()), 201);
      if (path[1] === "exams" && path[2] && method === "PATCH") return json(await updateExam(Number(path[2]), await request.json()));
      if (path[1] === "exams" && path[2] && method === "DELETE") return json(await deleteExam(Number(path[2])));
      if (key === "admin/backups" && method === "GET") return json(await listBackups());
      if (path[1] === "backups" && path[2] && method === "POST") return json(await restoreBackup(Number(path[2])));
      if (path[1] === "backups" && path[2] && method === "DELETE") return json(await deleteBackup(Number(path[2])));
      if (key === "admin/questions" && method === "GET") return json(await getQuestionBank(true, examId));
      if (key === "admin/questions" && method === "POST") return json(await saveQuestion(await request.json()), 201);
      if (path[1] === "questions" && path[2] && method === "PATCH") return json(await saveQuestion(await request.json(), Number(path[2])));
      if (path[1] === "questions" && path[2] && method === "DELETE") return json(await deleteQuestion(Number(path[2])));
      if (key === "admin/import" && method === "POST") return json(await importBankJson(await request.json()));
      if (key === "admin/stats" && method === "GET") return json(await listResults(params));
    }
    throw new PortalError("Страница не найдена.", 404);
  } catch (error) {
    if (error instanceof PortalError) return json({ error: error.message, details: error.details }, error.status);
    if (error instanceof SyntaxError) return json({ error: "Некорректный формат запроса." }, 400);
    console.error("Portal request failed:", error);
    return json({ error: "Не удалось выполнить запрос. Попробуйте ещё раз." }, 500);
  }
}
