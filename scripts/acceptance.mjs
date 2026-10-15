// Legacy Next.js cookie API scenario, not the current Deno deployment.
// Prefer npm run test:ui and the guarded Deno integration suite.
if (process.env.ALLOW_LEGACY_TEST_DB_WRITES !== 'yes') throw new Error('Legacy destructive test disabled. Use the isolated regression suites documented in README.');
import 'dotenv/config';
import { chromium, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
await mkdir('.screenshots', { recursive: true });
import { db, pool } from '../src/db/index.ts';
import { sql } from 'drizzle-orm';

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const testIds = [];
const runtimeErrors = [];
let adminContext, originalBank, initialOverview, createdAccess = false, adminSessionId, restoreNeeded = false;
const testName = 'Тестовый Эксперт Платформы';
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log('PASS', message); };
async function bankFiles(bank) {
  const qw = new ExcelJS.Workbook(), aw = new ExcelJS.Workbook();
  const qs = qw.addWorksheet('TableQuestions'), as = aw.addWorksheet('TableAnswers');
  qs.addRow(['Id', 'question', 'blockid', 'numberquestion']);
  as.addRow(['Id', 'answer', 'question', 'true_answer', 'numberanswer']);
  for (const q of bank) {
    qs.addRow([q.id, q.text, q.blockId, q.number]);
    for (const a of q.answers) as.addRow([a.id, a.text, q.id, a.correct ? 1 : null, a.number]);
  }
  return { q: Buffer.from(await qw.xlsx.writeBuffer()), a: Buffer.from(await aw.xlsx.writeBuffer()) };
}
async function uploadApi(files) {
  const result = await adminContext.request.post(`${base}/api/portal/admin/import`, { multipart: {
    questions: { name: 'TableQuestions.xlsx', mimeType: mime, buffer: files.q },
    answers: { name: 'TableAnswers.xlsx', mimeType: mime, buffer: files.a }, confirm: 'true',
  }});
  assert(result.ok(), `Atomic import returned ${result.status()}`);
  return result.json();
}
try {
  initialOverview = await (await fetch(`${base}/api/portal/overview`)).json();
  assert(initialOverview.questionCount > 0, 'Central question bank is available');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await mobile.newPage(); page.on('pageerror', (e) => runtimeErrors.push(e.message));
  await page.goto(`${base}/testing?mode=general&block=1`);
  await page.locator('#full-name').fill(testName);
  await page.locator('#from-question').fill('1');
  await page.locator('#to-question').fill('3');
  await page.getByRole('button', { name: 'Начать тест', exact: true }).click();
  await page.waitForURL(/\/test\/[\da-f-]+$/);
  const id = page.url().split('/').pop(); testIds.push(id);
  await expect(page.locator('.test-question-panel h1')).toBeVisible();
  const active = await (await mobile.request.get(`${base}/api/portal/tests/${id}`)).json();
  assert(active.total === 3 && active.questions.every((q) => q.answers.every((a) => !('correct' in a))), 'Range filter and correct-answer redaction work');
  await page.getByRole('radio').nth(2).check();
  await expect(page.locator('.saved-status')).toContainText('Ответ сохранён');
  await page.reload();
  await page.getByRole('button', { name: 'Вопрос 1, ответ сохранён', exact: true }).click();
  await expect(page.getByRole('radio').nth(2)).toBeChecked();
  assert(true, 'Selected answer survives a page reload');
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await page.getByRole('radio').nth(2).check();
  await expect(page.locator('.saved-status')).toContainText('Ответ сохранён');
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await page.getByRole('radio').nth(1).check();
  await expect(page.locator('.saved-status')).toContainText('Ответ сохранён');
  await page.getByRole('button', { name: 'Завершить тест', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  await page.waitForURL(`**/results/${id}`);
  await expect(page.locator('.result-ring strong')).toHaveText('67%');
  await expect(page.locator('.review-card')).toHaveCount(1);
  await expect(page.locator('.review-answer.wrong')).toHaveCount(1);
  await expect(page.locator('.review-answer.correct')).toHaveCount(1);
  await page.screenshot({ path: '.screenshots/mobile-result.png', fullPage: true });
  assert(true, 'Mobile flow, scoring, and mistake review work');
  const pdfResponse = await mobile.request.get(`${base}/api/portal/tests/${id}/pdf`);
  assert(pdfResponse.ok() && (await PDFDocument.load(await pdfResponse.body())).getPageCount() > 0, 'Individual Cyrillic PDF is generated');
  await page.goto(`${base}/results`);
  await expect(page.locator('.table-name')).toContainText(testName);
  assert(true, 'Personal result history is persisted');
  const anonymous = await browser.newContext();
  assert((await anonymous.request.get(`${base}/api/portal/tests/${id}`)).status() === 404, 'Another browser cannot read private results');
  assert((await anonymous.request.get(`${base}/api/portal/admin/stats`)).status() === 401, 'Administration API rejects unauthenticated access');
  await anonymous.close();
  const selective = await (await mobile.request.post(`${base}/api/portal/tests`, { data: { fullName: 'Тестовый Эксперт Выборочный', mode: 'selective', perBlock: 1 } })).json();
  testIds.push(selective.id);
  const ticket = await (await mobile.request.get(`${base}/api/portal/tests/${selective.id}`)).json();
  assert(ticket.total === initialOverview.blockCount && new Set(ticket.questions.map((q) => q.blockId)).size === ticket.total, 'Selective ticket includes one random question from every block');
  await mobile.request.post(`${base}/api/portal/tests/${selective.id}/finish`);
  const timed = await (await mobile.request.post(`${base}/api/portal/tests`, { data: { fullName: 'Тестовый Эксперт Таймер', mode: 'general', blockId: 1, from: 1, to: 1, timerMinutes: 1 } })).json();
  testIds.push(timed.id);
  await db.execute(sql`update test_attempts set started_at = now() - interval '2 minutes' where id = ${timed.id}::uuid`);
  const expired = await (await mobile.request.get(`${base}/api/portal/tests/${timed.id}`)).json();
  assert(expired.status === 'completed' && expired.correctCount === 0, 'Timer is enforced server-side after page closure');

  adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage(); admin.on('pageerror', (e) => runtimeErrors.push(e.message));
  await admin.goto(`${base}/admin`);
  const state = await (await adminContext.request.get(`${base}/api/portal/admin/session`)).json();
  const password = state.setupRequired ? randomBytes(24).toString('base64url') : process.env.ADMIN_PASSWORD;
  if (!password) throw new Error('Admin is already configured; set ADMIN_PASSWORD for testing without changing existing access.');
  await admin.locator('#admin-password').fill(password);
  if (state.setupRequired) await admin.locator('#admin-repeat').fill(password);
  await admin.getByRole('button', { name: state.setupRequired ? 'Создать доступ и войти' : 'Войти в панель' }).click();
  await expect(admin.getByRole('tab', { name: 'Банк вопросов' })).toBeVisible();
  createdAccess = state.setupRequired;
  const cookie = (await adminContext.cookies()).find((c) => c.name === 'ktpp_admin');
  adminSessionId = createHash('sha256').update(cookie.value).digest('hex');
  originalBank = await (await adminContext.request.get(`${base}/api/portal/admin/questions`)).json();
  assert(originalBank.length === initialOverview.questionCount, 'Secure administrator login works');

  await admin.getByRole('button', { name: 'Добавить вопрос', exact: true }).click();
  await admin.locator('#question-text').fill('Тестовый вопрос для проверки CRUD');
  await admin.locator('#question-block').fill('99'); await admin.locator('#question-order').fill('1');
  for (let n = 1; n <= 3; n++) await admin.getByRole('textbox', { name: `Текст ответа ${n}` }).fill(`Вариант ${n}`);
  await admin.getByRole('radio', { name: 'Вариант 2 правильный' }).check();
  await admin.getByRole('button', { name: 'Сохранить вопрос' }).click();
  await expect(admin.getByRole('dialog')).toHaveCount(0);
  const withNew = await (await adminContext.request.get(`${base}/api/portal/admin/questions`)).json();
  const newQuestion = withNew.find((q) => q.blockId === 99 && q.text.includes('CRUD'));
  assert(!!newQuestion, 'Administrator can create questions and answers');
  restoreNeeded = true;
  await admin.getByRole('textbox', { name: 'Поиск по банку' }).fill('CRUD');
  await admin.getByRole('button', { name: `Редактировать вопрос ${newQuestion.id}` }).click();
  await admin.locator('#question-text').fill('Тестовый вопрос для проверки CRUD — обновлён');
  await admin.getByRole('button', { name: 'Сохранить вопрос' }).click();
  await expect(admin.getByRole('dialog')).toHaveCount(0);
  await expect(admin.locator('.admin-question-text')).toContainText('обновлён');
  await admin.getByRole('button', { name: `Удалить вопрос ${newQuestion.id}`, exact: true }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Удалить вопрос', exact: true }).click();
  await expect(admin.getByRole('dialog')).toHaveCount(0);
  await expect(admin.locator('.table-empty')).toBeVisible();
  assert(true, 'Administrator can edit and delete questions');
  restoreNeeded = false;

  const validBank = [{ id: 50001, text: 'Проверочный импорт', blockId: 1, number: 1, answers: [
    { id: 70001, text: '1. Первый вариант', number: 1, correct: false },
    { id: 70002, text: '1.5 м', number: 2, correct: false },
    { id: 70003, text: '3. Верный ответ', number: 3, correct: true },
  ] }];
  const invalidBank = [{ ...validBank[0], answers: validBank[0].answers.map((a) => ({ ...a, correct: false })) }, { ...validBank[0] }];
  const invalidFiles = await bankFiles(invalidBank);
  await admin.getByRole('tab', { name: 'Импорт Excel' }).click();
  await admin.getByLabel('TableQuestions.xlsx', { exact: true }).setInputFiles({ name: 'TableQuestions.xlsx', mimeType: mime, buffer: invalidFiles.q });
  await admin.getByLabel('TableAnswers.xlsx', { exact: true }).setInputFiles({ name: 'TableAnswers.xlsx', mimeType: mime, buffer: invalidFiles.a });
  await admin.getByRole('checkbox').check();
  await admin.getByRole('button', { name: 'Проверить и импортировать' }).click();
  await expect(admin.locator('.error-box')).toContainText('База не изменена');
  const unchanged = await (await adminContext.request.get(`${base}/api/portal/admin/questions`)).json();
  assert(unchanged.length === originalBank.length && unchanged[0].text === originalBank[0].text, 'Invalid Excel import is rejected without partial changes');
  const validFiles = await bankFiles(validBank);
  await admin.getByLabel('TableQuestions.xlsx', { exact: true }).setInputFiles({ name: 'TableQuestions.xlsx', mimeType: mime, buffer: validFiles.q });
  await admin.getByLabel('TableAnswers.xlsx', { exact: true }).setInputFiles({ name: 'TableAnswers.xlsx', mimeType: mime, buffer: validFiles.a });
  restoreNeeded = true;
  await admin.getByRole('button', { name: 'Проверить и импортировать' }).click();
  await expect(admin.locator('.success-box')).toContainText('Банк обновлён');
  const imported = await (await adminContext.request.get(`${base}/api/portal/admin/questions`)).json();
  assert(imported.length === 1 && imported[0].id === 50001 && imported[0].answers[0].text === 'Первый вариант' && imported[0].answers[1].text === '1.5 м', 'Valid import preserves IDs, orders answers, and normalizes only numbering');
  const oldResult = await (await mobile.request.get(`${base}/api/portal/tests/${id}`)).json();
  assert(oldResult.total === 3 && oldResult.percentage === 67, 'Historical snapshots survive complete bank replacement');
  await uploadApi(await bankFiles(originalBank)); restoreNeeded = false;

  await admin.getByRole('tab', { name: 'Статистика' }).click();
  await admin.getByRole('textbox', { name: 'Поиск по ФИО' }).fill(testName);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kaliningrad' }).format(new Date());
  await admin.getByLabel('Дата начала периода').fill(today);
  await admin.getByLabel('Дата окончания периода').fill(today);
  await admin.getByRole('button', { name: 'Применить' }).click();
  await expect(admin.locator('.table-name')).toHaveText([testName]);
  const query = new URLSearchParams({ name: testName, from: today, to: today });
  const xlsx = await adminContext.request.get(`${base}/api/portal/admin/export?${query}&format=xlsx`);
  const exportBook = new ExcelJS.Workbook(); await exportBook.xlsx.load(await xlsx.body());
  assert(xlsx.ok() && exportBook.worksheets[0].rowCount === 2 && exportBook.worksheets[0].getCell('A2').text === testName, 'Filtered Excel export contains exactly the requested expert');
  const statsPdf = await adminContext.request.get(`${base}/api/portal/admin/export?${query}&format=pdf`);
  assert(statsPdf.ok() && (await PDFDocument.load(await statsPdf.body())).getPageCount() >= 1, 'Filtered PDF export is valid');
  await admin.screenshot({ path: '.screenshots/admin-statistics.png' });

  for (const width of [320, 390, 768, 1440]) {
    await admin.setViewportSize({ width, height: 1000 });
    await admin.goto(base); await expect(admin.locator('.hero h1')).toBeVisible();
    assert(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Home has no horizontal overflow at ${width}px`);
  }
  await page.goto(`${base}/questions`);
  await expect(page.locator('.question-item')).toHaveCount(10);
  await page.getByRole('textbox', { name: 'Поиск вопросов' }).fill('Кто может быть субъектом');
  await expect(page.locator('.question-item')).toHaveCount(1);
  await page.locator('summary').click();
  await expect(page.locator('.question-option')).toHaveCount(3);
  assert(true, 'Question bank search, pagination, and answer preview work');
  await page.goto(`${base}/documents`);
  await page.getByRole('button', { name: 'Открыть', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const doc = await page.request.get(`${base}/api/portal/documents/testing-rules`);
  assert(doc.ok() && (await PDFDocument.load(await doc.body())).getPageCount() > 0, 'Document registry preview and PDF downloads work');
  assert(runtimeErrors.length === 0, `No browser runtime errors: ${runtimeErrors.join('; ')}`);
  console.log('ALL ACCEPTANCE CHECKS PASSED');
} finally {
  if (restoreNeeded && originalBank && adminContext) await uploadApi(await bankFiles(originalBank));
  for (const id of testIds.filter(Boolean)) await db.execute(sql`delete from test_attempts where id = ${id}::uuid`);
  if (initialOverview) {
    await db.execute(sql`update portal_settings set value = ${initialOverview.isDemo ? '1' : '0'} where key = 'demo_bank'`);
    await db.execute(sql`update portal_settings set value = ${initialOverview.updatedAt} where key = 'bank_updated'`);
  }
  if (adminSessionId) await db.execute(sql`delete from admin_sessions where id = ${adminSessionId}`);
  if (createdAccess) await db.execute(sql`delete from portal_settings where key = 'admin_password'`);
  await browser.close(); await pool.end();
  console.log('Test records removed; original question bank and first-run admin access restored.');
}
