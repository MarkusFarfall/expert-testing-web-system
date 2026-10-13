"use client";
// Разбор Excel и генерация PDF/XLSX выполняются прямо в браузере:
// так работает статичная версия на GitHub Pages (сервер не нужен).
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { formatDate, getBlockTitle, modeLabels, type AttemptData, type ResultRow } from "@/lib/types";
import { documents } from "@/lib/documents";
import { BASE_PATH } from "@/lib/session";

async function exceljs() {
  const mod = await import(/* webpackIgnore: false */ "exceljs/dist/exceljs.min.js");
  return (mod as unknown as { default: typeof import("exceljs") }).default;
}
let fontCache: ArrayBuffer | null = null;
async function fontData(): Promise<ArrayBuffer> {
  if (fontCache) return fontCache;
  const response = await fetch(`${BASE_PATH}/fonts/DejaVuSans.ttf`);
  if (!response.ok) throw new Error("Не удалось загрузить шрифт для PDF.");
  fontCache = await response.arrayBuffer();
  return fontCache;
}
export function saveFile(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export async function makePdf(title: string, subtitle: string, paragraphs: string[], name: string) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await fontData(), { subset: true });
  pdf.setTitle(title); pdf.setAuthor("КТПП · Экспертиза"); pdf.setLanguage("ru-RU");
  let page: PDFPage = pdf.addPage([595.28, 841.89]);
  let y = 0;
  const blue = rgb(0.12, 0.27, 0.53), grey = rgb(0.36, 0.4, 0.46);
  function header() {
    page.drawRectangle({ x: 0, y: 780, width: 596, height: 62, color: blue });
    page.drawText("КТПП  /  ЭКСПЕРТИЗА", { x: 42, y: 806, font: font as PDFFont, size: 15, color: rgb(1, 1, 1) });
    page.drawText("Калининградская торгово-промышленная палата", { x: 42, y: 788, font: font as PDFFont, size: 8, color: rgb(0.82, 0.89, 1) });
    y = 748;
  }
  function line(text: string, size: number, color = grey) {
    if (y < 65) { page = pdf.addPage([595.28, 841.89]); header(); }
    page.drawText(text, { x: 42, y, font: font as PDFFont, size, color }); y -= size * 1.55;
  }
  function wrapped(text: string, size: number, color = grey) {
    let current = "";
    for (const word of text.replace(/[\r\n\t]/g, " ").split(/\s+/)) {
      if (font.widthOfTextAtSize((current ? current + " " : "") + word, size) > 510 && current) { line(current, size, color); current = ""; }
      if (font.widthOfTextAtSize(word, size) > 510) {
        for (const char of word) { if (font.widthOfTextAtSize(current + char, size) > 510) { line(current, size, color); current = ""; } current += char; }
      } else current += (current ? " " : "") + word;
    }
    if (current) line(current, size, color);
  }
  header(); wrapped(title, 19, blue); y -= 8; wrapped(subtitle, 9); y -= 22;
  for (const text of paragraphs) { wrapped(text, /^\d+\.|^ИТОГО|^Результат/.test(text) ? 10.5 : 10); y -= 11; }
  pdf.getPages().forEach((p, i) => {
    p.drawLine({ start: { x: 42, y: 45 }, end: { x: 553, y: 45 }, color: rgb(0.86, 0.89, 0.93), thickness: 0.5 });
    p.drawText(`Экспертиза КТПП · ${i + 1} / ${pdf.getPageCount()}`, { x: 42, y: 30, font: font as PDFFont, size: 8, color: grey });
  });
  saveFile(new Uint8Array(await pdf.save()).buffer as ArrayBuffer, name, "application/pdf");
}
function filterTextOf(filters: URLSearchParams) {
  return `ФИО: ${filters.get("name") || "все"} · Тест: ${filters.get("exam") || "все"} · Период: ${filters.get("from") || "не ограничен"} — ${filters.get("to") || "не ограничен"}`;
}
export async function exportStatistics(rows: ResultRow[], format: "pdf" | "xlsx", query: string) {
  const filters = new URLSearchParams(query);
  const filterText = filterTextOf(filters);
  if (format === "pdf") {
    await makePdf("Статистика тестирования", filterText, [
      `ИТОГО: ${rows.length} завершённых тестов. Сформировано: ${formatDate(new Date().toISOString(), true)}.`,
      ...rows.flatMap((r, i) => [`${i + 1}. ${r.fullName}`, `${r.examName ?? "Тест"} · ${formatDate(r.finishedAt || r.startedAt, true)} · ${modeLabels[r.mode]} режим · Верно: ${r.correctCount} · Неверно: ${r.total - r.correctCount} · Результат: ${r.percentage}%`]),
    ], "ktpp-statistics.pdf");
    return;
  }
  const ExcelJS = await exceljs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "КТПП";
  const sheet = workbook.addWorksheet("Результаты");
  sheet.columns = [
    { header: "ФИО", key: "fullName", width: 42 }, { header: "Тест", key: "exam", width: 34 }, { header: "Дата и время (Калининград)", key: "date", width: 27 },
    { header: "Режим", key: "mode", width: 18 }, { header: "Вопросов", key: "total", width: 13 },
    { header: "Правильно", key: "correct", width: 14 }, { header: "Неправильно", key: "incorrect", width: 15 }, { header: "Процент", key: "percentage", width: 13 },
  ];
  for (const r of rows) sheet.addRow({ fullName: r.fullName, exam: r.examName ?? "—", date: new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Kaliningrad" }).format(new Date(r.finishedAt || r.startedAt)), mode: modeLabels[r.mode], total: r.total, correct: r.correctCount, incorrect: r.total - r.correctCount, percentage: r.percentage / 100 });
  sheet.getColumn("percentage").numFmt = "0%";
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF204C99" } };
  sheet.autoFilter = { from: "A1", to: `H${Math.max(1, rows.length + 1)}` };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const info = workbook.addWorksheet("Параметры"); info.addRows([["Статистика тестирования КТПП"], [filterText], ["Сформировано", new Date().toISOString()]]); info.getColumn(1).width = 100;
  saveFile(await workbook.xlsx.writeBuffer(), "ktpp-statistics.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
export async function exportAttempt(attempt: AttemptData) {
  const mistakes = attempt.questions.filter((q) => !q.answers.some((a) => a.correct && a.id === attempt.responses[q.id]));
  await makePdf("Результат тестирования", `${attempt.fullName} · ${attempt.examName ?? "Тест"} · ${modeLabels[attempt.mode]} режим · ${formatDate(attempt.finishedAt || attempt.startedAt, true)}`, [
    `Результат: ${attempt.percentage}% · Правильно: ${attempt.correctCount} из ${attempt.total}.`,
    "Работа над ошибками",
    ...(mistakes.length ? mistakes.flatMap((q, i) => [`${i + 1}. ${q.text} (${getBlockTitle(q.blockId, q.blockTitle)})`, `Ваш ответ: ${q.answers.find((a) => a.id === attempt.responses[q.id])?.text ?? "Ответ не выбран"}`, `Правильный ответ: ${q.answers.find((a) => a.correct)?.text ?? "—"}`]) : ["Все ответы верны. Ошибок нет."]),
    "Результат отражает прохождение теста и не является документом о присвоении квалификации.",
  ], `ktpp-result-${attempt.id.slice(0, 8)}.pdf`);
}
export async function exportDocument(id: string) {
  const doc = documents.find((d) => d.id === id);
  if (!doc) throw new Error("Документ не найден.");
  await makePdf(doc.title, `${doc.number} · Справочный материал платформы · Версия от ${doc.date}`, doc.sections, `ktpp-${doc.id}.pdf`);
}
export async function exportTemplate(type: "questions" | "answers") {
  const ExcelJS = await exceljs();
  const isAnswers = type === "answers";
  const qColumns = ["Id", "question", "blockid", "numberquestion"];
  const aColumns = ["Id", "answer", "question", "true_answer", "numberanswer"];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(isAnswers ? "TableAnswers" : "TableQuestions");
  sheet.addRow(isAnswers ? aColumns : qColumns);
  if (isAnswers) ["Только государственные предприятия", "Только юридические лица", "Юридические лица и индивидуальные предприниматели"].forEach((text, i) => sheet.addRow([i + 1, text, 1, i === 2 ? 1 : null, i + 1]));
  else sheet.addRow([1, "Кто может быть субъектом деятельности в сфере промышленности?", 1, 1]);
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF204C99" } };
  sheet.columns.forEach((col, i) => { col.width = i === 1 ? 90 : 20; });
  saveFile(await workbook.xlsx.writeBuffer(), isAnswers ? "TableAnswers.xlsx" : "TableQuestions.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
// ---------- Разбор файлов банка (порт серверного импортёра) ----------
export type ParsedBank = { questions: { id: number; text: string; blockId: number; number: number }[]; answers: { id: number; text: string; questionId: number; number: number; correct: boolean }[]; normalized: number };
type Row = Record<string, unknown>;
const positive = (value: unknown) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 && n <= 2147483647; };
const TRUE_MARKERS = ["1", "true", "да", "yes", "верно", "истина"];
const FALSE_MARKERS = ["", "0", "null", "n/a", "н/д", "нет", "no", "false", "ложь", "пусто", "-", "—", "–"];
function parseMarker(value: unknown) {
  const marker = String(value ?? "").trim().toLowerCase();
  if (TRUE_MARKERS.includes(marker)) return { correct: true as const, custom: marker !== "1" };
  if (FALSE_MARKERS.includes(marker)) return { correct: false as const, custom: marker !== "" && marker !== "0" };
  return { error: marker };
}
export function stripNumbering(raw: string, number: number) {
  const text = raw.trim();
  const cut = (length: number) => { const rest = text.slice(length); if (!rest.trim() || /^\d/.test(rest.trim())) return null; return rest.trimStart(); };
  let m = text.match(/^(\d{1,6})\s*[.)]\s*/);
  if (m && Number(m[1]) === number) { const rest = cut(m[0].length); if (rest) return { text: rest, stripped: true }; }
  m = text.match(/^(\d{1,6})(?=[^\d\s.,)\-–%])/);
  if (m && Number(m[1]) === number) { const rest = cut(m[1].length); if (rest) return { text: rest, stripped: true }; }
  m = text.match(/^(\d{1,6})\s+/);
  if (m && Number(m[1]) === number) { const rest = cut(m[0].length); if (rest) return { text: rest, stripped: true }; }
  return { text, stripped: false };
}
async function readSheet(file: File, columns: string[], label: string, errors: string[], maxRows: number): Promise<Row[]> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error(`${label}: нужен файл .xlsx.`);
  if (file.size > 10 * 1024 * 1024) throw new Error(`${label}: максимальный размер — 10 МБ.`);
  const ExcelJS = await exceljs();
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(await file.arrayBuffer() as ArrayBuffer); } catch { throw new Error(`${label}: не удалось прочитать Excel-файл. Проверьте формат .xlsx.`); }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error(`${label}: книга не содержит листов.`);
  if (sheet.rowCount > maxRows + 1) throw new Error(`${label}: не более ${maxRows} строк за один импорт.`);
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
        if ("richText" in value) item[name] = (value as { richText: { text: string }[] }).richText.map((v) => v.text).join("");
        else { errors.push(`${label}, строка ${rowNumber}: формулы и сложные значения не поддерживаются (${name}).`); item[name] = ""; }
      } else item[name] = value ?? "";
    }
    if (columns.some((c) => String(item[c]).trim())) result.push(item);
  });
  if (!result.length) errors.push(`${label}: нет строк с данными.`);
  return result;
}
export async function parseBankFiles(qFile: File, aFile: File): Promise<ParsedBank> {
  const qColumns = ["Id", "question", "blockid", "numberquestion"];
  const aColumns = ["Id", "answer", "question", "true_answer", "numberanswer"];
  const errors: string[] = [];
  const qRows = await readSheet(qFile, qColumns, "Вопросы", errors, 10000);
  const aRows = await readSheet(aFile, aColumns, "Ответы", errors, 50000);
  const qIds = new Set<number>(), qOrder = new Set<string>(), aIds = new Set<number>(), aOrder = new Set<string>();
  let normalized = 0;
  const questions = qRows.map((r) => {
    for (const c of ["Id", "blockid", "numberquestion"]) if (!positive(r[c])) errors.push(`Вопросы, строка ${r._row}: «${c}» должно быть положительным целым числом.`);
    const id = Number(r.Id), blockId = Number(r.blockid), number = Number(r.numberquestion);
    if (qIds.has(id)) errors.push(`Вопросы: дубликат Id=${id}.`);
    qIds.add(id);
    const order = `${blockId}:${number}`;
    if (qOrder.has(order)) errors.push(`Блок ${blockId}: повторяется номер вопроса ${number}.`);
    qOrder.add(order);
    const prepared = stripNumbering(String(r.question ?? ""), number);
    if (prepared.stripped) normalized++;
    if (!prepared.text || prepared.text.length > 10000) errors.push(`Вопрос Id=${id}: текст должен содержать от 1 до 10 000 символов.`);
    return { id, text: prepared.text, blockId, number };
  });
  const answers = aRows.map((r) => {
    for (const c of ["Id", "question", "numberanswer"]) if (!positive(r[c])) errors.push(`Ответы, строка ${r._row}: «${c}» должно быть положительным целым числом.`);
    const id = Number(r.Id), questionId = Number(r.question), number = Number(r.numberanswer);
    if (aIds.has(id)) errors.push(`Ответы: дубликат Id=${id}.`);
    aIds.add(id);
    if (!qIds.has(questionId)) errors.push(`Ответ Id=${id}: вопрос Id=${questionId} не существует.`);
    const order = `${questionId}:${number}`;
    if (aOrder.has(order)) errors.push(`Вопрос Id=${questionId}: повторяется номер ответа ${number}.`);
    aOrder.add(order);
    const marker = parseMarker(r.true_answer);
    if (marker.error !== undefined) errors.push(`Ответ Id=${id}: true_answer должен быть 1, 0 или пустым, а в файле «${marker.error}».`);
    else if (marker.custom) normalized++;
    const prepared = stripNumbering(String(r.answer ?? ""), number);
    if (prepared.stripped) normalized++;
    if (!prepared.text || prepared.text.length > 10000) errors.push(`Ответ Id=${id}: текст должен содержать от 1 до 10 000 символов.`);
    return { id, text: prepared.text, questionId, number, correct: marker.error !== undefined ? false : !!marker.correct };
  });
  const grouped = new Map<number, number>();
  for (const a of answers) if (a.correct) grouped.set(a.questionId, (grouped.get(a.questionId) ?? 0) + 1);
  for (const q of questions) {
    const options = answers.filter((a) => a.questionId === q.id).length;
    if (options < 2) errors.push(`Вопрос Id=${q.id}: нужно не менее двух ответов (найдено ${options}).`);
    const correct = grouped.get(q.id) ?? 0;
    if (correct !== 1) errors.push(`Вопрос Id=${q.id}: должен быть ровно один верный ответ (найдено ${correct}).`);
  }
  if (errors.length) throw Object.assign(new Error(`Импорт отменён: найдено проблем — ${errors.length}. База не изменена.`), { details: errors.slice(0, 150) });
  return { questions, answers, normalized };
}
