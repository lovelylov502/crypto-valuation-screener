import translations from "./protocolDescriptions.ko.json";

// Match the complete source so an upstream rewrite never receives a stale translation.
export function koreanDescription(source: string | null | undefined): string | null {
  if (!source || !Object.hasOwn(translations, source)) return null;
  return (translations as Record<string, string>)[source];
}
