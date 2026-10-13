"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowRight, LoaderCircle, RefreshCw, X } from "lucide-react";
import Link from "next/link";

export class ApiError extends Error { constructor(message: string, public details?: string[]) { super(message); } }
type ApiOptions = RequestInit & { timeoutMs?: number; retries?: number };

const NETWORK_MESSAGE = "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз — всё, что уже сохранено, не потеряется.";
const TIMEOUT_MESSAGE = "Сервер не ответил вовремя. Попробуйте ещё раз.";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isConnectionError = (error: unknown) => (error as Error)?.name === "TypeError";
const isTimeout = (error: unknown) => (error as Error)?.name === "TimeoutError";

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const outer = init.signal ?? undefined;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const relay = () => controller.abort();
  outer?.addEventListener("abort", relay, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) { const e = new Error(TIMEOUT_MESSAGE); e.name = "TimeoutError"; throw e; }
    if (outer?.aborted) { const e = new Error("Запрос отменён"); e.name = "AbortError"; throw e; }
    throw error;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", relay);
  }
}

/**
 * Запрос к API с повторами. Порядок попыток: основной адрес → резервный адрес,
 * на каждом — до 3 попыток. GET/PATCH/DELETE и «шлюзовые» ошибки повторяем свободно;
 * создающие POST при обрыве связи не повторяем вслепую (кроме случаев, когда запрос явно не дошёл).
 */
export async function api<T>(path: string, options?: ApiOptions): Promise<T> {
  const { API_BASE, API_FALLBACKS, getAdminToken, getVisitorId, setAdminToken } = await import("@/lib/session");
  const { timeoutMs = 20000, retries = 2, ...init } = options ?? {};
  const method = (init.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "PATCH" || method === "DELETE" || path.endsWith("/finish") || path === "admin/login" || path === "admin/logout";
  const hosts = [API_BASE, ...API_FALLBACKS];
  let lastError: unknown = null;
  for (const host of hosts) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(300 * attempt);
      try {
        const token = getAdminToken();
        const headers: Record<string, string> = {
          ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
          "x-visitor-id": getVisitorId(),
          ...(token ? { "x-admin-token": token } : {}),
          ...(init.headers as Record<string, string> | undefined),
        };
        const response = await fetchWithTimeout(`${host}/${path}`, { ...init, headers, cache: "no-store" }, timeoutMs);
        const data = await response.json().catch(() => ({}));
        if (path === "admin/logout") setAdminToken(null);
        if (data && typeof data === "object" && typeof (data as { token?: string }).token === "string") setAdminToken((data as { token: string }).token);
        if (!response.ok) {
          const failure = new ApiError(data.error || "Не удалось выполнить запрос.", data.details);
          // 5xx и «шлюзовые» ошибки у самого сервера — можно повторить; 4xx повторять бессмысленно.
          if (response.status >= 500 && response.status <= 504) { lastError = failure; continue; }
          throw failure;
        }
        return data as T;
      } catch (error) {
        if ((error as Error)?.name === "AbortError") throw error;   // страница закрывается — не наша забота
        if (error instanceof ApiError) throw error;                 // осмысленный ответ сервера (4xx)
        lastError = error;
        const retryable = isConnectionError(error) || (idempotent && isTimeout(error));
        if (!retryable) break;                                      // например, таймаут при создании теста
      }
    }
  }
  if (isConnectionError(lastError)) throw new ApiError(NETWORK_MESSAGE);
  if (isTimeout(lastError)) throw new ApiError(TIMEOUT_MESSAGE);
  throw lastError instanceof ApiError ? lastError : new ApiError((lastError as Error)?.message || "Не удалось выполнить запрос.");
}
export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    api<T>(path, { signal: controller.signal }).then(setData).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [path, version]);
  // Как только интернет вернулся — повторяем неудавшийся запрос сами.
  useEffect(() => {
    if (!error) return;
    const retry = () => setVersion((v) => v + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [error]);
  return { data, setData, error, refresh: () => setVersion((v) => v + 1) };
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
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = ref.current;
    const focusable = () => element?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex="0"]');
    focusable()?.[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") { const items = focusable(); if (!items?.length) return; const first = items[0], last = items[items.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    };
    document.addEventListener("keydown", handler);
    return () => { document.body.style.overflow = bodyOverflow; document.removeEventListener("keydown", handler); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={21}/></button></div>{children}</div></div>;
}
export function Notice({ children }: { children: ReactNode }) { return <div className="notice"><AlertCircle size={19}/><div>{children}</div></div>; }
