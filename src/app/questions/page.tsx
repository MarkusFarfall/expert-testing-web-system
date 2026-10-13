import { Suspense } from "react";
import { QuestionBank } from "@/components/information";
export const metadata = { title: "Банк вопросов" };
export default function Page() { return <Suspense><QuestionBank/></Suspense>; }
