import { clampRangePosition } from "@/lib/screenerFilters";

// 로그 슬라이더(0~100) <-> USD 양방향. 0이면 필터 없음, 100이면 $100B
function sliderToUsd(s: number): number {
  if (s <= 0) return 0;
  return Math.pow(10, 6 + (s / 100) * 5); // 1e6 ~ 1e11
}
function usdToSlider(usd: number): number {
  if (usd <= 0) return 0;
  return Math.max(0, Math.min(100, ((Math.log10(usd) - 6) / 5) * 100));
}

// P/HR 같은 멀티플용 로그 슬라이더. 0이면 필터 없음, 100이면 1000x
function sliderToMultiple(s: number): number {
  if (s <= 0) return 0;
  return Math.pow(10, -1 + (s / 100) * 4); // 0.1x ~ 1000x
}
function multipleToSlider(v: number): number {
  if (v <= 0) return 0;
  return Math.max(0, Math.min(100, ((Math.log10(v) + 1) / 4) * 100));
}

function DualRangeSlider({
  minPosition,
  maxPosition,
  onMinChange,
  onMaxChange,
  minLabel,
  maxLabel,
  step = 0.5,
}: {
  minPosition: number;
  maxPosition: number;
  onMinChange: (position: number) => void;
  onMaxChange: (position: number) => void;
  minLabel: string;
  maxLabel: string;
  step?: number;
}) {
  const changeMin = (next: number) =>
    onMinChange(clampRangePosition("min", next, minPosition, maxPosition));
  const changeMax = (next: number) =>
    onMaxChange(clampRangePosition("max", next, minPosition, maxPosition));

  return (
    <div className="relative mt-3 h-6">
      <div className="absolute left-0 right-0 top-2.5 h-1 rounded-full bg-[var(--color-border)]">
        <div
          className="absolute h-full rounded-full bg-[var(--color-accent)]"
          style={{ left: `${minPosition}%`, right: `${100 - maxPosition}%` }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={step}
        value={minPosition}
        onChange={(event) => changeMin(Number(event.target.value))}
        aria-label={minLabel}
        className="dual-range-input z-20"
      />
      <input
        type="range"
        min={0}
        max={100}
        step={step}
        value={maxPosition}
        onChange={(event) => changeMax(Number(event.target.value))}
        aria-label={maxLabel}
        className="dual-range-input z-30"
      />
    </div>
  );
}

export function UsdRangeFilter({
  label,
  minUsd,
  maxUsd,
  onMinChange,
  onMaxChange,
}: {
  label: string;
  minUsd: number;
  maxUsd: number;
  onMinChange: (usd: number) => void;
  onMaxChange: (usd: number) => void;
}) {
  const setMin = (usd: number) =>
    onMinChange(maxUsd > 0 ? Math.min(usd, maxUsd) : usd);
  const setMax = (usd: number) =>
    onMaxChange(usd > 0 ? Math.max(usd, minUsd) : 0);

  return (
    <div className="min-w-0">
      <div className="mb-2 text-xs text-[var(--color-muted)]">{label}</div>
      <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-muted)]">
        <label className="flex items-center gap-1">
          <span className="whitespace-nowrap">최소 $M</span>
          <input
            type="number"
            min={0}
            step={1}
            value={minUsd > 0 ? Math.round(minUsd / 1e6) : ""}
            aria-label={`${label} 최소 (백만 달러)`}
            onChange={(e) => {
              const m = parseFloat(e.target.value);
              setMin(Number.isFinite(m) && m > 0 ? m * 1e6 : 0);
            }}
            placeholder="0"
            className="min-w-0 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-2 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="whitespace-nowrap">최대 $M</span>
          <input
            type="number"
            min={0}
            step={1}
            value={maxUsd > 0 ? Math.round(maxUsd / 1e6) : ""}
            aria-label={`${label} 최대 (백만 달러)`}
            onChange={(e) => {
              const m = parseFloat(e.target.value);
              setMax(Number.isFinite(m) && m > 0 ? m * 1e6 : 0);
            }}
            placeholder="∞"
            className="min-w-0 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-2 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
      </div>
      <DualRangeSlider
        minPosition={usdToSlider(minUsd)}
        maxPosition={maxUsd > 0 ? usdToSlider(maxUsd) : 100}
        onMinChange={(position) => setMin(sliderToUsd(position))}
        onMaxChange={(position) =>
          setMax(position >= 100 ? 0 : sliderToUsd(position))
        }
        minLabel={`${label} 최소`}
        maxLabel={`${label} 최대`}
      />
    </div>
  );
}

