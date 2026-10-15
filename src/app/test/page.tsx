"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TestRunner } from "@/components/testing";
import { Loading, EmptyState } from "@/components/ui";
function Runner() {
  const id = useSearchParams().get("id") ?? "";
  if (!id) return <EmptyState icon={null} title="Тест не найден" text="В ссылке нет идентификатора. Откройте историю или начните новый тест." action={{ href: "/results", label: "Мои результаты" }}/>;
  return <TestRunner id={id}/>;
}
export default function Page() { return <Suspense fallback={<Loading text="Загружаем тест…"/>}><Runner/></Suspense>; }
