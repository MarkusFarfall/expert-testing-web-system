"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowRight, LoaderCircle, X } from "lucide-react";
import Link from "next/link";

export class ApiError extends Error { constructor(message: string, public details?: string[]) { super(message); } }
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const { API_BASE, getAdminToken, getVisitorId, setAdminToken } = await import("@/lib/session");
  const token = getAdminToken();
  const headers: Record<string, string> = {
    ...(options?.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    "x-visitor-id": getVisitorId(),
    ...(token ? { "x-admin-token": token } : {}),
    ...(options?.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${API_BASE}/${path}`, { ...options, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (path === "admin/logout") setAdminToken(null);
  if (data && typeof data === "object" && typeof (data as { token?: string }).token === "string") setAdminToken((data as { token: string }).token);
  if (!response.ok) throw new ApiError(data.error || "Не удалось выполнить запрос.", data.details);
  return data as T;
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
  return { data, setData, error, refresh: () => setVersion((v) => v + 1) };
}
export function ErrorBox({ message, details }: { message: string; details?: string[] }) {
  if (!message) return null;
  return <div className="error-box" role="alert"><AlertCircle size={19}/><div><p>{message}</p>{details && <ul>{details.map((d, i) => <li key={i}>{d}</li>)}</ul>}</div></div>;
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
