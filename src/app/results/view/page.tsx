"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TestResult } from "@/components/testing";
import { Loading } from "@/components/ui";
function Result() {
  const id = useSearchParams().get("id") ?? "";
  if (!id) return <Loading text="Результат не найден."/>;
  return <TestResult id={id}/>;
}
export default function Page() { return <Suspense fallback={<Loading text="Загружаем результат…"/>}><Result/></Suspense>; }
