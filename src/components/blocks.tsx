"use client";
import { useEffect, useState } from "react";
import { Check, Info, LoaderCircle, Tags } from "lucide-react";
import { api, ErrorBox, Loading, Notice, PageHeading, useApi } from "@/components/ui";
import type { BlockData, ExamData } from "@/lib/types";

/**
 * Названия тематических блоков — свои у каждого теста.
 * Пустое название означает «Тематический блок № N» — так блоки называются,
 * пока администратор не задаст тему.
 */
export function BlocksManager() {
  const { data: examList } = useApi<ExamData[]>("admin/exams");
  const [examId, setExamId] = useState("");
  const [rows, setRows] = useState<BlockData[] | null>(null);
  const [draft, setDraft] = useState<Record<number, { title: string; description: string }>>({});
  const [loadError, setLoadError] = useState(""), [saveError, setSaveError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [version, setVersion] = useState(0);

  useEffect(() => {
    if (!examId && examList?.length) setExamId(String((examList.find((x) => x.questionCount > 0) ?? examList[0]).id));
  }, [examList, examId]);

  useEffect(() => { setNotice(""); setSaveError(""); setDraft({}); }, [examId]);

  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    setLoadError(""); setRows(null);
    api<BlockData[]>(`admin/blocks?examId=${examId}`)
      .then((list) => { if (!cancelled) { setRows(list); setDraft(Object.fromEntries(list.map((b) => [b.id, { title: b.title, description: b.description }]))); } })
      .catch((e) => { if (!cancelled) setLoadError((e as Error).message); });
    return () => { cancelled = true; };
  }, [examId, version]);

  const currentExam = (examList ?? []).find((x) => String(x.id) === examId) ?? null;
  const dirty = !!rows?.some((b) => (draft[b.id]?.title ?? "") !== b.title || (draft[b.id]?.description ?? "") !== b.description);

  async function save() {
    if (!rows) return;
    setBusy(true); setSaveError(""); setNotice("");
    try {
      const blocks = rows.map((b) => ({ id: b.id, title: draft[b.id]?.title ?? "", description: draft[b.id]?.description ?? "" }));
      const updated = await api<BlockData[]>("admin/blocks", { method: "PUT", body: JSON.stringify({ examId: Number(examId), blocks }) });
      setRows(updated);
      setDraft(Object.fromEntries(updated.map((b) => [b.id, { title: b.title, description: b.description }])));
      setNotice(`Названия тем сохранены — ${updated.length} ${updated.length === 1 ? "блок" : updated.length < 5 ? "блока" : "блоков"}.`);
    } catch (e) { setSaveError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <PageHeading eyebrow="ТЕМАТИЧЕСКИЕ БЛОКИ" title="Названия тем" description="Каждый тест может называть свои тематические блоки по-своему. Названия видны экспертам при тестировании, в банке вопросов, в результатах и в PDF." action={<button className="button primary" onClick={save} disabled={busy || !dirty || !rows?.length}>{busy ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>}Сохранить названия</button>}/>
    <Notice><span className="flex items-center gap-2"><Info size={15}/>Оставьте поле пустым — на экранах будет «Тематический блок № N». Изменения появятся сразу после сохранения.</span></Notice>
    <div className="filter-bar">
      <select aria-label="Тест" value={examId} onChange={(e) => setExamId(e.target.value)}>
        {(examList ?? []).map((x) => <option value={x.id} key={x.id}>{x.name}{x.questionCount ? ` · ${x.questionCount} вопр.` : " · банк пуст"}</option>)}
      </select>
      {currentExam && <span className="filter-count">Блоков: {rows?.length ?? "—"} · вопр. {currentExam.questionCount}</span>}
    </div>
    {notice && <div className="success-box" role="status"><Check size={19}/>{notice}</div>}
    <ErrorBox message={saveError}/>
    {loadError ? <ErrorBox message={loadError} onRetry={() => setVersion((v) => v + 1)}/> : !rows ? <Loading text="Загружаем блоки…"/> : (
      !rows.length ? <div className="empty-state"><span className="aside-icon"><Tags size={26}/></span><h3>В этом тесте пока нет вопросов</h3><p>Темы появятся здесь после импорта банка — названия можно будет задать для каждого блока.</p></div> : (
        <div className="table-wrap"><table>
          <thead><tr><th style={{ width: 90 }}>Блок</th><th>Название темы</th><th>Короткое описание (подсказка)</th><th style={{ width: 110 }}>Вопросов</th></tr></thead>
          <tbody>
            {rows.map((b) => <tr key={b.id}>
              <td><span className="badge">№ {b.id}</span></td>
              <td><input aria-label={`Название темы блока ${b.id}`} placeholder={`Тематический блок № ${b.id}`} maxLength={180} value={draft[b.id]?.title ?? ""} onChange={(e) => setDraft({ ...draft, [b.id]: { title: e.target.value, description: draft[b.id]?.description ?? "" } })}/></td>
              <td><input aria-label={`Описание темы блока ${b.id}`} placeholder="Необязательно — короткая подсказка для эксперта" maxLength={500} value={draft[b.id]?.description ?? ""} onChange={(e) => setDraft({ ...draft, [b.id]: { title: draft[b.id]?.title ?? "", description: e.target.value } })}/></td>
              <td>{b.count}<span className="table-secondary">в банке теста</span></td>
            </tr>)}
          </tbody>
        </table></div>
      )
    )}
  </>;
}
