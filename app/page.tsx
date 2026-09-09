import { buildScreener } from "@/lib/screener";
import { ScreenerClient } from "@/components/ScreenerClient";

export const revalidate = 1800;

export default async function Home() {
  // The client can recover from initial collection failure and retain filters on refresh.
  const data = await buildScreener().catch(() => null);
  return <ScreenerClient initialData={data} />;
}
