import { getScreener } from "@/lib/serverScreener";
import { ScreenerClient } from "@/components/ScreenerClient";
import { queryScreener } from "@/lib/screenerQuery";
import "./screener.css";

// The joined snapshot owns freshness; do not stack a second 30-minute HTML cache.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Home() {
  // The client can recover from initial collection failure and retain filters on refresh.
  const data = await getScreener().then(data => queryScreener(data)).catch(() => null);
  return <ScreenerClient initialData={data} />;
}
