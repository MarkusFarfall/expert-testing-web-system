"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TestResult } from "@/components/testing";
import { Loading, EmptyState } from "@/components/ui";
function Result() {
  const id = useSearchParams().get("id") ?? "";
  if (!id) return <EmptyState icon={null} title="Результат не найден" text="В ссылке нет идентификатора. Откройте историю или начните новый тест." action={{ href: "/results", label: "Мои результаты" }}/>;
  return <TestResult id={id}/>;
}
export default function Page() { return <Suspense fallback={<Loading text="Загружаем результат…"/>}><Result/></Suspense>; }
