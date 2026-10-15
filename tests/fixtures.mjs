// Synthetic, in-memory data only. Never reads a real database or credential.
export const attemptId = '11111111-2222-4333-8444-555555555555';
export const resultId = '99999999-2222-4333-8444-555555555555';
export function createFixture() {
  let authenticated = true;
  const exams = [
    {id:1,name:'ДЕМО · Учебный банк',description:'Изолированный тестовый стенд. Данные вымышлены.',questionCount:3,blockCount:2},
    {id:2,name:'ДЕМО · Другой банк',description:'Проверка переключения независимых тестов.',questionCount:2,blockCount:1},
  ];
  const questions = Array.from({length:5},(_,i)=>({id:i+1,examId:i<3?1:2,blockId:i<2?1:2,number:i+1,text:`Вопрос ${i+1}: какое действие следует выполнить эксперту перед подготовкой заключения?`,answers:[{id:i*2+1,number:1,text:'Проверить исходные данные и подтвердить применимость методики.',correct:true},{id:i*2+2,number:2,text:'Пропустить проверку и сразу сформировать результат.',correct:false}]}));
  let attempt={id:attemptId,fullName:'Тестовый Эксперт',examId:1,examName:exams[0].name,mode:'general',status:'active',startedAt:new Date().toISOString(),finishedAt:null,questions:questions.slice(0,3),responses:{},total:3,correctCount:0,percentage:0,timeLimit:0};
  const completed={...structuredClone(attempt),id:resultId,examId:2,examName:exams[1].name,status:'completed',finishedAt:new Date().toISOString(),responses:{1:1,2:3,3:6},correctCount:2,percentage:67};
  const history=()=>[{...completed,questions:undefined,responses:undefined}];
  return async function fixture(path, method='GET', body={}) {
    const url=new URL(path,'https://fixture.invalid');
    const key=url.pathname.replace(/^\//,'').replace(/\/$/,'');
    const examId=Number(url.searchParams.get('examId'));
    const scoped=questions.filter(q=>!examId||q.examId===examId);
    if(key==='overview')return {questionCount:scoped.length,blockCount:new Set(scoped.map(q=>q.blockId)).size,completedCount:1,blocks:[...new Set(scoped.map(q=>q.blockId))].map(id=>({id,count:scoped.filter(q=>q.blockId===id).length})),isDemo:true,updatedAt:new Date().toISOString(),exams};
    if(key==='exams'||key==='admin/exams'&&method==='GET')return exams;
    if(key==='questions'||key==='admin/questions'&&method==='GET')return scoped;
    if(key==='admin/session')return {authenticated,setupRequired:false};
    if(key==='admin/login'){authenticated=true;return {authenticated:true,setupRequired:false,token:'synthetic-test-session'};}
    if(key==='admin/logout'){authenticated=false;return {ok:true};}
    if(key==='admin/backups')return [];
    if(key==='admin/stats'||key==='results')return history();
    if(key==='tests'&&method==='POST'){
      const qs=questions.filter(q=>q.examId===Number(body.examId));
      attempt={...attempt,...body,id:attemptId,status:'active',questions:qs,responses:{},total:qs.length,timeLimit:Number(body.timerMinutes||0)*60,startedAt:new Date().toISOString(),finishedAt:null,examName:exams.find(e=>e.id===Number(body.examId))?.name};
      return {id:attemptId};
    }
    if(key===`tests/${resultId}`)return completed;
    if(key===`tests/${attemptId}`){if(method==='PATCH')attempt.responses[body.questionId]=body.answerId;return structuredClone(attempt);}
    if(key===`tests/${attemptId}/finish`){attempt.status='completed';attempt.finishedAt=new Date().toISOString();attempt.correctCount=attempt.questions.filter(q=>q.answers.some(a=>a.correct&&a.id===attempt.responses[q.id])).length;attempt.percentage=Math.round(attempt.correctCount/attempt.total*100);return structuredClone(attempt);}
    if(key==='admin/exams'&&method==='POST'){const exam={id:exams.length+1,...body,questionCount:0,blockCount:0};exams.push(exam);return exam;}
    return {ok:true};
  };
}
