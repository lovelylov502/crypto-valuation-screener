import { getScreener } from "@/lib/serverScreener";
import { ScreenerClient } from "@/components/ScreenerClient";

export const revalidate = 1800;
export const maxDuration = 60;

export default async function Home() {
  // The client can recover from initial collection failure and retain filters on refresh.
  const data = await getScreener().catch(() => null);
  return <ScreenerClient initialData={data} />;
}
