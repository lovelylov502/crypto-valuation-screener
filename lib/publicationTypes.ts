import type { ScreenerResponse, SourceObservation } from "./types";

export interface PublishedSnapshot {
  id: string; url: string; sha256: string; dataAt: string; validatedAt: string; publishedAt: string;
  codeCommit: string; reportUrl: string; witnessUrl: string; witnessSha256: string;
  rawBundleUrl?: string; rawBundleSha256?: string; normalizedSha256?: string; replayVerified?: boolean;
  availabilityConfirmedAt?: string;
}
export type AttemptFailureClass = "transient" | "validation" | "unknown";
export interface CollectionSlotState {
  scheduledFor: string; attemptCount: number; manualRepairCount: number; lastAttemptId: string;
  successfulPublicationId: string | null; settled: boolean; nextRetryAt: string | null;
}
export interface CollectionAttempt {
  action?: { slotAt: string; stage: import("./freshnessRecovery").CollectionStage; receiptKey: string; natural: boolean };
  trigger?: import("./freshnessRecovery").CollectionTrigger;
  id: string; startedAt: string; completedAt: string | null;
  outcome: "running" | "published" | "blocked";
  runUrl: string; reportUrl: string;
  errors: string[]; sourceFailures: SourceObservation[];
  collection?: ScreenerResponse["collection"];
  comparisonCompleted?: boolean;
  scheduledFor?: string | null; manualRepair?: boolean; partial?: boolean; failureClass?: AttemptFailureClass;
  affectedProjects: number; changeCount: number;
  affected: { slug: string; name: string; issues: string[] }[];
}
export interface PublicationJournal {
  collectionRelease?: import("./pipelineRelease").CollectionRelease;
  schema: 1 | 2; id: string; createdAt: string; trackingStartedAt: string; previousId: string | null; previousStateUrl: string | null;
  recovery?: import("./freshnessRecovery").RecoveryState;
  compatibility?: { release: string; pipelineSchemas: number[]; journalSchemas: number[] };
  publicFreshness?: import("./datedFreshness").FreshnessSummary;
  publicRecovery?: import("./freshnessRecovery").RecoveryState;
  published: PublishedSnapshot | null; attempt: CollectionAttempt;
  incident: { firstFailureObservedAt: string; lastFailureObservedAt: string; lastGoodDataAt: string | null } | null;
  recoveredAt: string | null;
  schedule?: CollectionSlotState;
  storeError?: string;
}
