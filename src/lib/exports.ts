import ExcelJS from "exceljs";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";

let cachedFont: Buffer | null = null;
async function fontData(): Promise<Buffer> {
  if (cachedFont) return cachedFont;
  try { cachedFont = await readFile(path.join(process.cwd(), "public/fonts/DejaVuSans.ttf")); return cachedFont; }
  catch {
    const base = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
    if (!base) throw new Error("Шрифт для PDF недоступен.");
    const response = await fetch(`https://${base}/fonts/DejaVuSans.ttf`);
    if (!response.ok) throw new Error("Шрифт для PDF недоступен.");
    cachedFont = Buffer.from(await response.arrayBuffer());
    return cachedFont;
  }
}
import { formatDate, getBlockTitle, modeLabels, type AttemptData, type ResultRow } from "@/lib/types";

export async function makePdf(title: string, subtitle: string, paragraphs: string[]) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await fontData(), { subset: true });
  pdf.setTitle(title); pdf.setAuthor("КТПП · Экспертиза"); pdf.setLanguage("ru-RU");
  let page = pdf.addPage([595.28, 841.89]);
  let y = 0;
  const blue = rgb(0.12, 0.27, 0.53), grey = rgb(0.36, 0.4, 0.46);
  function header() {
    page.drawRectangle({ x: 0, y: 780, width: 596, height: 62, color: blue });
    page.drawText("КТПП  /  ЭКСПЕРТИЗА", { x: 42, y: 806, font, size: 15, color: rgb(1, 1, 1) });
    page.drawText("Союз «Калининградская торгово-промышленная палата»", { x: 42, y: 788, font, size: 8, color: rgb(0.82, 0.89, 1) });
    y = 748;
  }
  function line(text: string, size: number, color = grey) {
    if (y < 65) { page = pdf.addPage([595.28, 841.89]); header(); }
    page.drawText(text, { x: 42, y, font, size, color }); y -= size * 1.55;
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
    p.drawText(`Экспертиза КТПП · ${i + 1} / ${pdf.getPageCount()}`, { x: 42, y: 30, font, size: 8, color: grey });
  });
  return pdf.save();
}
export async function exportStatistics(rows: ResultRow[], format: string, filters: URLSearchParams) {
  const filterText = `ФИО: ${filters.get("name") || "все"} · Тест: ${filters.get("exam") ? `#${filters.get("exam")}` : "все"} · Период: ${filters.get("from") || "не ограничен"} — ${filters.get("to") || "не ограничен"}`;
  if (format === "pdf") return makePdf("Статистика тестирования", filterText, [
    `ИТОГО: ${rows.length} завершённых тестов. Сформировано: ${formatDate(new Date().toISOString(), true)}.`,
    ...rows.flatMap((r, i) => [`${i + 1}. ${r.fullName}`, `${r.examName ?? "Тест"} · ${formatDate(r.finishedAt || r.startedAt, true)} · ${modeLabels[r.mode]} режим · Верно: ${r.correctCount} · Неверно: ${r.total - r.correctCount} · Результат: ${r.percentage}%`]),
  ]);
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
  return workbook.xlsx.writeBuffer();
}
export async function exportAttempt(attempt: AttemptData) {
  const mistakes = attempt.questions.filter((q) => !q.answers.some((a) => a.correct && a.id === attempt.responses[q.id]));
  return makePdf("Результат тестирования", `${attempt.fullName} · ${attempt.examName ?? "Тест"} · ${modeLabels[attempt.mode]} режим · ${formatDate(attempt.finishedAt || attempt.startedAt, true)}`, [
    `Результат: ${attempt.percentage}% · Правильно: ${attempt.correctCount} из ${attempt.total}.`,
    "Работа над ошибками",
    ...(mistakes.length ? mistakes.flatMap((q, i) => [`${i + 1}. ${q.text} (${getBlockTitle(q.blockId)})`, `Ваш ответ: ${q.answers.find((a) => a.id === attempt.responses[q.id])?.text ?? "Ответ не выбран"}`, `Правильный ответ: ${q.answers.find((a) => a.correct)?.text ?? "—"}`]) : ["Все ответы верны. Ошибок нет."]),
    "Результат отражает прохождение теста и не является документом о присвоении квалификации.",
  ]);
}