export function MultipleRangeFilter({
  label,
  min,
  max,
  onMinChange,
  onMaxChange,
}: {
  label: string;
  min: number;
  max: number;
  onMinChange: (v: number) => void;
  onMaxChange: (v: number) => void;
}) {
  const setMin = (v: number) => onMinChange(max > 0 ? Math.min(v, max) : v);
  const setMax = (v: number) => onMaxChange(v > 0 ? Math.max(v, min) : 0);

  return (
    <div className="min-w-0">
      <div className="mb-2 text-xs text-[var(--color-muted)]">{label}</div>
      <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-muted)]">
        <label className="flex items-center gap-1">
          <span>최소</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={min > 0 ? Number(min.toFixed(1)) : ""}
            aria-label={`${label} 최소 배수`}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setMin(Number.isFinite(v) && v > 0 ? v : 0);
            }}
            placeholder="0"
            className="min-w-0 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-2 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
          <span>x</span>
        </label>
        <label className="flex items-center gap-1">
          <span>최대</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={max > 0 ? Number(max.toFixed(1)) : ""}
            aria-label={`${label} 최대 배수`}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setMax(Number.isFinite(v) && v > 0 ? v : 0);
            }}
            placeholder="∞"
            className="min-w-0 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-2 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
          <span>x</span>
        </label>
      </div>
      <DualRangeSlider
        minPosition={multipleToSlider(min)}
        maxPosition={max > 0 ? multipleToSlider(max) : 100}
        onMinChange={(position) => setMin(sliderToMultiple(position))}
        onMaxChange={(position) =>
          setMax(position >= 100 ? 0 : sliderToMultiple(position))
        }
        minLabel={`${label} 최소`}
        maxLabel={`${label} 최대`}
      />
    </div>
  );
}

export function ScoreRangeFilter({
  min,
  max,
  onMinChange,
  onMaxChange,
}: {
  min: number;
  max: number;
  onMinChange: (score: number) => void;
  onMaxChange: (score: number) => void;
}) {
  const maxPosition = max > 0 ? max : 100;
  const setMin = (score: number) =>
    onMinChange(Math.min(Math.max(score, 0), maxPosition));
  const setMax = (score: number) =>
    onMaxChange(score >= 100 ? 0 : Math.max(score, min));

  return (
    <div className="min-w-0">
      <div className="mb-2 text-xs text-[var(--color-muted)]">
        실험 점수 범위{" "}
        <span className="opacity-70">(게이트 통과 자산만 산출)</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-muted)]">
        <label className="flex items-center gap-1">
          <span>최소</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={min > 0 ? min : ""}
            aria-label="실험 점수 최소"
            onChange={(event) => {
              const score = Number(event.target.value);
              setMin(Number.isFinite(score) && score > 0 ? score : 0);
            }}
            placeholder="0"
            className="min-w-0 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-2 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <label className="flex items-center gap-1">
          <span>최대</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={max > 0 ? max : ""}
            aria-label="실험 점수 최대"
            onChange={(event) => {
              const score = Number(event.target.value);
              setMax(Number.isFinite(score) && score > 0 ? score : 0);
            }}
            placeholder="100"
            className="min-w-0 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-2 text-right text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
      </div>
      <DualRangeSlider
        minPosition={min}
        maxPosition={maxPosition}
        onMinChange={setMin}
        onMaxChange={setMax}
        minLabel="실험 점수 최소"
        maxLabel="실험 점수 최대"
        step={1}
      />
    </div>
  );
}
