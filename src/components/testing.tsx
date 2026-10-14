"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, CircleCheck, Clock3, GraduationCap, Layers3, ListChecks, LoaderCircle, RotateCcw, ShieldCheck, Shuffle, SlidersHorizontal, Trophy, UserRound, X, XCircle } from "lucide-react";
import { api, EmptyState, ErrorBox, Loading, Modal, Notice, PageHeading, useApi } from "@/components/ui";
import { formatDate, getBlockTitle, modeLabels, type AttemptData, type ExamData, type Mode, type Overview } from "@/lib/types";

export function TestingSetup({ overview: initial }: { overview: Overview }) {
  const search = useSearchParams(), router = useRouter();
  const { data: examList } = useApi<ExamData[]>("exams");
  const [examId, setExamId] = useState(search.get("exam") || "");
  useEffect(() => { if (!examId && examList?.length) setExamId(String((examList.find((x) => x.questionCount > 0) ?? examList[0]).id)); }, [examList, examId]);
  const { data: scoped } = useApi<Overview>(examId ? `overview?examId=${examId}` : "overview");
  const overview = (examId ? scoped : initial) ?? initial;
  const [fullName, setFullName] = useState("");
  const [mode, setMode] = useState<Mode>(search.get("mode") === "selective" ? "selective" : "general");
  const [blockId, setBlockId] = useState(search.get("block") || "");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [perBlock, setPerBlock] = useState(2), [timer, setTimer] = useState(false), [timerMinutes, setTimerMinutes] = useState(30);
  const [advanced, setAdvanced] = useState(!!search.get("block")), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const maxPerBlock = Math.min(100, ...overview.blocks.map((b) => b.count));
  const selectedCount = mode === "selective" ? Math.min(perBlock, maxPerBlock) * overview.blockCount : blockId ? overview.blocks.find((b) => b.id === Number(blockId))?.count ?? 0 : overview.questionCount;
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<{ id: string }>("tests", { method: "POST", body: JSON.stringify({ fullName, mode, blockId, from, to, perBlock: Math.min(perBlock, maxPerBlock), timerMinutes: timer ? timerMinutes : 0, examId: Number(examId) }) });
      router.push(`/test?id=${result.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  if (examList && !examList.length) return <><PageHeading title="Тестирование" description="Выберите тест, режим и приступайте к вопросам."/><div className="empty-state"><span className="aside-icon"><GraduationCap size={26}/></span><h2>Тесты пока не заведены</h2><p>Как только администратор создаст тест и загрузит в него вопросы, он появится здесь.</p><Link href="/questions" className="button">Посмотреть банк вопросов</Link></div></>;
  return <><PageHeading eyebrow="ВАШ СЛЕДУЮЩИЙ ШАГ" title="Начать тестирование" description="Представьтесь и выберите удобный формат. Регистрация и пароль не нужны."/><div className="setup-layout"><form className="form-panel" onSubmit={submit}>
    <h2 className="section-label"><span>1</span>Какой тест проходите?</h2><div className="field"><label htmlFor="exam-select">Тест (банк вопросов)</label><select id="exam-select" value={examId} onChange={(e) => { setExamId(e.target.value); setBlockId(""); setFrom(""); setTo(""); }} required>{(examList ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}{x.questionCount ? ` · ${x.questionCount} вопр.` : " · банк пуст"}</option>)}</select><small>{examList?.find((x) => String(x.id) === examId)?.description || "Выберите тест — от него зависят доступные блоки и число вопросов."}</small></div>
    <div className="form-divider"/><h2 className="section-label"><span>2</span>Как к вам обращаться?</h2><div className="field"><label htmlFor="full-name">Фамилия, имя и отчество <span style={{ color: "#9baac0", fontWeight: 400 }}>(при наличии)</span></label><div className="input-with-icon"><UserRound size={17}/><input id="full-name" name="name" autoComplete="name" placeholder="Иванов Иван Иванович" value={fullName} onChange={(e) => setFullName(e.target.value)} minLength={5} maxLength={180} required autoFocus/></div><small>ФИО будет указано в вашем результате тестирования.</small></div>
    <div className="form-divider"/><h2 className="section-label"><span>3</span>Выберите режим</h2><div className="mode-choices" role="radiogroup" aria-label="Режим тестирования"><button type="button" role="radio" aria-checked={mode === "general"} className={`mode-choice ${mode === "general" ? "active" : ""}`} onClick={() => setMode("general")}><BookOpen size={24}/><span className="mode-radio"/><strong>Общий тест</strong><p>Последовательная подготовка<br/>по всем вопросам или теме</p></button><button type="button" role="radio" aria-checked={mode === "selective"} className={`mode-choice ${mode === "selective" ? "active" : ""}`} onClick={() => setMode("selective")}><Shuffle size={24}/><span className="mode-radio"/><strong>Выборочный тест</strong><p>Случайный билет с вопросами<br/>из каждого блока</p></button></div>
    {mode === "selective" && <div className="test-settings"><div className="field"><label htmlFor="per-block">Вопросов из каждого тематического блока</label><select id="per-block" value={Math.min(perBlock, maxPerBlock)} onChange={(e) => setPerBlock(Number(e.target.value))}>{Array.from({ length: Math.min(20, maxPerBlock) }, (_, n) => <option key={n + 1} value={n + 1}>{n + 1} из каждого блока · {(n + 1) * overview.blockCount} всего</option>)}</select><small>Для каждого билета вопросы выбираются заново и без повторений.</small></div></div>}
    <button className="settings-toggle" type="button" aria-expanded={advanced} aria-controls="advanced-settings" onClick={() => setAdvanced(!advanced)}><span className="flex items-center gap-2"><SlidersHorizontal size={15}/>Настроить параметры теста</span><ChevronDown size={16} style={{ transform: advanced ? "rotate(180deg)" : "" }}/></button>
    {advanced && <div id="advanced-settings">{mode === "general" && <><div className="field"><label htmlFor="block">Тематический блок</label><select id="block" value={blockId} onChange={(e) => setBlockId(e.target.value)}><option value="">Все тематические блоки</option>{overview.blocks.map((b) => <option value={b.id} key={b.id}>{getBlockTitle(b.id)}</option>)}</select></div><div className="field-row"><div className="field"><label htmlFor="from-question">С вопроса №</label><input id="from-question" type="number" min="1" max="2147483647" placeholder="С первого" value={from} onChange={(e) => setFrom(e.target.value)}/></div><div className="field"><label htmlFor="to-question">По вопрос №</label><input id="to-question" type="number" min={from || 1} max="2147483647" placeholder="До последнего" value={to} onChange={(e) => setTo(e.target.value)}/></div></div><p className="field-hint" style={{ marginTop: -9, marginBottom: 18 }}>Диапазон применяется к порядковому номеру вопроса внутри каждого выбранного блока.</p></>}
      <div className="timer-setting"><Clock3 size={19} color="#8ca1bd"/><div><strong>Ограничить время</strong><small>По истечении времени тест завершится автоматически</small></div><button type="button" className={`switch ${timer ? "on" : ""}`} role="switch" aria-checked={timer} aria-label="Ограничить время теста" onClick={() => setTimer(!timer)}><span/></button></div>{timer && <div className="field"><label htmlFor="timer-minutes">Время на весь тест</label><select id="timer-minutes" value={timerMinutes} onChange={(e) => setTimerMinutes(Number(e.target.value))}><option value={15}>15 минут</option><option value={30}>30 минут</option><option value={60}>60 минут</option><option value={90}>90 минут</option></select></div>}
    </div>}
    <ErrorBox message={error}/>{!overview.questionCount && <Notice>Банк пока пуст. Администратор должен добавить вопросы.</Notice>}<div className="setup-footer"><span className="flex items-center gap-2"><ListChecks size={15}/>{from || to ? "Вопросы из выбранного диапазона" : `${selectedCount} вопросов`}{!timer && " · Без ограничения времени"}</span><button type="submit" className="button primary" disabled={busy || !examId || !overview.questionCount}>{busy ? <LoaderCircle size={16} className="spin"/> : <GraduationCap size={17}/>} {busy ? "Создаём тест…" : "Начать тест"}<ArrowRight size={16}/></button></div><p className="consent-note">При запуске ФИО и результаты сохраняются на сервере. <Link href="/documents?document=privacy">Как обрабатываются данные</Link></p>
    </form><aside className="setup-aside"><div className="content-panel"><span className="aside-icon"><ShieldCheck size={25}/></span><h3>Сосредоточьтесь на знаниях</h3><p>Мы позаботились о том, чтобы тестирование было простым и понятным.</p><ol><li><span>1</span><div><strong>Один вопрос — один ответ</strong><p>Выберите наиболее точный вариант из предложенных.</p></div></li><li><span>2</span><div><strong>Ваш прогресс сохранён</strong><p>Можно вернуться к вопросу и изменить ответ до завершения.</p></div></li><li><span>3</span><div><strong>Результат с объяснением</strong><p>Сразу увидите оценку и правильные ответы в разборе ошибок.</p></div></li></ol></div><Notice>{overview.isDemo ? "Сейчас доступен учебный банк. Его материалы предназначены для знакомства с платформой." : "Тест использует актуальную версию единого банка вопросов."}</Notice></aside></div></>;
}

export function TestRunner({ id }: { id: string }) {
  const router = useRouter();
  const { data: attempt, setData: setAttempt, error: loadError, refresh: refreshAttempt } = useApi<AttemptData>(`tests/${id}`);
  const [index, setIndex] = useState(0), [saving, setSaving] = useState(0), [error, setError] = useState("");
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [confirm, setConfirm] = useState(false), [finishing, setFinishing] = useState(false), [remaining, setRemaining] = useState<number | null>(null);
  const [timeWarning, setTimeWarning] = useState<number | null>(null), [timeoutNotice, setTimeoutNotice] = useState(false), [answerHint, setAnswerHint] = useState("");
  const warnedAt = useRef<Set<number>>(new Set());
  const initialized = useRef(false), finishLock = useRef(false);
  const finish = useCallback(async () => {
    if (finishLock.current) return;
    finishLock.current = true; setFinishing(true); setError("");
    try { await saveQueue.current.catch(() => undefined); await api(`tests/${id}/finish`, { method: "POST" }); router.replace(`/results/view?id=${id}`); }
    catch (e) { setError((e as Error).message); finishLock.current = false; setFinishing(false); setConfirm(false); }
  }, [id, router]);
  useEffect(() => {
    if (!attempt) return;
    if (attempt.status === "completed") { router.replace(`/results/view?id=${id}`); return; }
    if (!initialized.current) { const first = attempt.questions.findIndex((q) => !attempt.responses[q.id]); setIndex(first >= 0 ? first : 0); initialized.current = true; }
  }, [attempt, id, router]);
  useEffect(() => {
    if (!attempt?.timeLimit || attempt.status !== "active") return;
    const deadline = Date.parse(attempt.startedAt) + attempt.timeLimit * 1000;
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick(); const interval = setInterval(tick, 1000); return () => clearInterval(interval);
  }, [attempt?.startedAt, attempt?.timeLimit, attempt?.status]);
  // Предупреждения: за 5 минут и за минуту до конца — поверх экрана, с автоскрытием.
  useEffect(() => {
    if (remaining === null || attempt?.status !== "active") return;
    for (const mark of [300, 60]) if (remaining <= mark && remaining > 0 && !warnedAt.current.has(mark)) { warnedAt.current.add(mark); setTimeWarning(mark); break; }
  }, [remaining, attempt?.status]);
  useEffect(() => { if (timeWarning === null) return; const timer = setTimeout(() => setTimeWarning(null), 12000); return () => clearTimeout(timer); }, [timeWarning]);
  // Время вышло: показываем уведомление и через пару секунд завершаем тест автоматически.
  useEffect(() => {
    if (remaining !== 0 || attempt?.status !== "active") return;
    setTimeoutNotice(true);
    const timer = setTimeout(() => void finish(), 3500);
    return () => clearTimeout(timer);
  }, [remaining, attempt?.status, finish]);
  function goTo(next: number) { setAnswerHint(""); setIndex(next); }
  function selectAnswer(answerId: number) {
    if (!attempt || finishing) return;
    const question = attempt.questions[index], before = attempt.responses[question.id];
    setError("");
    setAttempt((current) => current ? { ...current, responses: { ...current.responses, [question.id]: answerId } } : current);
    setSaving((n) => n + 1);
    const job = saveQueue.current.then(async () => {
      const fresh = await api<AttemptData>(`tests/${id}`, { method: "PATCH", body: JSON.stringify({ questionId: question.id, answerId }) });
      setAttempt((current) => current ? { ...fresh, responses: { ...fresh.responses, ...current.responses } } : fresh);
    });
    saveQueue.current = job.catch(() => undefined);
    job.catch((e) => {
      setError((e as Error).message);
      setAttempt((current) => {
        if (!current) return current;
        const responses = { ...current.responses };
        if (before === undefined) delete responses[question.id]; else responses[question.id] = before;
        return { ...current, responses };
      });
    }).finally(() => setSaving((n) => Math.max(0, n - 1)));
  }
  if (loadError) return <ErrorBox message={loadError} onRetry={refreshAttempt}/>;
  if (!attempt || attempt.status === "completed") return <Loading text="Подготавливаем ваш тест…"/>;
  if (!attempt.questions?.length) return <ErrorBox message="Не удалось получить вопросы теста. Ответы, уже сохранённые на сервере, не потеряны — нажмите «Повторить»." onRetry={refreshAttempt}/>;
  const safeIndex = Math.min(index, attempt.questions.length - 1);
  const question = attempt.questions[safeIndex], answered = Object.keys(attempt.responses ?? {}).length;
  const initials = attempt.fullName.split(" ").slice(0, 2).map((p) => p[0]).join("");
  return <>{timeWarning !== null && <div className="time-toast" role="alert" aria-live="assertive"><Clock3 size={17}/><div><strong>{timeWarning <= 60 ? "Осталась одна минута" : "Осталось 5 минут"}</strong><span>{timeWarning <= 60 ? "Тест завершится автоматически — ответы, данные ранее, сохранятся." : "Успейте ответить на оставшиеся вопросы."}</span></div><button type="button" aria-label="Скрыть предупреждение" onClick={() => setTimeWarning(null)}><X size={14}/></button></div>}<div className="test-header"><div className="test-user"><span className="avatar">{initials}</span><div><h2>{attempt.fullName}</h2><p>{modeLabels[attempt.mode]} режим · Индивидуальное тестирование</p></div></div><div className={`timer ${remaining !== null && remaining < 60 ? "urgent" : ""}`}><Clock3 size={17}/>{remaining !== null ? `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}` : "Без ограничения"}</div></div>
    <ErrorBox message={error}/><div className="test-layout"><section className="test-question-panel"><div className="progress-top"><span>Вопрос <strong>{safeIndex + 1}</strong> из {attempt.total}</span><span>{answered} ответов сохранено{saving > 0 ? " · идёт сохранение" : ""}</span></div><div className="progress-track" role="progressbar" aria-label="Прогресс тестирования" aria-valuenow={answered} aria-valuemin={0} aria-valuemax={attempt.total}><div className="progress-fill" style={{ width: `${answered / attempt.total * 100}%` }}/></div><div className="question-block-label"><Layers3 size={13}/>{getBlockTitle(question.blockId)} · № {question.number}</div><h1>{question.text}</h1><p className="question-instruction" id="answer-instruction">Выберите один правильный ответ</p><div className="answer-list" role="radiogroup" aria-labelledby="answer-instruction">{question.answers.map((answer, i) => <label className={`answer-choice ${attempt.responses[question.id] === answer.id ? "chosen" : ""}`} key={answer.id}><input type="radio" name={`answer-${question.id}`} checked={attempt.responses[question.id] === answer.id} onChange={() => selectAnswer(answer.id)} disabled={finishing}/><span><i className="answer-letter">{i + 1}.</i>{answer.text}</span></label>)}</div><div className="saved-status" role="status">{saving ? <><LoaderCircle size={12} className="spin"/>Сохраняем на сервере…</> : attempt.responses[question.id] ? <><CheckCircle2 size={12}/>Ответ сохранён на сервере</> : <span style={{ color: "#a1b0c5" }}>Вы сможете изменить ответ до завершения теста</span>}</div>{answerHint && <div className="answer-hint" role="alert">{answerHint}</div>}<div className="test-question-actions"><button className="button" onClick={() => goTo(index - 1)} disabled={index === 0 || finishing}><ArrowLeft size={15}/>Назад</button>{index < attempt.total - 1 ? <button className="button primary" onClick={() => { setAnswerHint(""); setIndex(index + 1); }} disabled={finishing || !attempt.responses[question.id]}>Далее<ArrowRight size={16}/></button> : answered < attempt.total ? <button className="button primary" onClick={() => { setAnswerHint(`Чтобы завершить тест, ответьте на все вопросы. Осталось: ${attempt.total - answered}.`); const next = attempt.questions.findIndex((q) => !attempt.responses[q.id]); if (next >= 0) setIndex(next); }} disabled={finishing}>Ответить на оставшиеся ({attempt.total - answered})<ArrowRight size={16}/></button> : <button className="button primary" onClick={() => { setAnswerHint(""); setConfirm(true); }} disabled={finishing}>Завершить тест<Check size={16}/></button>}</div></section>
    <aside className="test-sidebar"><div className="content-panel navigator-panel"><h3>Ваш билет</h3><p>Можно вернуться к любому вопросу</p><div className="question-navigator">{attempt.questions.map((q, n) => <button aria-label={`Вопрос ${n + 1}${attempt.responses[q.id] ? ", ответ сохранён" : ""}`} aria-current={n === index ? "step" : undefined} className={`question-nav-button ${attempt.responses[q.id] ? "answered" : ""} ${n === index ? "current" : ""}`} onClick={() => goTo(n)} disabled={finishing} key={q.id}>{n + 1}</button>)}</div><div className="navigator-legend"><span><i className="legend-dot answered"/>Ответ сохранён</span><span><i className="legend-dot"/>Ожидает ответа</span></div><p className="navigator-note">Завершение станет доступно, когда будут отмечены все вопросы.</p></div><Notice>Ответы хранятся на сервере. Обновление этой страницы не удалит прогресс.</Notice></aside></div>
    {confirm && <Modal title="Завершить тестирование?" onClose={() => { if (!finishing) setConfirm(false); }}><p className="modal-description">Вы ответили на все вопросы билета. После завершения вы увидите результат и подробный разбор ошибок.</p><Notice>После завершения изменить ответы уже нельзя.</Notice><div className="modal-actions"><button className="button" onClick={() => setConfirm(false)} disabled={finishing}>Продолжить тест</button><button className="button primary" onClick={finish} disabled={finishing}>{finishing && <LoaderCircle className="spin" size={14}/>}Завершить</button></div></Modal>}
    {timeoutNotice && <Modal title="Время вышло" onClose={() => void finish()}><p className="modal-description">Время на прохождение теста закончилось. Тест завершается автоматически — все ответы, которые вы успели сохранить, уже на сервере.</p><Notice>Сейчас откроется страница с результатом и разбором ошибок.</Notice><div className="modal-actions"><button className="button primary" onClick={() => void finish()} disabled={finishing}>{finishing && <LoaderCircle className="spin" size={14}/>}Смотреть результат</button></div></Modal>}
  </>;
}

export function TestResult({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, refresh } = useApi<AttemptData>(`tests/${id}`);
  const [all, setAll] = useState(false), [pdfBusy, setPdfBusy] = useState(false);
  useEffect(() => { if (data?.status === "active") router.replace(`/test?id=${id}`); }, [data, id, router]);
  if (error) return <ErrorBox message={error} onRetry={refresh}/>;
  if (!data || data.status !== "completed") return <Loading text="Формируем результат…"/>;
  // Время истекло: сервер закрывает попытку ровно по лимиту времени.
  const timedOut = data.timeLimit > 0 && !!data.finishedAt && Date.parse(data.finishedAt) - Date.parse(data.startedAt) >= data.timeLimit * 1000 - 3000;
  const mistakes = data.questions.filter((q) => !q.answers.some((a) => a.correct && a.id === data.responses[q.id]));
  const review = all ? data.questions : mistakes;
  return <>{timedOut && <Notice><strong>Время истекло — тест завершён автоматически.</strong> Ответы, которые вы успели сохранить, учтены в результате.</Notice>}<PageHeading title="Результат тестирования" description="Каждый пройденный тест — ещё один шаг к уверенной экспертизе." action={<Link href="/results" className="subtle-link"><ArrowLeft size={15}/>Мои результаты</Link>}/><section className="result-hero"><div className="result-ring" style={{ "--score": `${data.percentage}%` } as CSSProperties}><strong>{data.percentage}%</strong><span>ПРАВИЛЬНЫХ ОТВЕТОВ</span></div><div className="result-content"><span className="badge green"><CircleCheck size={12}/>Тест завершён</span><h2>{data.percentage >= 80 ? "Отличный результат!" : data.percentage >= 60 ? "Хорошая основа для роста" : "Продолжайте подготовку"}</h2><p>{data.fullName}</p><div className="result-summary"><span className="correct"><CheckCircle2 size={16}/>{data.correctCount} правильно</span><span className="incorrect"><XCircle size={16}/>{data.total - data.correctCount} неправильно</span></div><div className="result-meta">{data.examName && <span>{data.examName}</span>}<span>{formatDate(data.finishedAt || data.startedAt, true)}</span><span>{modeLabels[data.mode]} режим</span><span>{data.total} вопросов</span></div></div><div className="result-actions"><Link href={`/testing?mode=${data.mode}`} className="button primary"><RotateCcw size={15}/>Пройти ещё раз</Link><button type="button" className="button" disabled={pdfBusy} onClick={async () => { setPdfBusy(true); try { const { exportAttempt } = await import("@/lib/files"); await exportAttempt(data); } catch (e) { window.alert((e as Error).message); } finally { setPdfBusy(false); } }}>{pdfBusy ? <LoaderCircle size={15} className="spin"/> : <ArrowDownToLine size={15}/>}Скачать PDF</button></div></section>
    <div className="review-heading"><div><h2>{all ? "Разбор всех вопросов" : "Работа над ошибками"}</h2><p>Зелёным отмечен правильный ответ, красным — ваш неверный выбор.</p></div><button className="button small" onClick={() => setAll(!all)}>{all ? "Только ошибки" : "Все вопросы"}<ListChecks size={14}/></button></div>
    {!review.length ? <EmptyState icon={<Trophy size={34}/>} title="Ни одной ошибки!" text="Вы правильно ответили на все вопросы. Попробуйте другой блок или новый случайный билет." action={{ href: "/testing?mode=selective", label: "Новый билет" }}/> : review.map((q, index) => <article className="review-card" key={q.id}><div className="question-meta"><span>{getBlockTitle(q.blockId)}</span><span>·</span><span>Вопрос № {q.number}</span></div><h3>{index + 1}. {q.text}</h3>{q.answers.map((answer) => {
      const chosen = data.responses[q.id] === answer.id;
      return <div className={`review-answer ${answer.correct ? "correct" : chosen ? "wrong" : ""}`} key={answer.id}>{answer.correct ? <CheckCircle2 size={16}/> : chosen ? <XCircle size={16}/> : <span style={{ minWidth: 16 }}>{answer.number}.</span>}<div>{answer.text}{answer.correct && <span className="answer-label">Правильный ответ{chosen ? " · Ваш выбор" : ""}</span>}{chosen && !answer.correct && <span className="answer-label">Ваш ответ</span>}</div></div>;
    })}{!data.responses[q.id] && <p className="result-unanswered">Вы не ответили на этот вопрос.</p>}</article>)}
  </>;
}
