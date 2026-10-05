import translations from "./protocolDescriptions.ko.json";

// Match the complete source so an upstream rewrite never receives a stale translation.
export function koreanDescription(source: string | null | undefined): string | null {
  if (!source || !Object.hasOwn(translations, source)) return null;
  return (translations as Record<string, string>)[source];
}

// Display-only additions must not change replay hashes of existing publications.
export function koreanDetailDescription(source: string | null | undefined): string | null {
  if (source === "Gamified Bitcoin Mining on Solana") return "Solana에서 게임 요소를 접목한 비트코인 채굴 프로젝트입니다.";
  return koreanDescription(source);
}
