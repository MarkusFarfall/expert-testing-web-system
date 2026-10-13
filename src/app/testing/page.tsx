"use client";
import { Suspense } from "react";
import { TestingSetup } from "@/components/testing";
import { ErrorBox, Loading, useApi } from "@/components/ui";
import type { Overview } from "@/lib/types";
function Setup() {
  const { data, error } = useApi<Overview>("overview");
  if (error) return <ErrorBox message={error}/>;
  if (!data) return <Loading text="Подготавливаем данные…"/>;
  return <TestingSetup overview={data}/>;
}
export default function Page() { return <Suspense fallback={<Loading text="Загружаем…"/>}><Setup/></Suspense>; }
