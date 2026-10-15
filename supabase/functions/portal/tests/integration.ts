// Destructive to the explicitly named LOCAL test DB only. No production access.
const database = Deno.env.get("DB_URL");
if (!database) throw new Error("DB_URL required");
const location = new URL(database);
if (Deno.env.get("ALLOW_TEST_DB_WRITES") !== "yes" || !["127.0.0.1", "localhost"].includes(location.hostname) || !location.pathname.endsWith("_test")) {
  throw new Error("Refusing to run: require ALLOW_TEST_DB_WRITES=yes and localhost database ending in _test.");
}
const { db, closeDb } = await import("../lib/db.ts");
const { sql } = await import("../lib/drizzle.ts");
const { handleRequest } = await import("../lib/router.ts");
const { login } = await import("../lib/auth.ts");
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
let count=0;
async function check(name: string, run: () => Promise<void>) { await run(); count++; console.log("PASS", name); }
const visitor = crypto.randomUUID();
let adminToken = "";
async function call(path: string, method = "GET", input?: unknown, v = visitor, admin = false) {
  const r = await handleRequest(new Request("http://test.invalid/portal/" + path, {
    method, headers: { "content-type": "application/json", "x-visitor-id": v, ...(admin ? { "x-admin-token": adminToken } : {}) },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
  }));
  return { status: r.status, body: await r.json() };
}
try {
  await db.execute(sql`truncate test_attempts, "TableAnswers", "TableQuestions", bank_backups, exams, admin_sessions, admin_auth_limits, portal_settings restart identity cascade`);
  Deno.env.delete("ADMIN_PASSWORD");Deno.env.delete("ADMIN_SETUP_TOKEN");
  await check("demo bank initializes in test database",async()=>{const r=await call("overview");assert(r.status===200&&r.body.questionCount===36,"seed");});
  await check("admin routes deny unauthenticated requests",async()=>{assert((await call("admin/questions")).status===401,"admin access");});
  await check("bootstrap denied without setup secret",async()=>{const r=await call("admin/login","POST",{password:"isolated-password",setup:true});assert(r.status===403,"open bootstrap");});
  const setupToken=crypto.randomUUID();Deno.env.set("ADMIN_SETUP_TOKEN",setupToken);
  await check("parallel bootstrap has exactly one winner",async()=>{
    const results=await Promise.all(Array.from({length:6},(_,i)=>call("admin/login","POST",{password:`isolated-password-${i}`,setup:true,setupToken})));
    const success=results.filter(r=>r.status===200);assert(success.length===1,"more than one bootstrap session");adminToken=success[0].body.token;
    assert(results.every(r=>[200,401,409].includes(r.status)),"unexpected bootstrap status");
  });
  await check("concurrent auth limit increments do not get lost",async()=>{
    await db.execute(sql`truncate admin_auth_limits`);
    const attempts=await Promise.all(Array.from({length:24},()=>login("incorrect-password",false,"test-rate-limit").then(()=>200).catch(e=>e.status)));
    assert(attempts.filter(status=>status===429).length===14,"expected 14 rate-limited requests");
    assert(attempts.filter(status=>status===401).length===10,"expected 10 password checks");
  });
  let examId=0;
  await check("admin creates an independent exam",async()=>{const r=await call("admin/exams","POST",{name:"Изолированный тест"},visitor,true);assert(r.status===201,"create exam");examId=r.body.id;});
  const qs=[{id:1,text:"Тестовый вопрос",blockId:1,number:1}];
  const answers=[{id:1,questionId:1,number:1,text:"Верный",correct:true},{id:2,questionId:1,number:2,text:"Неверный",correct:false}];
  await check("valid JSON bank import",async()=>{const r=await call("admin/import","POST",{examId,questions:qs,answers},visitor,true);assert(r.status===200,"import");});
  await check("invalid import does not replace bank",async()=>{
    const r=await call("admin/import","POST",{examId,questions:qs,answers:answers.map(a=>({...a,correct:true}))},visitor,true);assert(r.status===422,"invalid import accepted");assert((await call(`questions?examId=${examId}`)).body.length===1,"bank changed");
  });
  await check("malformed import rows and nonboolean markers return 422",async()=>{
    for (const body of [
      {examId,questions:[null],answers},
      {examId,questions:qs,answers:[null]},
      {examId,questions:qs,answers:answers.map(a=>({...a,correct:a.correct ? "false" : false}))},
    ]) assert((await call("admin/import","POST",body,visitor,true)).status===422,"malformed import accepted or crashed");
    assert((await call(`questions?examId=${examId}`)).body.length===1,"malformed import changed bank");
  });
  let id="",questionId=0,answerId=0;
  await check("attempt creation and active answer secrecy",async()=>{
    const r=await call("tests","POST",{fullName:"Тестовый Эксперт",examId,mode:"general"});assert(r.status===201,"attempt");id=r.body.id;
    const view=await call(`tests/${id}`);questionId=view.body.questions[0].id;answerId=view.body.questions[0].answers[0].id;
    assert(!("correct" in view.body.questions[0].answers[0]),"correct answer leaked");
  });
  await check("other visitor cannot read or mutate attempt",async()=>{
    const stranger=crypto.randomUUID();assert((await call(`tests/${id}`,"GET",undefined,stranger)).status===404,"privacy");
    assert((await call(`tests/${id}`,"PATCH",{questionId,answerId},stranger)).status===404,"write privacy");
  });
  await check("repeated answer writes and finish are idempotent",async()=>{
    for(let i=0;i<2;i++)assert((await call(`tests/${id}`,"PATCH",{questionId,answerId})).status===200,"save");
    for(let i=0;i<2;i++){const r=await call(`tests/${id}/finish`,"POST");assert(r.status===200&&r.body.correctCount===1,"finish");}
  });
  await check("bank replacement preserves historic snapshots",async()=>{
    await call("admin/import","POST",{examId,questions:qs.map(q=>({...q,text:"Обновлённый вопрос"})),answers},visitor,true);
    assert((await call(`tests/${id}`)).body.questions[0].text==="Тестовый вопрос","snapshot changed");
  });
  await check("backup restore produces a separate exam",async()=>{
    const backups=await call("admin/backups","GET",undefined,visitor,true);assert(backups.body.length>0,"missing backup");
    const r=await call(`admin/backups/${backups.body[0].id}`,"POST",undefined,visitor,true);assert(r.status===200&&r.body.id!==examId&&r.body.questionCount===1,"restore");
  });
  await check("logout revokes admin session",async()=>{await call("admin/logout","POST",undefined,visitor,true);assert((await call("admin/questions","GET",undefined,visitor,true)).status===401,"token not revoked");});
  console.log(`ALL ${count} local integration checks passed.`);
} finally { await closeDb(); }
