import { ScreenerClient } from "@/components/ScreenerClient";
import "./screener.css";

export default function Home() {
  // The shell renders even when upstream sources or the archive are unavailable.
  return <ScreenerClient initialData={null} />;
}
