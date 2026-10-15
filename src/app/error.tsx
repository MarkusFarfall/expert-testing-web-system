"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, RotateCw, ShieldAlert } from "lucide-react";

// Сбой загрузки файла страницы (бывает, когда сайт обновился, а в браузере открыта
// старая версия): лечится обычной перезагрузкой — делаем её автоматически, один раз в минуту.
function isAssetError(error: unknown) {
  const text = `${(error as Error)?.name ?? ""} ${(error as Error)?.message ?? ""}`;
  return /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script|Failed to load script|Unexpected token '<'/i.test(text);
}

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reloading, setReloading] = useState(false);
  const stale = isAssetError(error);
  useEffect(() => {
    if (!stale) return;
    try {
      const key = "ktpp_autoreload";
      const last = Number(sessionStorage.getItem(key) ?? 0);
      if (Date.now() - last < 60000) return;   // не чаще раза в минуту, чтобы не зациклиться
      sessionStorage.setItem(key, String(Date.now()));
    } catch { return; }
    const timer = setTimeout(() => { setReloading(true); window.location.reload(); }, 500);
    return () => clearTimeout(timer);
  }, [stale]);
  return <section className="empty-state" role="alert"><span className="empty-icon"><ShieldAlert size={34}/></span><h3>{reloading ? "Обновляем страницу…" : "Не удалось загрузить страницу"}</h3><p>{reloading ? "Похоже, вышла новая версия сайта — сейчас всё поправим." : "Произошла временная ошибка сети. Уже сохранённые на сервере ответы не потеряны."}</p><div className="flex flex-wrap justify-center gap-3"><button className="button primary" onClick={() => (reloading ? window.location.reload() : reset())}><RefreshCw size={16}/>Попробовать снова</button><button className="button" onClick={() => window.location.reload()}><RotateCw size={16}/>Обновить страницу</button><Link className="button" href="/">На главную</Link></div></section>;
}
