import type { OnchainDashboard, OnchainMetric, OnchainMetricPoint } from "./types";

const BASE = "https://api.researchbitcoin.net/v2";
const TTL_RESEARCHBITCOIN = 3600; // 1시간

type MetricConfig = {
  key: OnchainMetric["key"];
  label: string;
  path: string;
};

type ResearchBitcoinPoint = {
  t?: unknown;
  time?: unknown;
  timestamp?: unknown;
  x?: unknown;
  v?: unknown;
  value?: unknown;
  y?: unknown;
  o?: unknown;
  [key: string]: unknown;
};

type ResearchBitcoinResponse =
  | ResearchBitcoinPoint[]
  | {
      data?: ResearchBitcoinPoint[];
      values?: ResearchBitcoinPoint[];
      result?: ResearchBitcoinPoint[];
    };

const METRICS: MetricConfig[] = [
  {
    key: "mvrv",
    label: "MVRV",
    path: "/market_value_to_realized_value/mvrv",
  },
  {
    key: "sopr",
    label: "SOPR",
    path: "/spent_output_profit_ratio/sopr",
  },
  {
    key: "realizedPrice",
    label: "Realized Price",
    path: "/realizedprice/realized_price",
  },
];

function emptyMetric(config: MetricConfig, status: OnchainMetric["status"]): OnchainMetric {
  return {
    key: config.key,
    label: config.label,
    value: null,
    previousValue: null,
    change7d: null,
    updatedAt: null,
    status,
    points: [],
  };
}

function token(): string | undefined {
  return process.env.RESEARCHBITCOIN_API_TOKEN ?? process.env.BITCOIN_LAB_API_TOKEN;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function time(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 10_000_000_000 ? v : v * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

function rows(data: ResearchBitcoinResponse): ResearchBitcoinPoint[] {
  if (Array.isArray(data)) return data;
  return data.data ?? data.values ?? data.result ?? [];
}

function normalize(data: ResearchBitcoinResponse): OnchainMetricPoint[] {
  return rows(data)
    .map((row) => {
      const directValue = num(row.v ?? row.value ?? row.y ?? row.o);
      const fallbackValue =
        directValue ??
        Object.entries(row)
          .filter(([key]) => !["t", "time", "timestamp", "x"].includes(key))
          .map(([, value]) => num(value))
          .find((value): value is number => value !== null) ??
        null;
      const timestamp = time(row.t ?? row.time ?? row.timestamp ?? row.x);
      const value = fallbackValue;
      return value !== null && timestamp !== null ? { time: timestamp, value } : null;
    })
    .filter((row): row is OnchainMetricPoint => row !== null)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

async function fetchMetric(config: MetricConfig, apiToken: string): Promise<OnchainMetric> {
  const url = `${BASE}${config.path}?resolution=d1&limit=30`;
  const res = await fetch(url, {
    next: { revalidate: TTL_RESEARCHBITCOIN },
    headers: {
      accept: "application/json",
      "X-API-Token": apiToken,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) return emptyMetric(config, "unavailable");

  const points = normalize((await res.json()) as ResearchBitcoinResponse);
  const latest = points.at(-1) ?? null;
  const previous = points.length >= 8 ? points.at(-8)! : null;
  const change7d =
    latest !== null && previous !== null && previous.value !== 0
      ? ((latest.value - previous.value) / previous.value) * 100
      : null;

  return {
    key: config.key,
    label: config.label,
    value: latest?.value ?? null,
    previousValue: previous?.value ?? null,
    change7d,
    updatedAt: latest?.time ?? null,
    status: latest === null ? "unavailable" : "ok",
    points,
  };
}

export async function fetchOnchainDashboard(): Promise<OnchainDashboard> {
  const apiToken = token();
  if (!apiToken) {
    return {
      source: "ResearchBitcoin",
      status: "missing-token",
      metrics: METRICS.map((config) => emptyMetric(config, "missing-token")),
    };
  }

  const metrics = await Promise.all(
    METRICS.map(async (config) => {
      try {
        return await fetchMetric(config, apiToken);
      } catch {
        return emptyMetric(config, "unavailable");
      }
    }),
  );

  return {
    source: "ResearchBitcoin",
    status: metrics.some((metric) => metric.status === "ok") ? "ok" : "unavailable",
    metrics,
  };
}
