import { Suspense } from "react";
import { DocumentsPage } from "@/components/information";
export const dynamic = "force-dynamic";
export const metadata = { title: "Реестр документов" };
export default function Page() { return <Suspense><DocumentsPage/></Suspense>; }
