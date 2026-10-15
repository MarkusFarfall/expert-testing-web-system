"use client";
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

// Регистрация сервис-воркера + кнопка «Установить приложение».
export function PwaRegister() {
  const [prompt, setPrompt] = useState<Event | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    // 1) сервис-воркер (офлайн-режим, мгновенная загрузка)
    if ("serviceWorker" in navigator && window.isSecureContext) {
      const register = () => navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => undefined);
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
      // раз в час проверяем обновление сайта
      const timer = window.setInterval(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => undefined), 3600000);
      return () => { window.clearInterval(timer); window.removeEventListener("load", register); };
    }
    return undefined;
  }, []);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onInstalled = () => { setPrompt(null); setHidden(true); };
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (!prompt || hidden) return null;
  const install = async () => {
    const event = prompt as Event & { prompt?: () => Promise<void> };
    try { await event.prompt?.(); } catch { /* пользователь отменил */ }
    setPrompt(null);
  };
  return (
    <div className="pwa-install" role="dialog" aria-label="Установка приложения">
      <Download size={18}/>
      <span>Установить приложение на телефон?</span>
      <button className="button primary" onClick={install}>Установить</button>
      <button className="button" aria-label="Позже" onClick={() => setHidden(true)}><X size={15}/></button>
    </div>
  );
}
