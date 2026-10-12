import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { accessAttempt, createAttempt, deleteQuestion, ensureSeed, getOverview, getQuestionBank, listResults, PortalError, saveQuestion } from "@/lib/store";
import { adminCookie, adminStatus, isAdmin, login, logout, requireAdmin, visitorCookie } from "@/lib/auth";
import { importBank, importTemplate } from "@/lib/importer";
import { exportAttempt, exportStatistics, makePdf } from "@/lib/exports";
import { documents } from "@/lib/documents";

type Context = { params: Promise<{ path: string[] }> };
function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
function download(data: Uint8Array | ArrayBuffer, name: string, pdf = false) {
  return new Response(new Uint8Array(data instanceof ArrayBuffer ? data : data as Uint8Array), { headers: { "Content-Type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
export async function handle(request: NextRequest, context: Context) {
  try {
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
      if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && new URL(origin).host !== host)) throw new PortalError("Запрос с другого сайта запрещён.", 403);
    }
    await ensureSeed();
    const { path } = await context.params;
    const key = path.join("/"), method = request.method, params = request.nextUrl.searchParams;
    const visitor = request.cookies.get(visitorCookie)?.value;
    const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https", path: "/" };
    if (method === "GET" && key === "overview") return json(await getOverview());
    if (method === "GET" && key === "questions") return json(await getQuestionBank());
    if (method === "GET" && key === "results") return json(visitor ? await listResults(params, visitor) : []);
    if (method === "POST" && key === "tests") {
      const visitorId = visitor && /^[\da-f-]{36}$/i.test(visitor) ? visitor : randomUUID();
      const result = await createAttempt(await request.json(), visitorId);
      const response = json(result, 201);
      response.cookies.set(visitorCookie, visitorId, { ...cookieOptions, maxAge: 60 * 60 * 24 * 365 });
      return response;
    }
    if (path[0] === "tests" && path[1]) {
      const admin = await isAdmin(request);
      if (method === "GET" && path.length === 2) return json(await accessAttempt(path[1], visitor, admin));
      if (method === "PATCH" && path.length === 2) return json(await accessAttempt(path[1], visitor, false, "answer", await request.json()));
      if (method === "POST" && path[2] === "finish") return json(await accessAttempt(path[1], visitor, false, "finish"));
      if (method === "GET" && path[2] === "pdf") {
        const attempt = await accessAttempt(path[1], visitor, admin);
        if (attempt.status !== "completed") throw new PortalError("Сначала завершите тест.");
        return download(await exportAttempt(attempt), `ktpp-result-${path[1].slice(0, 8)}.pdf`, true);
      }
    }
    if (method === "GET" && path[0] === "documents" && path[1]) {
      const doc = documents.find((d) => d.id === path[1]);
      if (!doc) throw new PortalError("Документ не найден.", 404);
      return download(await makePdf(doc.title, `${doc.number} · Справочный материал платформы · Версия от ${doc.date}`, doc.sections), `ktpp-${doc.id}.pdf`, true);
    }
    if (key === "admin/session" && method === "GET") return json(await adminStatus(request));
    if (key === "admin/login" && method === "POST") {
      const token = await login(request, await request.json());
      const response = json({ authenticated: true, setupRequired: false });
      response.cookies.set(adminCookie, token, { ...cookieOptions, maxAge: 86400 });
      return response;
    }
    if (key === "admin/logout" && method === "POST") {
      await logout(request); const response = json({ ok: true }); response.cookies.delete(adminCookie); return response;
    }
    if (path[0] === "admin") {
      await requireAdmin(request);
      if (key === "admin/questions" && method === "GET") return json(await getQuestionBank(true));
      if (key === "admin/questions" && method === "POST") return json(await saveQuestion(await request.json()), 201);
      if (path[1] === "questions" && path[2] && method === "PATCH") return json(await saveQuestion(await request.json(), Number(path[2])));
      if (path[1] === "questions" && path[2] && method === "DELETE") return json(await deleteQuestion(Number(path[2])));
      if (key === "admin/import" && method === "POST") return json(await importBank(await request.formData()));
      if (key === "admin/template" && method === "GET") {
        const type = params.get("type") ?? "questions";
        return download(await importTemplate(type), type === "answers" ? "TableAnswers.xlsx" : "TableQuestions.xlsx");
      }
      if (key === "admin/stats" && method === "GET") return json(await listResults(params));
      if (key === "admin/export" && method === "GET") {
        const format = params.get("format") === "pdf" ? "pdf" : "xlsx";
        return download(await exportStatistics(await listResults(params), format, params), `ktpp-statistics.${format}`, format === "pdf");
      }
    }
    throw new PortalError("Страница не найдена.", 404);
  } catch (error) {
    if (error instanceof PortalError) return json({ error: error.message, details: error.details }, error.status);
    if (error instanceof SyntaxError) return json({ error: "Некорректный формат запроса." }, 400);
    console.error("Portal request failed:", error);
    return json({ error: "Не удалось выполнить запрос. Попробуйте ещё раз." }, 500);
  }
}
