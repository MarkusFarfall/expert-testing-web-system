import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Экспертиза КТПП — тестирование экспертов", template: "%s | Экспертиза КТПП" },
  description: "Платформа профессиональной подготовки и проверки знаний экспертов Калининградской торгово-промышленной палаты. Тестирование без регистрации, единая база вопросов и разбор ошибок.",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return <html lang="ru"><head><style dangerouslySetInnerHTML={{ __html: `@font-face{font-family:Golos;src:url('${basePath}/fonts/Golos.ttf') format('truetype');font-style:normal;font-weight:100 900;font-display:swap}` }}/></head><body><Shell>{children}</Shell></body></html>;
}
