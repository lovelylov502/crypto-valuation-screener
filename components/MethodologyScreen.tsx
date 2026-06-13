export function MethodologyScreen() {
  const sections = [
    {
      title: "1. 가치포획이란?",
      body: "프로토콜이 돈을 벌거나 채택이 늘 때, 그 경제 가치가 토큰 보유자에게 수익·소각·바이백·스테이킹·필수 수요 중 어떤 경로로 연결되는지 보는 것입니다.",
    },
    {
      title: "2. 싸다 ≠ 산다",
      body: "P/S나 P/HR이 낮아 보여도 토큰이 그 가치를 받을 권리나 수요 구조가 없으면 저평가가 아니라 함정일 수 있습니다.",
    },
    {
      title: "3. P/HR은 중요하지만 충분하지 않다",
      body: "holder revenue는 가장 직접적인 데이터지만, 데이터 커버리지 한계와 일회성 수익 가능성이 있습니다. 그래서 지속성·귀속 방식·희석을 같이 봅니다.",
    },
    {
      title: "4. 모름은 점수가 아니라 질문이다",
      body: "앱은 모르는 것을 0~100점에 숨기지 않고 리서치 질문으로 남깁니다. 이 질문을 확인해야 투자 논지가 단단해집니다.",
    },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-muted)]">Methodology</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">이 앱을 어떻게 봐야 하나</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--color-muted)]">
          이 워크벤치는 매수/매도 추천기가 아니라, 태규가 리서치할 후보와 질문을 고르는 도구입니다.
        </p>
      </section>
      <section className="grid gap-3 md:grid-cols-2">
        {sections.map((section) => (
          <article key={section.title} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
            <h3 className="text-base font-semibold">{section.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">{section.body}</p>
          </article>
        ))}
      </section>
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
        <h3 className="text-base font-semibold">사용 순서</h3>
        <ol className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--color-muted)]">
          <li>1. `의사결정`에서 검토 우선 후보와 함정 후보를 본다.</li>
          <li>2. 후보를 열어 근거·리스크·모르는 것·다음 질문을 확인한다.</li>
          <li>3. `가치포획 맵`에서 싸냐/포획되냐를 분리해 본다.</li>
          <li>4. 필요할 때만 `원자료`에서 멀티플과 섹터 데이터를 직접 확인한다.</li>
        </ol>
      </section>
    </div>
  );
}
