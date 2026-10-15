"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode, type SetStateAction } from "react";
import { AlertCircle, ArrowRight, LoaderCircle, RefreshCw, X } from "lucide-react";
import Link from "next/link";

import { requestJson, type ApiOptions } from "@/lib/api-client";
export { ApiError } from "@/lib/api-client";

export async function api<T>(path: string, options?: ApiOptions): Promise<T> {
  const { API_BASE, API_FALLBACKS, getAdminToken, getVisitorId, setAdminToken } = await import("@/lib/session");
  return requestJson<T>(path, options, { hosts: [API_BASE, ...API_FALLBACKS], getAdminToken, getVisitorId, setAdminToken });
}
export function useApi<T>(path: string) {
  const [version, setVersion] = useState(0);
  const key = `${path}::${version}`;
  const [state, setState] = useState<{ key: string; path: string; data: T | null; error: string }>({ key: "", path: "", data: null, error: "" });
  const current = state.key === key;
  const data = state.path === path ? state.data : null;
  const error = current ? state.error : "";
  useEffect(() => {
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) setState({ key, path, data: value, error: "" });
    }).catch((e) => {
      if (!controller.signal.aborted) setState({ key, path, data: null, error: e.message });
    });
    return () => controller.abort();
  }, [path, key]);
  const setData = useCallback((update: SetStateAction<T | null>) => {
    setState((previous) => ({ key, path, error: "", data: typeof update === "function"
      ? (update as (value: T | null) => T | null)(previous.path === path ? previous.data : null) : update }));
  }, [key, path]);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!error) return;
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, [error, refresh]);
  return { data, setData, error, refresh };
}
export function ErrorBox({ message, details, onRetry }: { message: string; details?: string[]; onRetry?: () => void }) {
  if (!message) return null;
  return <div className="error-box" role="alert"><AlertCircle size={19}/><div><p>{message}</p>{details && <ul>{details.map((d, i) => <li key={i}>{d}</li>)}</ul>}{onRetry && <button className="button" style={{ marginTop: 8 }} onClick={onRetry}><RefreshCw size={15}/>Повторить</button>}</div></div>;
}
export function Loading({ text = "Загружаем данные…" }: { text?: string }) {
  return <div className="loading-state" role="status"><LoaderCircle className="spin" size={24}/><span>{text}</span></div>;
}
export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: { href: string; label: string } }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{text}</p>{action && <Link className="button primary" href={action.href}>{action.label}<ArrowRight size={16}/></Link>}</div>;
}
export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1><p>{description}</p></div>{action}</div>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = ref.current;
    const focusable = () => element?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex="0"]');
    (focusable()?.[0] ?? element)?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") { const items = focusable(); if (!items?.length) return; const first = items[0], last = items[items.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    };
    document.addEventListener("keydown", handler);
    return () => { document.body.style.overflow = bodyOverflow; document.removeEventListener("keydown", handler); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={21}/></button></div>{children}</div></div>;
}
export function Notice({ children }: { children: ReactNode }) { return <div className="notice"><AlertCircle size={19}/><div>{children}</div></div>; }
