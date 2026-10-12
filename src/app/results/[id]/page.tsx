import { TestResult } from "@/components/testing";
export const dynamic = "force-dynamic";
export const metadata = { title: "Результат тестирования" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <TestResult id={id}/>; }
