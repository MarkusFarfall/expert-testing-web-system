"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, CircleCheck, Clock3, GraduationCap, Layers3, ListChecks, LoaderCircle, RotateCcw, ShieldCheck, Shuffle, SlidersHorizontal, Trophy, UserRound, X, XCircle } from "lucide-react";
import { api, EmptyState, ErrorBox, Loading, Modal, Notice, PageHeading, useApi } from "@/components/ui";
import { formatDate, getBlockTitle, modeLabels, type AttemptData, type Mode, type Overview } from "@/lib/types";

export function TestingSetup({ overview }: { overview: Overview }) {
  const search = useSearchParams(), router = useRouter();
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
      const result = await api<{ id: string }>("tests", { method: "POST", body: JSON.stringify({ fullName, mode, blockId, from, to, perBlock: Math.min(perBlock, maxPerBlock), timerMinutes: timer ? timerMinutes : 0 }) });
      router.push(`/test/${result.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <><PageHeading eyebrow="ВАШ СЛЕДУЮЩИЙ ШАГ" title="Начать тестирование" description="Представьтесь и выберите удобный формат. Регистрация и пароль не нужны."/><div className="setup-layout"><form className="form-panel" onSubmit={submit}>
    <h2 className="section-label"><span>1</span>Как к вам обращаться?</h2><div className="field"><label htmlFor="full-name">Фамилия, имя и отчество <span style={{ color: "#9baac0", fontWeight: 400 }}>(при наличии)</span></label><div className="input-with-icon"><UserRound size={17}/><input id="full-name" name="name" autoComplete="name" placeholder="Иванов Иван Иванович" value={fullName} onChange={(e) => setFullName(e.target.value)} minLength={5} maxLength={180} required autoFocus/></div><small>ФИО будет указано в вашем результате тестирования.</small></div>
    <div className="form-divider"/><h2 className="section-label"><span>2</span>Выберите режим</h2><div className="mode-choices" role="radiogroup" aria-label="Режим тестирования"><button type="button" role="radio" aria-checked={mode === "general"} className={`mode-choice ${mode === "general" ? "active" : ""}`} onClick={() => setMode("general")}><BookOpen size={24}/><span className="mode-radio"/><strong>Общий тест</strong><p>Последовательная подготовка<br/>по всем вопросам или теме</p></button><button type="button" role="radio" aria-checked={mode === "selective"} className={`mode-choice ${mode === "selective" ? "active" : ""}`} onClick={() => setMode("selective")}><Shuffle size={24}/><span className="mode-radio"/><strong>Выборочный тест</strong><p>Случайный билет с вопросами<br/>из каждого блока</p></button></div>
    {mode === "selective" && <div className="test-settings"><div className="field"><label htmlFor="per-block">Вопросов из каждого тематического блока</label><select id="per-block" value={Math.min(perBlock, maxPerBlock)} onChange={(e) => setPerBlock(Number(e.target.value))}>{Array.from({ length: Math.min(20, maxPerBlock) }, (_, n) => <option key={n + 1} value={n + 1}>{n + 1} из каждого блока · {(n + 1) * overview.blockCount} всего</option>)}</select><small>Для каждого билета вопросы выбираются заново и без повторений.</small></div></div>}
    <button className="settings-toggle" type="button" aria-expanded={advanced} aria-controls="advanced-settings" onClick={() => setAdvanced(!advanced)}><span className="flex items-center gap-2"><SlidersHorizontal size={15}/>Настроить параметры теста</span><ChevronDown size={16} style={{ transform: advanced ? "rotate(180deg)" : "" }}/></button>
    {advanced && <div id="advanced-settings">{mode === "general" && <><div className="field"><label htmlFor="block">Тематический блок</label><select id="block" value={blockId} onChange={(e) => setBlockId(e.target.value)}><option value="">Все тематические блоки</option>{overview.blocks.map((b) => <option value={b.id} key={b.id}>{b.id}. {b.title}</option>)}</select></div><div className="field-row"><div className="field"><label htmlFor="from-question">С вопроса №</label><input id="from-question" type="number" min="1" max="2147483647" placeholder="С первого" value={from} onChange={(e) => setFrom(e.target.value)}/></div><div className="field"><label htmlFor="to-question">По вопрос №</label><input id="to-question" type="number" min={from || 1} max="2147483647" placeholder="До последнего" value={to} onChange={(e) => setTo(e.target.value)}/></div></div><p className="field-hint" style={{ marginTop: -9, marginBottom: 18 }}>Диапазон применяется к порядковому номеру вопроса внутри каждого выбранного блока.</p></>}
      <div className="timer-setting"><Clock3 size={19} color="#8ca1bd"/><div><strong>Ограничить время</strong><small>По истечении времени тест завершится автоматически</small></div><button type="button" className={`switch ${timer ? "on" : ""}`} role="switch" aria-checked={timer} aria-label="Ограничить время теста" onClick={() => setTimer(!timer)}><span/></button></div>{timer && <div className="field"><label htmlFor="timer-minutes">Время на весь тест</label><select id="timer-minutes" value={timerMinutes} onChange={(e) => setTimerMinutes(Number(e.target.value))}><option value={15}>15 минут</option><option value={30}>30 минут</option><option value={60}>60 минут</option><option value={90}>90 минут</option></select></div>}
    </div>}
    <ErrorBox message={error}/>{!overview.questionCount && <Notice>Банк пока пуст. Администратор должен добавить вопросы.</Notice>}<div className="setup-footer"><span className="flex items-center gap-2"><ListChecks size={15}/>{from || to ? "Вопросы из выбранного диапазона" : `${selectedCount} вопросов`}{!timer && " · Без ограничения времени"}</span><button type="submit" className="button primary" disabled={busy || !overview.questionCount}>{busy ? <LoaderCircle size={16} className="spin"/> : <GraduationCap size={17}/>} {busy ? "Создаём тест…" : "Начать тест"}<ArrowRight size={16}/></button></div><p className="consent-note">При запуске ФИО и результаты сохраняются на сервере. <Link href="/documents?document=privacy">Как обрабатываются данные</Link></p>
    </form><aside className="setup-aside"><div className="content-panel"><span className="aside-icon"><ShieldCheck size={25}/></span><h3>Сосредоточьтесь на знаниях</h3><p>Мы позаботились о том, чтобы тестирование было простым и понятным.</p><ol><li><span>1</span><div><strong>Один вопрос — один ответ</strong><p>Выберите наиболее точный вариант из предложенных.</p></div></li><li><span>2</span><div><strong>Ваш прогресс сохранён</strong><p>Можно вернуться к вопросу и изменить ответ до завершения.</p></div></li><li><span>3</span><div><strong>Результат с объяснением</strong><p>Сразу увидите оценку и правильные ответы в разборе ошибок.</p></div></li></ol></div><Notice>{overview.isDemo ? "Сейчас доступен учебный банк. Его материалы предназначены для знакомства с платформой." : "Тест использует актуальную версию единого банка вопросов."}</Notice></aside></div></>;
}

export function TestRunner({ id }: { id: string }) {
  const router = useRouter();
  const { data: attempt, setData: setAttempt, error: loadError } = useApi<AttemptData>(`tests/${id}`);
  const [index, setIndex] = useState(0), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false), [finishing, setFinishing] = useState(false), [remaining, setRemaining] = useState<number | null>(null);
  const initialized = useRef(false), finishLock = useRef(false);
  const finish = useCallback(async () => {
    if (finishLock.current) return;
    finishLock.current = true; setFinishing(true); setError("");
    try { await api(`tests/${id}/finish`, { method: "POST" }); router.replace(`/results/${id}`); }
    catch (e) { setError((e as Error).message); finishLock.current = false; setFinishing(false); setConfirm(false); }
  }, [id, router]);
  useEffect(() => {
    if (!attempt) return;
    if (attempt.status === "completed") { router.replace(`/results/${id}`); return; }
    if (!initialized.current) { const first = attempt.questions.findIndex((q) => !attempt.responses[q.id]); setIndex(first >= 0 ? first : 0); initialized.current = true; }
  }, [attempt, id, router]);
  useEffect(() => {
    if (!attempt?.timeLimit || attempt.status !== "active") return;
    const deadline = Date.parse(attempt.startedAt) + attempt.timeLimit * 1000;
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick(); const interval = setInterval(tick, 1000); return () => clearInterval(interval);
  }, [attempt?.startedAt, attempt?.timeLimit, attempt?.status]);
  useEffect(() => { if (remaining === 0 && attempt?.status === "active") void finish(); }, [remaining, attempt?.status, finish]);
  async function selectAnswer(answerId: number) {
    if (!attempt || saving || finishing) return;
    const question = attempt.questions[index], previous = attempt;
    setSaving(true); setError(""); setAttempt({ ...attempt, responses: { ...attempt.responses, [question.id]: answerId } });
    try { setAttempt(await api<AttemptData>(`tests/${id}`, { method: "PATCH", body: JSON.stringify({ questionId: question.id, answerId }) })); }
    catch (e) { setError((e as Error).message); setAttempt(previous); }
    finally { setSaving(false); }
  }
  if (loadError) return <ErrorBox message={loadError}/>;
  if (!attempt || attempt.status === "completed") return <Loading text="Подготавливаем ваш тест…"/>;
  const question = attempt.questions[index], answered = Object.keys(attempt.responses).length;
  const initials = attempt.fullName.split(" ").slice(0, 2).map((p) => p[0]).join("");
  return <><div className="test-header"><div className="test-user"><span className="avatar">{initials}</span><div><h2>{attempt.fullName}</h2><p>{modeLabels[attempt.mode]} режим · Индивидуальное тестирование</p></div></div><div className={`timer ${remaining !== null && remaining < 60 ? "urgent" : ""}`}><Clock3 size={17}/>{remaining !== null ? `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}` : "Без ограничения"}</div></div>
    <ErrorBox message={error}/><div className="test-layout"><section className="test-question-panel"><div className="progress-top"><span>Вопрос <strong>{index + 1}</strong> из {attempt.total}</span><span>{answered} ответов сохранено</span></div><div className="progress-track" role="progressbar" aria-label="Прогресс тестирования" aria-valuenow={answered} aria-valuemin={0} aria-valuemax={attempt.total}><div className="progress-fill" style={{ width: `${answered / attempt.total * 100}%` }}/></div><div className="question-block-label"><Layers3 size={13}/>{getBlockTitle(question.blockId)} · № {question.number}</div><h1>{question.text}</h1><p className="question-instruction" id="answer-instruction">Выберите один правильный ответ</p><div className="answer-list" role="radiogroup" aria-labelledby="answer-instruction">{question.answers.map((answer, i) => <label className={`answer-choice ${attempt.responses[question.id] === answer.id ? "chosen" : ""}`} key={answer.id}><input type="radio" name={`answer-${question.id}`} checked={attempt.responses[question.id] === answer.id} onChange={() => selectAnswer(answer.id)} disabled={saving || finishing}/><span><i className="answer-letter">{i + 1}.</i>{answer.text}</span></label>)}</div><div className="saved-status" role="status">{saving ? <><LoaderCircle size={12} className="spin"/>Сохраняем ответ…</> : attempt.responses[question.id] ? <><CheckCircle2 size={12}/>Ответ сохранён на сервере</> : <span style={{ color: "#a1b0c5" }}>Вы сможете изменить ответ до завершения теста</span>}</div><div className="test-question-actions"><button className="button" onClick={() => setIndex(index - 1)} disabled={index === 0 || saving || finishing}><ArrowLeft size={15}/>Назад</button>{index < attempt.total - 1 ? <button className="button primary" onClick={() => setIndex(index + 1)} disabled={saving || finishing || !attempt.responses[question.id]}>Далее<ArrowRight size={16}/></button> : <button className="button primary" onClick={() => setConfirm(true)} disabled={saving || finishing}>Завершить тест<Check size={16}/></button>}</div></section>
    <aside className="test-sidebar"><div className="content-panel navigator-panel"><h3>Ваш билет</h3><p>Можно вернуться к любому вопросу</p><div className="question-navigator">{attempt.questions.map((q, n) => <button aria-label={`Вопрос ${n + 1}${attempt.responses[q.id] ? ", ответ сохранён" : ""}`} aria-current={n === index ? "step" : undefined} className={`question-nav-button ${attempt.responses[q.id] ? "answered" : ""} ${n === index ? "current" : ""}`} onClick={() => setIndex(n)} disabled={saving || finishing} key={q.id}>{n + 1}</button>)}</div><div className="navigator-legend"><span><i className="legend-dot answered"/>Ответ сохранён</span><span><i className="legend-dot"/>Ожидает ответа</span></div><button className="button full" onClick={() => setConfirm(true)} disabled={saving || finishing}>Завершить досрочно</button></div><Notice>Ответы хранятся на сервере. Обновление этой страницы не удалит прогресс.</Notice></aside></div>
    {confirm && <Modal title="Завершить тестирование?" onClose={() => { if (!finishing) setConfirm(false); }}><p className="modal-description">Вы ответили на {answered} из {attempt.total} вопросов. {answered < attempt.total ? `Без ответа осталось: ${attempt.total - answered}. Они будут учтены как неверные.` : "Все ответы сохранены. После завершения вы увидите результат и подробный разбор."}</p><Notice>После завершения изменить ответы уже нельзя.</Notice><div className="modal-actions"><button className="button" onClick={() => setConfirm(false)} disabled={finishing}>Продолжить тест</button><button className="button primary" onClick={finish} disabled={finishing}>{finishing && <LoaderCircle className="spin" size={14}/>}Завершить</button></div></Modal>}
  </>;
}

export function TestResult({ id }: { id: string }) {
  const router = useRouter();
  const { data, error } = useApi<AttemptData>(`tests/${id}`);
  const [all, setAll] = useState(false);
  useEffect(() => { if (data?.status === "active") router.replace(`/test/${id}`); }, [data, id, router]);
  if (error) return <ErrorBox message={error}/>;
  if (!data || data.status !== "completed") return <Loading text="Формируем результат…"/>;
  const mistakes = data.questions.filter((q) => !q.answers.some((a) => a.correct && a.id === data.responses[q.id]));
  const review = all ? data.questions : mistakes;
  return <><PageHeading title="Результат тестирования" description="Каждый пройденный тест — ещё один шаг к уверенной экспертизе." action={<Link href="/results" className="subtle-link"><ArrowLeft size={15}/>Мои результаты</Link>}/><section className="result-hero"><div className="result-ring" style={{ "--score": `${data.percentage}%` } as CSSProperties}><strong>{data.percentage}%</strong><span>ПРАВИЛЬНЫХ ОТВЕТОВ</span></div><div className="result-content"><span className="badge green"><CircleCheck size={12}/>Тест завершён</span><h2>{data.percentage >= 80 ? "Отличный результат!" : data.percentage >= 60 ? "Хорошая основа для роста" : "Продолжайте подготовку"}</h2><p>{data.fullName}</p><div className="result-summary"><span className="correct"><CheckCircle2 size={16}/>{data.correctCount} правильно</span><span className="incorrect"><XCircle size={16}/>{data.total - data.correctCount} неправильно</span></div><div className="result-meta"><span>{formatDate(data.finishedAt || data.startedAt, true)}</span><span>{modeLabels[data.mode]} режим</span><span>{data.total} вопросов</span></div></div><div className="result-actions"><Link href={`/testing?mode=${data.mode}`} className="button primary"><RotateCcw size={15}/>Пройти ещё раз</Link><a href={`/api/portal/tests/${data.id}/pdf`} download className="button"><ArrowDownToLine size={15}/>Скачать PDF</a></div></section>
    <div className="review-heading"><div><h2>{all ? "Разбор всех вопросов" : "Работа над ошибками"}</h2><p>Зелёным отмечен правильный ответ, красным — ваш неверный выбор.</p></div><button className="button small" onClick={() => setAll(!all)}>{all ? "Только ошибки" : "Все вопросы"}<ListChecks size={14}/></button></div>
    {!review.length ? <EmptyState icon={<Trophy size={34}/>} title="Ни одной ошибки!" text="Вы правильно ответили на все вопросы. Попробуйте другой блок или новый случайный билет." action={{ href: "/testing?mode=selective", label: "Новый билет" }}/> : review.map((q, index) => <article className="review-card" key={q.id}><div className="question-meta"><span>{getBlockTitle(q.blockId)}</span><span>·</span><span>Вопрос № {q.number}</span></div><h3>{index + 1}. {q.text}</h3>{q.answers.map((answer) => {
      const chosen = data.responses[q.id] === answer.id;
      return <div className={`review-answer ${answer.correct ? "correct" : chosen ? "wrong" : ""}`} key={answer.id}>{answer.correct ? <CheckCircle2 size={16}/> : chosen ? <XCircle size={16}/> : <span style={{ minWidth: 16 }}>{answer.number}.</span>}<div>{answer.text}{answer.correct && <span className="answer-label">Правильный ответ{chosen ? " · Ваш выбор" : ""}</span>}{chosen && !answer.correct && <span className="answer-label">Ваш ответ</span>}</div></div>;
    })}{!data.responses[q.id] && <p className="result-unanswered">Вы не ответили на этот вопрос.</p>}</article>)}
  </>;
}
