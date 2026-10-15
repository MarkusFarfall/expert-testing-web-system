import { db } from "./db.ts";
import { answers, exams, questions, settings } from "./schema.ts";
import { and, asc, count, desc, eq, gt, gte, ilike, lt, sql } from "./drizzle.ts";
import { backupBank, PortalError } from "./store.ts";

type QRow = { id: number; text: string; blockId: number; number: number };
type ARow = { id: number; text: string; questionId: number; number: number; correct: boolean };
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0 && Number(n) <= 2147483647;

export async function importBankJson(input: Record<string, unknown>) {
  const examId = Number(input?.examId);
  const qList = Array.isArray(input?.questions) ? input.questions as QRow[] : [];
  const aList = Array.isArray(input?.answers) ? input.answers as ARow[] : [];
  const normalized = Number(input?.normalized) || 0;
  if (!Number.isSafeInteger(examId) || examId < 1) throw new PortalError("Выберите тест, в который выполняется импорт.");
  if (!(await db.select({ id: exams.id }).from(exams).where(eq(exams.id, examId))).length) throw new PortalError("Выбранный тест не найден.", 404);
  const errors: string[] = [];
  if (!qList.length) errors.push("Файл вопросов пуст.");
  if (qList.length > 10000) errors.push("Не более 10 000 вопросов за один импорт.");
  if (aList.length > 50000) errors.push("Не более 50 000 ответов за один импорт.");
  const fail = () => { if (errors.length) throw new PortalError(`Импорт отменён: найдено проблем — ${errors.length}. База не изменена.`, 422, errors.slice(0, 150)); };
  fail();
  const qIds = new Set<number>(), aIds = new Set<number>(), qOrder = new Set<string>(), aOrder = new Set<string>();
  for (const q of qList) {
    if (!positive(q?.id) || !positive(q?.blockId) || !positive(q?.number)) { errors.push("Некорректные номера или Id вопроса."); break; }
    if (qIds.has(q.id)) { errors.push(`Вопросы: дубликат Id=${q.id}.`); break; }
    qIds.add(q.id);
    const order = `${q.blockId}:${q.number}`;
    if (qOrder.has(order)) { errors.push(`Блок ${q.blockId}: повторяется номер вопроса ${q.number}.`); break; }
    qOrder.add(order);
    if (typeof q.text !== "string" || !q.text.trim() || q.text.length > 10000) { errors.push(`Вопрос Id=${q.id}: текст 1–10 000 символов.`); break; }
  }
  fail();
  const perQuestion = new Map<number, number>();
  const answerCounts = new Map<number, number>();
  for (const a of aList) {
    if (!positive(a?.id) || !positive(a?.questionId) || !positive(a?.number)) { errors.push("Некорректные номера или Id ответа."); break; }
    if (aIds.has(a.id)) { errors.push(`Ответы: дубликат Id=${a.id}.`); break; }
    aIds.add(a.id);
    if (!qIds.has(a.questionId)) { errors.push(`Ответ Id=${a.id}: вопрос Id=${a.questionId} не существует.`); break; }
    const order = `${a.questionId}:${a.number}`;
    if (aOrder.has(order)) { errors.push(`Вопрос Id=${a.questionId}: повторяется номер ответа ${a.number}.`); break; }
    aOrder.add(order);
    if (typeof a.text !== "string" || !a.text.trim() || a.text.length > 10000) { errors.push(`Ответ Id=${a.id}: текст 1–10 000 символов.`); break; }
    if (typeof a.correct !== "boolean") { errors.push(`Ответ Id=${a.id}: correct должен быть true или false.`); break; }
    answerCounts.set(a.questionId, (answerCounts.get(a.questionId) ?? 0) + 1);
    if (a.correct) perQuestion.set(a.questionId, (perQuestion.get(a.questionId) ?? 0) + 1);
  }
  fail();
  for (const q of qList) {
    const count = answerCounts.get(q.id) ?? 0;
    if (count < 2) { errors.push(`Вопрос Id=${q.id}: нужно не менее двух ответов (найдено ${count}).`); break; }
    if ((perQuestion.get(q.id) ?? 0) !== 1) { errors.push(`Вопрос Id=${q.id}: должен быть ровно один верный ответ.`); break; }
  }
  if (errors.length) throw new PortalError(`Импорт отменён: найдено проблем — ${errors.length}. База не изменена.`, 422, errors.slice(0, 150));
  const backupId = await backupBank(examId, "Перед импортом");
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(82341)`);
    await tx.delete(questions).where(eq(questions.examId, examId));
    const [lastQ] = await tx.select({ id: sql<number>`coalesce(max(${questions.id}), 0)` }).from(questions);
    const [lastA] = await tx.select({ id: sql<number>`coalesce(max(${answers.id}), 0)` }).from(answers);
    let qSeq = Number(lastQ.id), aSeq = Number(lastA.id);
    const idMap = new Map<number, number>();
    const qInsert = qList.map((q) => { const id = ++qSeq; idMap.set(q.id, id); return { id, examId, text: q.text.trim(), blockId: q.blockId, number: q.number }; });
    const aInsert = aList.map((a) => ({ id: ++aSeq, questionId: idMap.get(a.questionId)!, text: a.text.trim(), number: a.number, correct: a.correct ? 1 : null }));
    for (let i = 0; i < qInsert.length; i += 1000) await tx.insert(questions).values(qInsert.slice(i, i + 1000));
    for (let i = 0; i < aInsert.length; i += 1000) await tx.insert(answers).values(aInsert.slice(i, i + 1000));
    for (const entry of [{ key: "demo_bank", value: "0" }, { key: "bank_updated", value: new Date().toISOString() }]) await tx.insert(settings).values(entry).onConflictDoUpdate({ target: settings.key, set: { value: entry.value } });
  });
  return {
    questions: qList.length, answers: aList.length, normalized, backupId,
    message: `Банк обновлён: ${qList.length} вопросов, ${aList.length} ответов.${normalized ? ` Нормализовано: ${normalized}.` : ""}${backupId ? " Копия предыдущего банка сохранена — восстановить можно во вкладке «Тесты (банки)»." : ""}`,
  };
}
