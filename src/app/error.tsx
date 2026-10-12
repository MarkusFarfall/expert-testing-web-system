"use client";
import Link from "next/link";
import { RefreshCw, ShieldAlert } from "lucide-react";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="empty-state" role="alert"><span className="empty-icon"><ShieldAlert size={34}/></span><h3>Не удалось загрузить страницу</h3><p>Произошла временная ошибка. Уже сохранённые на сервере ответы не потеряны. Попробуйте загрузить страницу ещё раз.</p><div className="flex flex-wrap justify-center gap-3"><button className="button primary" onClick={reset}><RefreshCw size={16}/>Попробовать снова</button><Link className="button" href="/">На главную</Link></div></section>;
}
