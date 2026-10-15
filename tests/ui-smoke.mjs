import {chromium, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createFixture, attemptId, resultId} from './fixtures.mjs';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3000';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('UI regression suite requires an isolated local preview.');
await fs.mkdir('.artifacts/ui',{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
const page=await context.newPage();page.setDefaultTimeout(12000);
let fixture=createFixture(), override=null;const errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.origin!==new URL(base).origin){requests.push(req.url());await route.abort();return;}
 if(!url.pathname.startsWith('/test-api/')){await route.continue();return;}
 const path=url.pathname.slice('/test-api/'.length)+url.search;
 if(override&&await override(route,path))return;
 const data=await fixture(path,req.method(),req.postDataJSON()||{});
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS',name);}
try{
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:1000});
  for(const route of ['/','/testing/','/questions/','/results/','/documents/','/help/','/admin/']){
   await check(`${width}px ${route}: rendered, no page overflow`,async()=>{
    await page.goto(base+route);await expect(page.locator('h1').first()).toBeVisible();
    await page.evaluate(()=>document.fonts.ready);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`horizontal overflow at ${width} ${route}`);
    if(['/','/testing/','/admin/'].includes(route))await page.screenshot({path:`.artifacts/ui/${width}-${route.replaceAll('/','')||'home'}.png`,fullPage:true,animations:'disabled',timeout:15000});
   });
  }
 }
 await page.setViewportSize({width:390,height:844});
 await check('mobile drawer: focus trap, escape, inert closed navigation',async()=>{
  await page.goto(base+'/');await expect(page.locator('h1').first()).toBeVisible();
  const nav=page.locator('#main-navigation');await expect(nav).toHaveAttribute('inert','');
  await page.getByRole('button',{name:'Открыть меню',exact:true}).click();await expect(nav).not.toHaveAttribute('inert','');
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
  const links=nav.locator('a');await links.last().focus();await page.keyboard.press('Tab');await expect(links.first()).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Открыть меню',exact:true})).toBeFocused();await expect(nav).toHaveAttribute('inert','');
 });
 await check('missing attempt IDs show recovery links, not infinite spinners',async()=>{
  for(const route of ['/test/','/results/view/']){await page.goto(base+route);await expect(page.getByRole('heading',{name:/не найден/})).toBeVisible();await expect(page.locator('#main-content').getByRole('link',{name:'Мои результаты',exact:true})).toBeVisible();}
 });
 await check('admin API failure offers retry and recovers',async()=>{
  override=async(route,path)=>{if(path==='overview'){await route.fulfill({status:403,contentType:'application/json',body:'{"error":"Синтетический сбой API"}'});return true;}return false;};
  await page.goto(base+'/admin/');await expect(page.locator('.error-box[role=alert]')).toContainText('Синтетический сбой');
  override=null;await page.getByRole('button',{name:'Повторить',exact:true}).click();await expect(page.getByRole('heading',{name:'Панель администратора'})).toBeVisible();
 });
 await check('switching exam never displays the previous bank while loading',async()=>{
  await page.goto(base+'/testing/');await expect(page.locator('#exam-select')).toHaveValue('1');
  let release;const wait=new Promise(resolve=>release=resolve);
  override=async(route,path)=>{if(path==='overview?examId=2'){await wait;await route.fulfill({contentType:'application/json',body:JSON.stringify(await fixture(path))});return true;}return false;};
  await page.locator('#exam-select').selectOption('2');await expect(page.getByText('Загружаем выбранный тест…')).toBeVisible();await expect(page.getByRole('button',{name:'Начать тест',exact:false})).toHaveCount(0);
  release();await expect(page.locator('#exam-select')).toHaveValue('2');override=null;
 });
 await check('retake preserves exam ID',async()=>{
  await page.goto(base+`/results/view/?id=${resultId}`);await expect(page.getByRole('heading',{name:'Результат тестирования',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Пройти ещё раз'})).toHaveAttribute('href',/exam=2/);
 });
 await check('saving failure is shown, never falsely marked as saved',async()=>{
  fixture=createFixture();override=async(route,path)=>{if(path===`tests/${attemptId}`&&route.request().method()==='PATCH'){await route.fulfill({status:422,contentType:'application/json',body:'{"error":"Не удалось сохранить ответ"}'});return true;}return false;};
  await page.goto(base+`/test/?id=${attemptId}`);await expect(page.locator('.answer-choice').first()).toBeVisible();
  await page.locator('.answer-choice input').first().click();await expect(page.locator('.error-box[role=alert]')).toContainText('Не удалось сохранить ответ');
  await expect(page.locator('.answer-choice input').first()).not.toBeChecked();await expect(page.getByRole('button',{name:'Далее',exact:true})).toBeDisabled();
  override=null;await page.locator('.answer-choice input').first().click();await expect(page.locator('.saved-status')).toContainText('Ответ сохранён на сервере');await expect(page.getByRole('button',{name:'Далее',exact:true})).toBeEnabled();
 });
 await check('finish waits for pending save and complete walkthrough works',async()=>{
  await page.getByRole('button',{name:'Далее',exact:true}).click();await page.locator('.answer-choice input').first().click();await expect(page.locator('.saved-status')).toContainText('Ответ сохранён на сервере');await page.getByRole('button',{name:'Далее',exact:true}).click();
  let release;const wait=new Promise(resolve=>release=resolve);
  override=async(route,path)=>{if(path===`tests/${attemptId}`&&route.request().method()==='PATCH'){await wait;await route.fulfill({contentType:'application/json',body:JSON.stringify(await fixture(path,'PATCH',route.request().postDataJSON()))});return true;}return false;};
  await page.locator('.answer-choice input').first().click();await expect(page.locator('.saved-status')).toContainText('Сохраняем');await expect(page.locator('.test-question-actions button').last()).toBeDisabled();release();override=null;
  await expect(page.getByRole('button',{name:'Завершить тест',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Завершить тест',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'Завершить',exact:true}).click();await expect(page.getByRole('heading',{name:'Результат тестирования',exact:true})).toBeVisible();
 });
 await check('trailing-slash routes retain navigation state',async()=>{
  await page.setViewportSize({width:1440,height:1000});
  for(const [route,label] of [['/testing/','Пройти тестирование'],['/results/','Мои результаты']]){
   await page.goto(base+route);await expect(page.locator('h1').first()).toBeVisible();
   await expect(page.locator('#main-navigation').getByRole('link',{name:label,exact:true})).toHaveAttribute('aria-current','page');
  }
 });
 await check('admin modal traps focus and restores focus on escape',async()=>{
  await page.goto(base+'/admin/');const trigger=page.getByRole('button',{name:'Новый тест',exact:true});await trigger.click();
  const modal=page.getByRole('dialog');await expect(modal).toBeVisible();
  const buttons=modal.locator('button');await buttons.last().focus();await page.keyboard.press('Tab');await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await expect(trigger).toBeFocused();
 });
 await check('admin updates stay in current tab and refresh client metrics',async()=>{
  await page.getByRole('tab',{name:'Банк вопросов',exact:true}).click();await expect(page.locator('.admin-metric').nth(1).locator('strong')).toHaveText('2');
  await page.getByRole('tab',{name:'Тесты (банки)',exact:true}).click();await page.getByRole('button',{name:'Новый тест',exact:true}).click();
  await page.locator('#exam-name').fill('ДЕМО · Созданный тест');await page.getByRole('dialog').getByRole('button',{name:'Создать тест',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab',{name:'Банк вопросов',exact:true}).click();await expect(page.locator('.admin-metric').nth(1).locator('strong')).toHaveText('3');
 });
 await check('question search can recover from empty results',async()=>{
  await page.goto(base+'/questions/');const search=page.getByRole('textbox',{name:'Поиск вопросов'});await search.fill('заведомонесуществующийвопрос');await expect(page.getByRole('heading',{name:'Вопросы не найдены'})).toBeVisible();await search.clear();await expect(page.locator('.question-item').first()).toBeVisible();
 });
 assert.deepEqual(errors,[],'browser runtime errors');assert.deepEqual(requests,[],'unexpected external requests');
 console.log(`ALL ${passed} UI checks passed; no runtime errors; no external requests.`);
}finally{await browser.close();}
