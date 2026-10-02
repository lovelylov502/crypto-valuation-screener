import type { ScreenerResponse, SourceObservation } from "./types";

export interface PublishedSnapshot {
  id: string; url: string; sha256: string; dataAt: string; validatedAt: string; publishedAt: string;
  codeCommit: string; reportUrl: string; witnessUrl: string; witnessSha256: string;
}
export interface CollectionAttempt {
  id: string; startedAt: string; completedAt: string | null;
  outcome: "running" | "published" | "blocked";
  runUrl: string; reportUrl: string;
  errors: string[]; sourceFailures: SourceObservation[];
  collection?: ScreenerResponse["collection"];
  comparisonCompleted?: boolean;
  affectedProjects: number; changeCount: number;
  affected: { slug: string; name: string; issues: string[] }[];
}
export interface PublicationJournal {
  schema: 1; id: string; createdAt: string; trackingStartedAt: string; previousId: string | null; previousStateUrl: string | null;
  published: PublishedSnapshot | null; attempt: CollectionAttempt;
  incident: { firstFailureObservedAt: string; lastFailureObservedAt: string; lastGoodDataAt: string | null } | null;
  recoveredAt: string | null;
  storeError?: string;
}
