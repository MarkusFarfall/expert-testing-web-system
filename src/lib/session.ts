"use client";
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "https://ijbixganpfkrmqyaykjf.supabase.co/functions/v1/portal").replace(/\/$/, "");
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
