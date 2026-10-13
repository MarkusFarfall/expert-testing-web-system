"use client";
import { Admin } from "@/components/admin";
import { ErrorBox, Loading, useApi } from "@/components/ui";
import type { Overview } from "@/lib/types";
export default function Page() {
  const { data, error } = useApi<Overview>("overview");
  if (error) return <ErrorBox message={error}/>;
  if (!data) return <Loading text="Проверяем доступ…"/>;
  return <Admin overview={data}/>;
}
