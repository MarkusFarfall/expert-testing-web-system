import { db } from "./db.ts";
import { answers, attempts, bankBackups, examBlocks, exams, questions, settings } from "./schema.ts";
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, lt, sql } from "./drizzle.ts";
import { seedBank } from "./seed.ts";
import type { AttemptData, BlockData, ExamData, Overview, QuestionData, ResultRow } from "./types.ts";

export class PortalError extends Error {
  constructor(message: string, public status = 400, public details?: string[]) { super(message); }
}
let ready: Promise<void> | undefined;
export function ensureSeed() {
  if (!ready) ready = initSeed().catch((error) => { ready = undefined; throw error; });
  return ready;
}
async function initSeed() {
  // Быстрый путь: база уже инициализирована — не берём блокировку и не открываем транзакцию.
  const flag = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "initialized"));
  if (flag.length) return;
  await db.transaction(async (tx) => {
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
  });
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
type BankRow = { blockId: number; number: number; text: string; answers: { number: number; text: string; correct: boolean }[] };
export async function backupBank(examId: number, reason: string) {
  const [exam] = await db.select().from(exams).where(eq(exams.id, examId));
  if (!exam) return null;
  const qs = await db.select().from(questions).where(eq(questions.examId, examId)).orderBy(asc(questions.blockId), asc(questions.number));
  const ans = await db.select().from(answers).innerJoin(questions, eq(questions.id, answers.questionId)).where(eq(questions.examId, examId)).orderBy(asc(answers.number));
  if (!qs.length) return null;
  const byQuestion = new Map<number, { number: number; text: string; correct: boolean }[]>();
  for (const row of ans) {
    const list = byQuestion.get(row.TableAnswers.questionId) ?? [];
    list.push({ number: row.TableAnswers.number, text: row.TableAnswers.text, correct: row.TableAnswers.correct === 1 });
    byQuestion.set(row.TableAnswers.questionId, list);
  }
  const data: BankRow[] = qs.map((q) => ({ blockId: q.blockId, number: q.number, text: q.text, answers: byQuestion.get(q.id) ?? [] }));
  // Названия тем тоже попадают в копию — при восстановлении тест сохранит свои темы.
  const titleRows = await db.select({ blockId: examBlocks.blockId, title: examBlocks.title, description: examBlocks.description })
    .from(examBlocks).where(eq(examBlocks.examId, examId)).orderBy(asc(examBlocks.blockId));
  const [row] = await db.insert(bankBackups).values({
    examName: exam.name, description: exam.description, reason,
    questionCount: qs.length, answerCount: ans.length, data,
    blocks: titleRows.length ? titleRows : null,
  }).returning({ id: bankBackups.id });
  await db.execute(sql`delete from bank_backups where id not in (select id from bank_backups order by created_at desc limit 20)`);
  return row.id;
}
export async function listBackups() {
  return db.select({
    id: bankBackups.id, examName: bankBackups.examName, description: bankBackups.description,
    questionCount: bankBackups.questionCount, answerCount: bankBackups.answerCount,
    reason: bankBackups.reason, createdAt: bankBackups.createdAt,
  }).from(bankBackups).orderBy(desc(bankBackups.createdAt)).limit(20);
}
export async function restoreBackup(id: number): Promise<ExamData> {
  const [backup] = await db.select().from(bankBackups).where(eq(bankBackups.id, id));
  if (!backup) throw new PortalError("Копия не найдена.", 404);
  if (!backup.data.length) throw new PortalError("В копии нет вопросов.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(82341)`);
    let name = backup.examName;
    const taken = async (candidate: string) => (await tx.select({ id: exams.id }).from(exams).where(eq(exams.name, candidate))).length > 0;
    if (await taken(name)) name = `${backup.examName} (восстановлен)`;
    let suffix = 2;
    while (await taken(name)) { name = `${backup.examName} (восстановлен ${suffix++})`; }
    const [exam] = await tx.insert(exams).values({ name, description: backup.description }).returning();
    const [lastQ] = await tx.select({ id: sql<number>`coalesce(max(${questions.id}), 0)` }).from(questions);
    const [lastA] = await tx.select({ id: sql<number>`coalesce(max(${answers.id}), 0)` }).from(answers);
    let qSeq = Number(lastQ.id), aSeq = Number(lastA.id);
    const qRows: { id: number; examId: number; text: string; blockId: number; number: number }[] = [];
    const aRows: { id: number; questionId: number; text: string; number: number; correct: number | null }[] = [];
    for (const q of backup.data) {
      const qId = ++qSeq;
      qRows.push({ id: qId, examId: exam.id, text: q.text, blockId: q.blockId, number: q.number });
      for (const a of q.answers) aRows.push({ id: ++aSeq, questionId: qId, text: a.text, number: a.number, correct: a.correct ? 1 : null });
    }
    for (let i = 0; i < qRows.length; i += 1000) await tx.insert(questions).values(qRows.slice(i, i + 1000));
    for (let i = 0; i < aRows.length; i += 1000) await tx.insert(answers).values(aRows.slice(i, i + 1000));
    if (backup.blocks?.length) {
      const titles = backup.blocks.filter((b) => (b.title ?? "").trim() || (b.description ?? "").trim());
      if (titles.length) await tx.insert(examBlocks).values(titles.map((b) => ({ examId: exam.id, blockId: b.blockId, title: b.title ?? "", description: b.description ?? "" }))).onConflictDoNothing();
    }
    const blockCount = new Set(qRows.map((q) => q.blockId)).size;
    return { id: exam.id, name: exam.name, description: exam.description, questionCount: qRows.length, blockCount };
  });
}
export async function deleteBackup(id: number) {
  const removed = await db.delete(bankBackups).where(eq(bankBackups.id, id)).returning({ id: bankBackups.id });
  if (!removed.length) throw new PortalError("Копия не найдена.", 404);
  return { ok: true };
}
export async function deleteExam(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new PortalError("Некорректный идентификатор теста.");
  const backupId = await backupBank(id, "Удаление теста");
  const deleted = await db.delete(exams).where(eq(exams.id, id)).returning();
  if (!deleted.length) throw new PortalError("Тест не найден.", 404);
  return { ok: true, backupId };
}
export async function getOverview(examId?: number): Promise<Overview> {
  await ensureSeed();
  // Один запрос вместо шести: пулер и холодный старт дорогие, экономим круговые рейсы.
  const scope = examId ?? null;
  const [row] = await db.execute<{
    blocks: { id: number; count: number }[];
    completed: number;
    updated: string | null;
    demo: string | null;
    exams: { id: number; name: string; description: string; questionCount: number; blockCount: number }[];
  }>(sql`
    select
      coalesce((select json_agg(b order by b.id) from (
        select q.blockid as id, count(*)::int as count
        from "TableQuestions" q
        where ${scope}::int is null or q.exam_id = ${scope}::int
        group by q.blockid) b), '[]'::json) as blocks,
      (select count(*)::int from test_attempts
        where status = 'completed' and (${scope}::int is null or exam_id = ${scope}::int)) as completed,
      (select value from portal_settings where key = 'bank_updated') as updated,
      (select value from portal_settings where key = 'demo_bank') as demo,
      coalesce((select json_agg(e order by e.id) from (
        select ex.id, ex.name, ex.description,
          count(q2."Id")::int as "questionCount",
          count(distinct q2.blockid)::int as "blockCount"
        from exams ex left join "TableQuestions" q2 on q2.exam_id = ex.id
        group by ex.id) e), '[]'::json) as exams
  `);
  const examList: ExamData[] = row.exams.map((e) => ({ ...e, questionCount: Number(e.questionCount), blockCount: Number(e.blockCount) }));
  if (examId !== undefined && !examList.some((e) => e.id === examId)) throw new PortalError("Тест не найден.", 404);
  const rows = row.blocks.map((b) => ({ id: Number(b.id), count: Number(b.count) }));
  // Названия тем хранятся в базе (таблица exam_blocks) — свои у каждого теста.
  // Обзор без выбранного теста берёт первый непустой вариант по номеру блока (картина на главной).
  const titleRows = await db.select({ blockId: examBlocks.blockId, title: examBlocks.title, description: examBlocks.description })
    .from(examBlocks)
    .where(scope === null ? sql`${examBlocks.title} <> ''` : eq(examBlocks.examId, scope))
    .orderBy(asc(examBlocks.examId));
  const titles = new Map<number, { title: string; description: string }>();
  for (const t of titleRows) if (!titles.has(t.blockId)) titles.set(t.blockId, { title: t.title, description: t.description });
  return {
    questionCount: rows.reduce((n, r) => n + r.count, 0), blockCount: rows.length, completedCount: Number(row.completed),
    blocks: rows.map((b) => ({ ...b, title: titles.get(b.id)?.title?.trim() || `Тематический блок № ${b.id}`, description: titles.get(b.id)?.description?.trim() || "Вопросы из импортированного банка" })),
    updatedAt: row.updated ?? new Date().toISOString(),
    isDemo: row.demo === "1",
    exams: examList,
  };
}
export async function getQuestionBank(withCorrect = false, examId?: number): Promise<QuestionData[]> {
  await ensureSeed();
  const qs = await db.select().from(questions).where(examId !== undefined ? eq(questions.examId, examId) : sql`true`).orderBy(asc(questions.blockId), asc(questions.number));
  const ans = await db.select().from(answers).orderBy(asc(answers.number));
  const grouped = new Map<number, QuestionData["answers"]>();
  for (const a of ans) {
    if (!grouped.has(a.questionId)) grouped.set(a.questionId, []);
    grouped.get(a.questionId)!.push({ id: a.id, text: a.text, number: a.number, ...(withCorrect ? { correct: a.correct === 1 } : {}) });
  }
  // Название темы (per-тест) прикладываем к вопросу: так оно попадает и в банк вопросов,
  // и в снимок попытки — разбор результата и PDF показывают правильные названия.
  const titleRows = await db.select({ examId: examBlocks.examId, blockId: examBlocks.blockId, title: examBlocks.title })
    .from(examBlocks).where(sql`${examBlocks.title} <> ''`);
  const titles = new Map(titleRows.map((t) => [`${t.examId}:${t.blockId}`, t.title]));
  return qs.map((q) => ({ ...q, blockTitle: titles.get(`${q.examId}:${q.blockId}`) ?? "", answers: grouped.get(q.id) ?? [] }));
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
      for (let i = group.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [group[i], group[j]] = [group[j], group[i]]; }
      selected.push(...group.slice(0, amount));
    }
  }
  if (!selected.length) throw new PortalError("По выбранным условиям нет вопросов. Измените диапазон или блок.");
  if (selected.some((q) => q.answers.length < 2 || q.answers.filter((a) => a.correct).length !== 1)) throw new PortalError("Банк вопросов содержит ошибку. Обратитесь к администратору.", 409);
  const timer = integer(input.timerMinutes ?? 0, "Время теста", 0, 180);
  const id = crypto.randomUUID();
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
export async function listExamBlocks(examId: number): Promise<BlockData[]> {
  if (!Number.isSafeInteger(examId) || examId < 1) throw new PortalError("Выберите тест.");
  const [exam] = await db.select({ id: exams.id }).from(exams).where(eq(exams.id, examId));
  if (!exam) throw new PortalError("Тест не найден.", 404);
  const counts = await db.select({ blockId: questions.blockId, value: count().mapWith(Number) })
    .from(questions).where(eq(questions.examId, examId)).groupBy(questions.blockId).orderBy(asc(questions.blockId));
  const titles = await db.select().from(examBlocks).where(eq(examBlocks.examId, examId));
  const byId = new Map(titles.map((t) => [t.blockId, t]));
  return counts.map((c) => ({ id: Number(c.blockId), count: Number(c.value), title: byId.get(c.blockId)?.title ?? "", description: byId.get(c.blockId)?.description ?? "" }));
}
export async function saveExamBlocks(input: Record<string, unknown>): Promise<BlockData[]> {
  const examId = integer(input?.examId, "Тест", 1, 2147483647);
  const list = Array.isArray(input?.blocks) ? input.blocks as Record<string, unknown>[] : [];
  if (!list.length) throw new PortalError("Нет блоков для сохранения.");
  if (list.length > 200) throw new PortalError("Слишком много блоков за один раз.");
  const [exam] = await db.select({ id: exams.id }).from(exams).where(eq(exams.id, examId));
  if (!exam) throw new PortalError("Тест не найден.", 404);
  const prepared = list.map((row) => {
    const blockId = integer(row?.id, "Номер блока", 1, 2147483647);
    const title = typeof row?.title === "string" ? row.title.trim().replace(/\s+/g, " ") : "";
    const description = typeof row?.description === "string" ? row.description.trim().replace(/\s+/g, " ") : "";
    if (title.length > 180) throw new PortalError(`Блок № ${blockId}: название — до 180 символов.`);
    if (description.length > 500) throw new PortalError(`Блок № ${blockId}: описание — до 500 символов.`);
    return { examId, blockId, title, description };
  });
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(82341)`);
    for (const row of prepared) {
      await tx.insert(examBlocks).values(row)
        .onConflictDoUpdate({ target: [examBlocks.examId, examBlocks.blockId], set: { title: row.title, description: row.description } });
    }
  });
  return listExamBlocks(examId);
}
/** Массовые действия над вопросами одного теста: удаление, перенос в блок, перенос в другой тест. */
export async function bulkQuestions(input: Record<string, unknown>) {
  const examId = integer(input?.examId, "Тест", 1, 2147483647);
  const action = input?.action;
  if (action !== "delete" && action !== "move-block" && action !== "move-exam") throw new PortalError("Выберите действие.");
  const rawIds = Array.isArray(input?.ids) ? input.ids : [];
  const ids = [...new Set(rawIds.map((value) => Number(value)))].filter((value) => Number.isSafeInteger(value) && value > 0);
  if (!ids.length) throw new PortalError("Не выбрано ни одного вопроса.");
  if (ids.length > 500) throw new PortalError("За один раз можно обработать не более 500 вопросов.");
  const [exam] = await db.select().from(exams).where(eq(exams.id, examId));
  if (!exam) throw new PortalError("Тест не найден.", 404);

  if (action === "delete") {
    const backupId = await backupBank(examId, `Массовое удаление вопросов (${ids.length})`);
    let removed = 0;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(82341)`);
      const rows = await tx.delete(questions).where(and(eq(questions.examId, examId), inArray(questions.id, ids))).returning({ id: questions.id });
      removed = rows.length;
      if (removed) await tx.update(settings).set({ value: new Date().toISOString() }).where(eq(settings.key, "bank_updated"));
    });
    if (!removed) throw new PortalError("Вопросы не найдены — возможно, они уже удалены.", 404);
    return { ok: true, action, count: removed, backupId, message: `Удалено вопросов: ${removed}.${backupId ? ` Сохранена копия банка № ${backupId} — восстановить можно во вкладке «Тесты (банки)».` : ""}` };
  }

  if (action === "move-block") {
    const blockId = integer(input?.blockId, "Номер блока", 1, 2147483647);
    let moved = 0, skipped = 0;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(82341)`);
      const rows = await tx.select({ id: questions.id, blockId: questions.blockId, number: questions.number })
        .from(questions).where(and(eq(questions.examId, examId), inArray(questions.id, ids)))
        .orderBy(asc(questions.blockId), asc(questions.number));
      if (!rows.length) throw new PortalError("Вопросы не найдены.", 404);
      const moving = rows.filter((r) => r.blockId !== blockId);
      skipped = rows.length - moving.length;
      if (!moving.length) return;
      const [maxRow] = await tx.select({ value: sql<number>`coalesce(max(${questions.number}), 0)`.mapWith(Number) })
        .from(questions).where(and(eq(questions.examId, examId), eq(questions.blockId, blockId)));
      let next = Number(maxRow?.value ?? 0);
      for (const r of moving) { next += 1; await tx.update(questions).set({ blockId, number: next }).where(eq(questions.id, r.id)); }
      moved = moving.length;
      await tx.update(settings).set({ value: new Date().toISOString() }).where(eq(settings.key, "bank_updated"));
    });
    if (!moved) return { ok: true, action, count: 0, message: `Все выбранные вопросы уже в блоке № ${blockId}.` };
    return { ok: true, action, count: moved, skipped, message: `Перенесено в блок № ${blockId}: ${moved}${skipped ? ` (${skipped} уже были в нём)` : ""}.` };
  }

  const targetExamId = integer(input?.targetExamId, "Тест назначения", 1, 2147483647);
  if (targetExamId === examId) throw new PortalError("Выберите другой тест для переноса.");
  const [target] = await db.select().from(exams).where(eq(exams.id, targetExamId));
  if (!target) throw new PortalError("Тест, куда переносятся вопросы, не найден.", 404);
  const rawBlock = input?.blockId;
  const fixedBlock = rawBlock === undefined || rawBlock === null || rawBlock === "" ? null : integer(rawBlock, "Номер блока", 1, 2147483647);
  let moved = 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(82341)`);
    const rows = await tx.select({ id: questions.id, blockId: questions.blockId, number: questions.number })
      .from(questions).where(and(eq(questions.examId, examId), inArray(questions.id, ids)))
      .orderBy(asc(questions.blockId), asc(questions.number));
    if (!rows.length) throw new PortalError("Вопросы не найдены.", 404);
    const maxRows = await tx.select({ blockId: questions.blockId, value: sql<number>`max(${questions.number})`.mapWith(Number) })
      .from(questions).where(eq(questions.examId, targetExamId)).groupBy(questions.blockId);
    const nextByBlock = new Map<number, number>(maxRows.map((r) => [Number(r.blockId), Number(r.value)]));
    for (const r of rows) {
      const block = fixedBlock ?? r.blockId;
      const next = (nextByBlock.get(block) ?? 0) + 1;
      nextByBlock.set(block, next);
      await tx.update(questions).set({ examId: targetExamId, blockId: block, number: next }).where(eq(questions.id, r.id));
      moved += 1;
    }
    await tx.update(settings).set({ value: new Date().toISOString() }).where(eq(settings.key, "bank_updated"));
  });
  return { ok: true, action, count: moved, message: `Перенесено вопросов: ${moved} → тест «${target.name}».` };
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
