import { db } from "@/db";
import { answers, attempts, exams, questions, settings } from "@/db/schema";
import { and, asc, count, desc, eq, gte, ilike, lt, sql } from "drizzle-orm";
import { randomInt, randomUUID } from "node:crypto";
import { seedBank } from "@/lib/seed";
import { blockCatalog, type AttemptData, type ExamData, type Overview, type QuestionData, type ResultRow } from "@/lib/types";

export class PortalError extends Error {
  constructor(message: string, public status = 400, public details?: string[]) { super(message); }
}
let ready: Promise<void> | undefined;
export function ensureSeed() {
  if (!ready) ready = db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(82341)`);
    if ((await tx.select().from(settings).where(eq(settings.key, "initialized"))).length) return;
    const existing = await tx.select({ value: count() }).from(questions);
    const [defaultExam] = await tx.insert(exams).values({ name: "Учебный банк", description: "Демонстрационные вопросы платформы" }).onConflictDoNothing().returning({ id: exams.id });
    const examId = defaultExam?.id ?? (await tx.select({ id: exams.id }).from(exams).where(eq(exams.name, "Учебный банк")))[0].id;
    await tx.update(questions).set({ examId }).where(sql`${questions.examId} is null`);
    await tx.update(attempts).set({ examId }).where(sql`${attempts.examId} is null`);
    if (!existing[0].value) {
      const numbers: Record<number, number> = {};
      const qRows = seedBank.map(([blockId, text], i) => ({ id: i + 1, examId, text, blockId, number: numbers[blockId] = (numbers[blockId] || 0) + 1 }));
      await tx.insert(questions).values(qRows);
      let aid = 0;
      await tx.insert(answers).values(seedBank.flatMap(([, , options, correct], i) => options.map((text, n) => ({ id: ++aid, questionId: i + 1, text, number: n + 1, correct: n === correct ? 1 : null }))));
    }
    await tx.insert(settings).values([
      { key: "initialized", value: "1" },
      { key: "bank_updated", value: new Date().toISOString() },
      { key: "demo_bank", value: existing[0].value ? "0" : "1" },
    ]).onConflictDoNothing();
  }).catch((error) => { ready = undefined; throw error; });
  return ready;
}
export async function listExams(): Promise<ExamData[]> {
  await ensureSeed();
  const rows = await db.select({
    id: exams.id, name: exams.name, description: exams.description,
    questionCount: count(questions.id),
    blockCount: sql<number>`count(distinct ${questions.blockId})`.mapWith(Number),
  }).from(exams).leftJoin(questions, eq(questions.examId, exams.id)).groupBy(exams.id).orderBy(asc(exams.id));
  return rows.map((r) => ({ ...r, questionCount: Number(r.questionCount), blockCount: Number(r.blockCount) }));
}
function examName(input: unknown) {
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  if (name.length < 3 || name.length > 180) throw new PortalError("Название теста: от 3 до 180 символов.");
  return name;
}
export async function createExam(input: Record<string, unknown>): Promise<ExamData> {
  const name = examName(input.name);
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 500) : "";
  const [exam] = await db.insert(exams).values({ name, description }).onConflictDoNothing().returning();
  if (!exam) throw new PortalError("Тест с таким названием уже существует.", 409);
  return { id: exam.id, name: exam.name, description: exam.description, questionCount: 0, blockCount: 0 };
}
export async function updateExam(id: number, input: Record<string, unknown>) {
  if (!Number.isSafeInteger(id) || id < 1) throw new PortalError("Некорректный идентификатор теста.");
  const [exam] = await db.select().from(exams).where(eq(exams.id, id));
  if (!exam) throw new PortalError("Тест не найден.", 404);
  const patch: { name?: string; description?: string } = {};
  if (input.name !== undefined) patch.name = examName(input.name);
  if (input.description !== undefined) patch.description = typeof input.description === "string" ? input.description.trim().slice(0, 500) : "";
  if (Object.keys(patch).length) await db.update(exams).set(patch).where(eq(exams.id, id));
  return { ok: true };
}
export async function deleteExam(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new PortalError("Некорректный идентификатор теста.");
  const deleted = await db.delete(exams).where(eq(exams.id, id)).returning();
  if (!deleted.length) throw new PortalError("Тест не найден.", 404);
  return { ok: true };
}
export async function getOverview(examId?: number): Promise<Overview> {
  await ensureSeed();
  const scoped = examId !== undefined;
  if (scoped && !(await db.select({ id: exams.id }).from(exams).where(eq(exams.id, examId))).length) throw new PortalError("Тест не найден.", 404);
  const [rows, completed, meta, examList] = await Promise.all([
    db.select({ id: questions.blockId, count: count() }).from(questions)
      .where(scoped ? eq(questions.examId, examId) : sql`true`)
      .groupBy(questions.blockId).orderBy(asc(questions.blockId)),
    db.select({ value: count() }).from(attempts).where(scoped ? and(eq(attempts.status, "completed"), eq(attempts.examId, examId)) : eq(attempts.status, "completed")),
    db.select().from(settings),
    listExams(),
  ]);
  return {
    questionCount: rows.reduce((n, r) => n + r.count, 0), blockCount: rows.length, completedCount: completed[0].value,
    blocks: rows.map((b) => ({ ...b, title: blockCatalog.find((c) => c.id === b.id)?.title ?? `Тематический блок № ${b.id}`, description: blockCatalog.find((c) => c.id === b.id)?.description ?? "Вопросы из импортированного банка" })),
    updatedAt: meta.find((m) => m.key === "bank_updated")?.value ?? new Date().toISOString(),
    isDemo: meta.find((m) => m.key === "demo_bank")?.value === "1",
    exams: examList,
  };
}
export async function getQuestionBank(withCorrect = false, examId?: number): Promise<QuestionData[]> {
  await ensureSeed();
  const [qs, ans] = await Promise.all([
    db.select().from(questions).where(examId !== undefined ? eq(questions.examId, examId) : sql`true`).orderBy(asc(questions.blockId), asc(questions.number)),
    db.select().from(answers).orderBy(asc(answers.number)),
  ]);
  const grouped = new Map<number, QuestionData["answers"]>();
  for (const a of ans) {
    if (!grouped.has(a.questionId)) grouped.set(a.questionId, []);
    grouped.get(a.questionId)!.push({ id: a.id, text: a.text, number: a.number, ...(withCorrect ? { correct: a.correct === 1 } : {}) });
  }
  return qs.map((q) => ({ ...q, answers: grouped.get(q.id) ?? [] }));
}
export function validateName(input: unknown) {
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  if (name.length < 5 || name.length > 180 || name.split(" ").length < 2 || !/^[\p{L}\s.'’\-]+$/u.test(name)) throw new PortalError("Укажите фамилию и имя; отчество — при наличии.");
  return name;
}
function integer(input: unknown, name: string, min: number, max: number) {
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new PortalError(`${name}: допустимое значение от ${min} до ${max}.`);
  return value;
}
export async function createAttempt(input: Record<string, unknown>, visitorId: string) {
  const fullName = validateName(input.fullName);
  if (input.mode !== "general" && input.mode !== "selective") throw new PortalError("Выберите режим тестирования.");
  const examId = integer(input.examId, "Идентификатор теста", 1, 2147483647);
  if (!(await db.select({ id: exams.id }).from(exams).where(eq(exams.id, examId))).length) throw new PortalError("Выбранный тест не найден.", 404);
  const all = await getQuestionBank(true, examId);
  let selected = all;
  if (input.mode === "general") {
    const blockId = input.blockId ? integer(input.blockId, "Номер блока", 1, 2147483647) : null;
    const from = input.from ? integer(input.from, "Начало диапазона", 1, 2147483647) : 1;
    const to = input.to ? integer(input.to, "Конец диапазона", 1, 2147483647) : 2147483647;
    if (from > to) throw new PortalError("Начало диапазона не может быть больше его конца.");
    selected = all.filter((q) => (!blockId || q.blockId === blockId) && q.number >= from && q.number <= to);
  } else {
    const amount = integer(input.perBlock ?? 2, "Вопросов из каждого блока", 1, 100);
    selected = [];
    for (const blockId of new Set(all.map((q) => q.blockId))) {
      const group = all.filter((q) => q.blockId === blockId);
      if (group.length < amount) throw new PortalError(`В блоке № ${blockId} только ${group.length} вопросов. Уменьшите размер билета.`);
      for (let i = group.length - 1; i > 0; i--) { const j = randomInt(i + 1); [group[i], group[j]] = [group[j], group[i]]; }
      selected.push(...group.slice(0, amount));
    }
  }
  if (!selected.length) throw new PortalError("По выбранным условиям нет вопросов. Измените диапазон или блок.");
  if (selected.some((q) => q.answers.length < 2 || q.answers.filter((a) => a.correct).length !== 1)) throw new PortalError("Банк вопросов содержит ошибку. Обратитесь к администратору.", 409);
  const timer = integer(input.timerMinutes ?? 0, "Время теста", 0, 180);
  const id = randomUUID();
  await db.insert(attempts).values({ id, visitorId, fullName, mode: input.mode, snapshot: selected, total: selected.length, timeLimit: timer * 60, examId });
  return { id };
}
type AttemptRow = typeof attempts.$inferSelect;
function publicAttempt(row: AttemptRow, examName: string | null = null): AttemptData {
  return {
    examId: row.examId, examName,
    id: row.id, fullName: row.fullName, mode: row.mode, status: row.status,
    startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
    questions: row.snapshot.map((q) => ({ ...q, answers: q.answers.map(({ correct, ...a }) => ({ ...a, ...(row.status === "completed" ? { correct } : {}) })) })),
    responses: row.responses, total: row.total, correctCount: row.correctCount,
    percentage: Math.round(row.correctCount / row.total * 100), timeLimit: row.timeLimit,
  };
}
export async function accessAttempt(id: string, visitorId?: string, admin = false, action?: "answer" | "finish", input?: Record<string, unknown>): Promise<AttemptData> {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) throw new PortalError("Тест не найден.", 404);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(attempts).where(eq(attempts.id, id)).for("update");
    const examRow = row?.examId ? (await tx.select({ name: exams.name }).from(exams).where(eq(exams.id, row.examId)))[0] : null;
    if (!row || (!admin && row.visitorId !== visitorId)) throw new PortalError("Тест не найден в вашей сессии.", 404);
    const expired = row.timeLimit > 0 && Date.now() >= row.startedAt.getTime() + row.timeLimit * 1000;
    if (row.status === "active" && (action === "finish" || expired)) {
      row.status = "completed";
      row.finishedAt = expired ? new Date(row.startedAt.getTime() + row.timeLimit * 1000) : new Date();
      row.correctCount = row.snapshot.filter((q) => q.answers.some((a) => a.correct && a.id === row.responses[q.id])).length;
      await tx.update(attempts).set({ status: row.status, finishedAt: row.finishedAt, correctCount: row.correctCount }).where(eq(attempts.id, id));
    } else if (action === "answer" && row.status === "active") {
      const questionId = Number(input?.questionId), answerId = Number(input?.answerId);
      const q = row.snapshot.find((q) => q.id === questionId);
      if (!q?.answers.some((a) => a.id === answerId)) throw new PortalError("Выбранный ответ не относится к вопросу.");
      row.responses = { ...row.responses, [questionId]: answerId };
      await tx.update(attempts).set({ responses: row.responses }).where(eq(attempts.id, id));
    }
    return publicAttempt(row, examRow?.name ?? null);
  });
}
export async function listResults(params: URLSearchParams, visitorId?: string): Promise<ResultRow[]> {
  const conditions = [eq(attempts.status, "completed")];
  if (visitorId) conditions.push(eq(attempts.visitorId, visitorId));
  const name = params.get("name")?.trim();
  if (name) conditions.push(ilike(attempts.fullName, `%${name.replace(/[\\%_]/g, "\\$&")}%`));
  for (const key of ["from", "to"]) {
    const value = params.get(key);
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new PortalError("Укажите корректный период.");
    const date = new Date(`${value}T00:00:00+02:00`);
    if (key === "from") conditions.push(gte(attempts.finishedAt, date));
    else conditions.push(lt(attempts.finishedAt, new Date(date.getTime() + 86400000)));
  }
  const exam = params.get("exam");
  if (exam) conditions.push(eq(attempts.examId, integer(exam, "Идентификатор теста", 1, 2147483647)));
  if (params.get("from") && params.get("to") && params.get("from")! > params.get("to")!) throw new PortalError("Начало периода позже его окончания.");
  const rows = await db.select({ id: attempts.id, fullName: attempts.fullName, mode: attempts.mode, startedAt: attempts.startedAt, finishedAt: attempts.finishedAt, total: attempts.total, correctCount: attempts.correctCount, examName: exams.name }).from(attempts).leftJoin(exams, eq(attempts.examId, exams.id)).where(and(...conditions)).orderBy(desc(attempts.finishedAt));
  return rows.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, percentage: Math.round(r.correctCount / r.total * 100), examName: r.examName ?? null }));
}
export async function saveQuestion(input: Record<string, unknown>, id?: number) {
  if (id !== undefined && (!Number.isSafeInteger(id) || id < 1)) throw new PortalError("Некорректный идентификатор вопроса.");
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text || text.length > 10000) throw new PortalError("Введите текст вопроса (до 10 000 символов).");
  const blockId = integer(input.blockId, "Номер блока", 1, 2147483647);
  const number = integer(input.number, "Номер вопроса", 1, 2147483647);
  if (!Array.isArray(input.answers) || input.answers.length < 2 || input.answers.length > 20) throw new PortalError("Укажите от 2 до 20 вариантов ответа.");
  const options = input.answers.map((a: unknown, n: number) => {
    if (!a || typeof a !== "object" || !("text" in a) || typeof a.text !== "string" || !a.text.trim() || a.text.length > 10000) throw new PortalError(`Заполните вариант ответа № ${n + 1}.`);
    const text = a.text.trimStart().replace(/^\d+\.\s+/, "").trim();
    if (!text) throw new PortalError(`Вариант ответа № ${n + 1} пуст после удаления нумерации.`);
    return { text, correct: "correct" in a && a.correct === true ? 1 : null, number: n + 1 };
  });
  if (options.filter((a) => a.correct === 1).length !== 1) throw new PortalError("Отметьте ровно один правильный ответ.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(82341)`);
    let examId: number;
    if (id) {
      const [existing] = await tx.select().from(questions).where(eq(questions.id, id));
      if (!existing) throw new PortalError("Вопрос не найден.", 404);
      examId = existing.examId;
    } else {
      examId = integer(input.examId, "Идентификатор теста", 1, 2147483647);
      if (!(await tx.select({ id: exams.id }).from(exams).where(eq(exams.id, examId))).length) throw new PortalError("Выбранный тест не найден.", 404);
    }
    const duplicate = await tx.select().from(questions).where(and(eq(questions.examId, examId), eq(questions.blockId, blockId), eq(questions.number, number)));
    if (duplicate.some((q) => q.id !== id)) throw new PortalError("В этом блоке уже есть вопрос с таким порядковым номером.", 409);
    if (id) {
      await tx.update(questions).set({ text, blockId, number }).where(eq(questions.id, id));
      await tx.delete(answers).where(eq(answers.questionId, id));
    } else {
      const [last] = await tx.select({ id: sql<number>`coalesce(max(${questions.id}), 0)` }).from(questions);
      id = Number(last.id) + 1;
      await tx.insert(questions).values({ id, examId, text, blockId, number });
    }
    const [lastAnswer] = await tx.select({ id: sql<number>`coalesce(max(${answers.id}), 0)` }).from(answers);
    await tx.insert(answers).values(options.map((a, i) => ({ ...a, id: Number(lastAnswer.id) + i + 1, questionId: id! })));
    await tx.insert(settings).values({ key: "bank_updated", value: new Date().toISOString() }).onConflictDoUpdate({ target: settings.key, set: { value: new Date().toISOString() } });
    return { id };
  });
}
export async function deleteQuestion(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new PortalError("Некорректный номер вопроса.");
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(82341)`);
    const deleted = await tx.delete(questions).where(eq(questions.id, id)).returning();
    if (!deleted.length) throw new PortalError("Вопрос не найден.", 404);
    await tx.update(settings).set({ value: new Date().toISOString() }).where(eq(settings.key, "bank_updated"));
  });
  return { ok: true };
}
