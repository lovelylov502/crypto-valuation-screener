import translations from "./protocolDescriptions.detail.ko.json";
import { koreanDetailDescription as reviewedDescription } from "./protocolDescriptions";

// Keep display translations outside the collector and match the complete source text.
export function koreanDetailDescription(source: string | null | undefined): string | null {
  if (!source) return null;
  return reviewedDescription(source) ?? (Object.hasOwn(translations, source) ? (translations as Record<string, string>)[source] : null);
}
