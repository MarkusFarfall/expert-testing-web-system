import { Admin } from "@/components/admin";
import { getOverview } from "@/lib/store";
export const dynamic = "force-dynamic";
export const metadata = { title: "Администрирование" };
export default async function Page() { return <Admin overview={await getOverview()}/>; }
