import { Suspense } from "react";
import { TestingSetup } from "@/components/testing";
import { getOverview } from "@/lib/store";
export const dynamic = "force-dynamic";
export const metadata = { title: "Начать тестирование" };
export default async function Page() { return <Suspense><TestingSetup overview={await getOverview()}/></Suspense>; }
