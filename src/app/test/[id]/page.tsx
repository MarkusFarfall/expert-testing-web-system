import { TestRunner } from "@/components/testing";
export const dynamic = "force-dynamic";
export const metadata = { title: "Тестирование" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <TestRunner id={id}/>; }
