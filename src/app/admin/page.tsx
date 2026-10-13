"use client";
import { Admin } from "@/components/admin";
import { Loading, useApi } from "@/components/ui";
import type { Overview } from "@/lib/types";
const emptyOverview: Overview = { questionCount: 0, blockCount: 0, completedCount: 0, exams: [], blocks: [], updatedAt: new Date().toISOString(), isDemo: false };
export default function Page() {
  const { data } = useApi<Overview>("overview");
  if (!data) return <Loading text="Проверяем доступ…"/>;
  return <Admin overview={data ?? emptyOverview}/>;
}
