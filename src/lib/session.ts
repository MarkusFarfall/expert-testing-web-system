"use client";
// Адреса API. Основной — прямо по IP: не зависит от DNS (в России имена вида sslip.io
// могут не резолвиться). Запасной — то же самое по имени, на случай блокировки IP.
const PRIMARY = (process.env.NEXT_PUBLIC_API_BASE ?? "https://212.193.5.193/portal").replace(/\/$/, "");
const ALTERNATES = (process.env.NEXT_PUBLIC_API_FALLBACKS ?? "https://212-193-5-193.sslip.io/portal")
  .split(",").map((h) => h.trim().replace(/\/$/, "")).filter((h) => h && h !== PRIMARY);
export const API_BASE = PRIMARY;
export const API_FALLBACKS = ALTERNATES;
export const API_ORIGIN = new URL(PRIMARY).origin;

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const ADMIN_KEY = "ktpp_admin_token", VISITOR_KEY = "ktpp_visitor_id";

export function getAdminToken() { try { return localStorage.getItem(ADMIN_KEY); } catch { return null; } }
export function setAdminToken(token: string | null) { try { token ? localStorage.setItem(ADMIN_KEY, token) : localStorage.removeItem(ADMIN_KEY); } catch { /* приватный режим */ } }
export function getVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id || !/^[\da-f-]{36}$/i.test(id)) { id = crypto.randomUUID(); localStorage.setItem(VISITOR_KEY, id); }
    return id;
  } catch { return crypto.randomUUID(); }
}
