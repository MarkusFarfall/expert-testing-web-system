import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import { PwaRegister } from "@/components/pwa";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Экспертиза КТПП — тестирование экспертов", template: "%s | Экспертиза КТПП" },
  description: "Платформа профессиональной подготовки и проверки знаний экспертов Союза «Калининградская торгово-промышленная палата». Тестирование без регистрации, единая база вопросов и разбор ошибок.",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_BASE ?? "https://212.193.5.193/portal").origin;
  return <html lang="ru"><head><link rel="preconnect" href={apiOrigin} crossOrigin="anonymous"/><link rel="dns-prefetch" href={apiOrigin}/><link rel="manifest" href={`${basePath}/manifest.webmanifest`}/><meta name="theme-color" content="#2454a4"/><meta name="mobile-web-app-capable" content="yes"/><meta name="apple-mobile-web-app-capable" content="yes"/><meta name="apple-mobile-web-app-status-bar-style" content="default"/><meta name="apple-mobile-web-app-title" content="Экспертиза"/><link rel="apple-touch-icon" href={`${basePath}/icons/apple-touch-icon.png`}/><link rel="icon" href={`${basePath}/icon.svg`} type="image/svg+xml"/><style dangerouslySetInnerHTML={{ __html: `@font-face{font-family:Golos;src:url('${basePath}/fonts/Golos.ttf') format('truetype');font-style:normal;font-weight:100 900;font-display:swap}` }}/></head><body><Shell>{children}</Shell><PwaRegister/></body></html>;
}
