import { Home } from "@/components/home";
import { getOverview } from "@/lib/store";
export const dynamic = "force-dynamic";
export default async function HomePage() { return <Home overview={await getOverview()}/>; }
