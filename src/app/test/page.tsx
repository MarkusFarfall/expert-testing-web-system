"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TestRunner } from "@/components/testing";
import { Loading } from "@/components/ui";
function Runner() {
  const id = useSearchParams().get("id") ?? "";
  if (!id) return <Loading text="Тест не найден."/>;
  return <TestRunner id={id}/>;
}
export default function Page() { return <Suspense fallback={<Loading text="Загружаем тест…"/>}><Runner/></Suspense>; }
