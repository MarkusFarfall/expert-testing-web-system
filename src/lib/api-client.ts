// Pure transport: no React, storage or production URLs. Dependencies are injectable in tests.
export class ApiError extends Error {
  constructor(message: string, public details?: string[], public status?: number, public uncertain = false) { super(message); this.name = "ApiError"; }
}
export type ApiOptions = RequestInit & { timeoutMs?: number; retries?: number };
export type ApiDependencies = {
  hosts: string[];
  getAdminToken: () => string | null;
  getVisitorId: () => string;
  setAdminToken: (token: string | null) => void;
  fetch?: typeof fetch;
};
const networkMessage = "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз — сохранённые ответы не потеряются.";
const uncertainMessage = "Не удалось подтвердить операцию. Возможно, сервер уже выполнил её. Обновите список и проверьте результат перед повторной отправкой.";
const abortError = () => new DOMException("Запрос отменён", "AbortError");
function delay(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const cancel = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", cancel); resolve(); }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
// Only reads and operations known to be idempotent in this API are retried.
export function canRetry(path: string, method: string) {
  return method === "GET" || method === "HEAD" ||
    (method === "PATCH" && /^tests\/[\da-f-]{36}$/i.test(path)) ||
    (method === "POST" && /^tests\/[\da-f-]{36}\/finish$/i.test(path));
}
export async function requestJson<T>(path: string, options: ApiOptions = {}, deps: ApiDependencies): Promise<T> {
  const { timeoutMs = 20000, retries = 2, ...init } = options;
  const method = (init.method ?? "GET").toUpperCase();
  const safe = canRetry(path, method);
  const hosts = [...new Set(deps.hosts)].slice(0, safe ? undefined : 1);
  if (!hosts.length) throw new ApiError("Не задан адрес сервера.");
  const maxRetries = safe ? Math.max(0, Math.min(5, retries)) : 0;
  const fetcher = deps.fetch ?? fetch;
  let lastError: unknown;
  for (const host of hosts) for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (init.signal?.aborted) throw abortError();
    if (attempt) await delay(300 * attempt, init.signal);
    const controller = new AbortController();
    let timedOut = false;
    const relay = () => controller.abort();
    init.signal?.addEventListener("abort", relay, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const headers = new Headers(init.headers);
      if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      headers.set("x-visitor-id", deps.getVisitorId());
      const token = deps.getAdminToken();
      if (token) headers.set("x-admin-token", token);
      const response = await fetcher(`${host}/${path}`, { ...init, method, headers, signal: controller.signal, cache: "no-store" });
      let data: Record<string, unknown>;
      try {
        data = await response.json();
      } catch {
        if (safe && response.status >= 500 && response.status <= 504) { lastError = new ApiError("Сервер временно недоступен.", undefined, response.status); continue; }
        throw new ApiError(safe ? "Сервер вернул некорректный ответ. Попробуйте ещё раз." : uncertainMessage, undefined, response.status, !safe);
      }
      if (!response.ok) {
        const details = Array.isArray(data?.details) ? data.details.filter((x): x is string => typeof x === "string") : undefined;
        const failure = new ApiError(typeof data?.error === "string" ? data.error : "Не удалось выполнить запрос.", details, response.status);
        if (response.status >= 500 && response.status <= 504) {
          if (!safe) throw new ApiError(uncertainMessage, details, response.status, true);
          lastError = failure; continue;
        }
        throw failure;
      }
      // Never accept a token from a failed login or an unrelated endpoint.
      if (path === "admin/login" && typeof data?.token === "string") deps.setAdminToken(data.token);
      if (path === "admin/logout") deps.setAdminToken(null);
      return data as T;
    } catch (error) {
      if (init.signal?.aborted) throw abortError();
      if (error instanceof ApiError) throw error;
      if (!safe) throw new ApiError(uncertainMessage, undefined, undefined, true);
      if (!timedOut && !["TypeError", "TimeoutError", "AbortError"].includes((error as Error)?.name)) throw error;
      lastError = new ApiError(timedOut || (error as Error)?.name === "TimeoutError" ? "Сервер не ответил вовремя. Попробуйте ещё раз." : networkMessage);
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", relay);
    }
  }
  throw lastError instanceof ApiError ? lastError : new ApiError(networkMessage);
}
