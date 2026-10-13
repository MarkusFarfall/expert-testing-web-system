"use client";
import { Home } from "@/components/home";
import { ErrorBox, Loading, useApi } from "@/components/ui";
import type { Overview } from "@/lib/types";
export default function HomePage() {
  const { data, error } = useApi<Overview>("overview");
  if (error) return <ErrorBox message={error}/>;
  if (!data) return <Loading text="Загружаем данные платформы…"/>;
  return <Home overview={data}/>;
}
