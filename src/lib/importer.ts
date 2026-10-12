import ExcelJS from "exceljs";
import { db } from "@/db";
import { answers, exams, questions, settings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { PortalError } from "@/lib/store";

type Row = Record<string, unknown>;
const qColumns = ["Id", "question", "blockid", "numberquestion"];
const aColumns = ["Id", "answer", "question", "true_answer", "numberanswer"];
async function readSheet(file: File, columns: string[], label: string, errors: string[], maxRows: number): Promise<Row[]> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new PortalError(`${label}: нужен файл .xlsx.`);
  if (file.size > 10 * 1024 * 1024) throw new PortalError(`${label}: максимальный размер — 10 МБ.`);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(await file.arrayBuffer()); } catch { throw new PortalError(`${label}: не удалось прочитать Excel-файл. Проверьте формат .xlsx.`); }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new PortalError(`${label}: книга не содержит листов.`);
  if (sheet.rowCount > maxRows + 1) throw new PortalError(`${label}: не более ${maxRows} строк за один импорт.`);
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col] = cell.text.trim(); });
  for (const name of columns) {
    if (!headers.includes(name)) errors.push(`${label}: отсутствует колонка «${name}».`);
    if (headers.filter((h) => h === name).length > 1) errors.push(`${label}: колонка «${name}» указана несколько раз.`);
  }
  if (columns.some((c) => !headers.includes(c))) return [];
  const result: Row[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const item: Row = { _row: rowNumber };
    for (const name of columns) {
      const value = row.getCell(headers.indexOf(name)).value;
      if (value && typeof value === "object") {
        if ("richText" in value) item[name] = value.richText.map((v) => v.text).join("");
        else { errors.push(`${label}, строка ${rowNumber}: формулы и сложные значения не поддерживаются (${name}).`); item[name] = ""; }
      } else item[name] = value ?? "";
    }
    if (columns.some((c) => String(item[c]).trim())) result.push(item);
  });
  if (!result.length) errors.push(`${label}: нет строк с данными.`);
  return result;
}
function positive(value: unknown) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 && n <= 2147483647; }
export async function importBank(form: FormData) {
  const qFile = form.get("questions"), aFile = form.get("answers");
  if (!(qFile instanceof File) || !(aFile instanceof File)) throw new PortalError("Выберите оба файла: TableQuestions.xlsx и TableAnswers.xlsx.");
  if (form.get("confirm") !== "true") throw new PortalError("Подтвердите замену банка выбранного теста.");
  const examId = Number(form.get("examId"));
  if (!Number.isSafeInteger(examId) || examId < 1) throw new PortalError("Выберите тест, в который выполняется импорт.");
  if (!(await db.select({ id: exams.id }).from(exams).where(eq(exams.id, examId))).length) throw new PortalError("Выбранный тест не найден.", 404);
  const errors: string[] = [];
  const qRows = await readSheet(qFile, qColumns, "Вопросы", errors, 10000);
  const aRows = await readSheet(aFile, aColumns, "Ответы", errors, 50000);
  const qIds = new Set<number>(), qOrder = new Set<string>(), aIds = new Set<number>(), aOrder = new Set<string>();
  const qParsed = qRows.map((r) => {
    for (const c of ["Id", "blockid", "numberquestion"]) if (!positive(r[c])) errors.push(`Вопросы, строка ${r._row}: «${c}» должно быть положительным целым числом.`);
    const id = Number(r.Id), blockId = Number(r.blockid), number = Number(r.numberquestion);
    if (qIds.has(id)) errors.push(`Вопросы: дубликат Id=${id}.`);
    qIds.add(id);
    const order = `${blockId}:${number}`;
    if (qOrder.has(order)) errors.push(`Блок ${blockId}: повторяется номер вопроса ${number}.`);
    qOrder.add(order);
    const text = String(r.question ?? "").trim();
    if (!text || text.length > 10000) errors.push(`Вопрос Id=${id}: текст должен содержать от 1 до 10 000 символов.`);
    return { id, text, blockId, number };
  });
  let normalized = 0;
  const aParsed = aRows.map((r) => {
    for (const c of ["Id", "question", "numberanswer"]) if (!positive(r[c])) errors.push(`Ответы, строка ${r._row}: «${c}» должно быть положительным целым числом.`);
    const id = Number(r.Id), questionId = Number(r.question), number = Number(r.numberanswer);
    if (aIds.has(id)) errors.push(`Ответы: дубликат Id=${id}.`);
    aIds.add(id);
    if (!qIds.has(questionId)) errors.push(`Ответ Id=${id}: вопрос Id=${questionId} не существует.`);
    const order = `${questionId}:${number}`;
    if (aOrder.has(order)) errors.push(`Вопрос Id=${questionId}: повторяется номер ответа ${number}.`);
    aOrder.add(order);
    const marker = String(r.true_answer ?? "").trim();
    if (marker !== "" && marker !== "0" && marker !== "1") errors.push(`Ответ Id=${id}: true_answer должен быть 1, 0 или пустым.`);
    const rawText = String(r.answer ?? "").trimStart();
    const original = rawText.trim(), text = rawText.replace(/^\d+\.\s+/, "").trim();
    if (original !== text) normalized++;
    if (!text || text.length > 10000) errors.push(`Ответ Id=${id}: текст должен содержать от 1 до 10 000 символов.`);
    return { id, text, questionId, number, correct: marker === "1" ? 1 : null };
  });
  const grouped = new Map<number, typeof aParsed>();
  for (const a of aParsed) { if (!grouped.has(a.questionId)) grouped.set(a.questionId, []); grouped.get(a.questionId)!.push(a); }
  for (const q of qParsed) {
    const options = grouped.get(q.id) ?? [];
    if (options.length < 2) errors.push(`Вопрос Id=${q.id}: нужно не менее двух ответов (найдено ${options.length}).`);
    const correct = options.filter((a) => a.correct === 1).length;
    if (correct !== 1) errors.push(`Вопрос Id=${q.id}: должен быть ровно один верный ответ (найдено ${correct}).`);
  }
  if (errors.length) throw new PortalError(`Импорт отменён: найдено проблем — ${errors.length}. База не изменена.`, 422, errors.slice(0, 150));
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(82341)`);
    await tx.delete(questions).where(eq(questions.examId, examId));
    const [lastQ] = await tx.select({ id: sql<number>`coalesce(max(${questions.id}), 0)` }).from(questions);
    const [lastA] = await tx.select({ id: sql<number>`coalesce(max(${answers.id}), 0)` }).from(answers);
    let qSeq = Number(lastQ.id);
    const idMap = new Map<number, number>();
    const qInsert = qParsed.map((q) => { idMap.set(q.id, ++qSeq); return { id: qSeq, examId, text: q.text, blockId: q.blockId, number: q.number }; });
    let aSeq = Number(lastA.id);
    const aInsert = aParsed.map((a) => ({ id: ++aSeq, questionId: idMap.get(a.questionId)!, text: a.text, number: a.number, correct: a.correct }));
    for (let i = 0; i < qInsert.length; i += 1000) await tx.insert(questions).values(qInsert.slice(i, i + 1000));
    for (let i = 0; i < aInsert.length; i += 1000) await tx.insert(answers).values(aInsert.slice(i, i + 1000));
    for (const entry of [{ key: "demo_bank", value: "0" }, { key: "bank_updated", value: new Date().toISOString() }]) await tx.insert(settings).values(entry).onConflictDoUpdate({ target: settings.key, set: { value: entry.value } });
  });
  return { questions: qParsed.length, answers: aParsed.length, normalized, message: `Банк обновлён: ${qParsed.length} вопросов, ${aParsed.length} ответов. Нормализовано: ${normalized}.` };
}
export async function importTemplate(type: string) {
  const workbook = new ExcelJS.Workbook();
  const isAnswers = type === "answers";
  const sheet = workbook.addWorksheet(isAnswers ? "TableAnswers" : "TableQuestions");
  sheet.addRow(isAnswers ? aColumns : qColumns);
  if (isAnswers) ["Только государственные предприятия", "Только юридические лица", "Юридические лица и индивидуальные предприниматели"].forEach((text, i) => sheet.addRow([i + 1, text, 1, i === 2 ? 1 : null, i + 1]));
  else sheet.addRow([1, "Кто может быть субъектом деятельности в сфере промышленности?", 1, 1]);
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF204C99" } };
  sheet.columns.forEach((col, i) => { col.width = i === 1 ? 90 : 20; });
  return workbook.xlsx.writeBuffer();
}
