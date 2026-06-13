# 토큰 가치포획 워크벤치

프로토콜이 돈을 벌 때 그 가치가 **토큰 가격으로 실제 연결되는지**를 판단하기 위한 투자 리서치 워크벤치.
기존 밸류에이션 스크리너는 원자료 탐색 엔진으로 유지하되, 제품의 중심은 “싸냐?”가 아니라 **무엇을 리서치해야 하는가 / 왜 봐야 하는가 / 무엇이 아직 모르는가**로 이동한다.

**🌐 라이브: https://crypto-valuation-screener.vercel.app**
데이터: [DefiLlama](https://defillama.com) · [CoinGecko](https://coingecko.com) (무료 API, 키 불필요)

## 제품 방향

- **의사결정 보드** — 검토 우선 후보, 함정 후보, 고희석 후보, 데이터 부족 후보를 한눈에 본다.
- **가치포획 판단** — holder revenue, P/HR, 매출 대비 귀속 비중, 희석, unknown을 분리한다.
- **리서치 질문** — 모르는 것을 점수 안에 숨기지 않고 다음 확인 질문으로 보여준다.
- **원자료 탐색** — 기존 밸류 스크리너는 raw metrics 확인용으로 남긴다.

- 제품 브리프: [`docs/PRODUCT_BRIEF.md`](./docs/PRODUCT_BRIEF.md)
- UX 재설계 스펙: [`docs/UX_REDESIGN_SPEC.md`](./docs/UX_REDESIGN_SPEC.md)
- 밸류 방법론: [`docs/METHODOLOGY.md`](./docs/METHODOLOGY.md)

## 핵심 지표

- **P/HR** (시총÷홀더귀속수익) — 크립토 PER, 점수 최고 가중. 토큰 홀더에게 실제 귀속되는 수익 대비 시총
- **가치포획 점수** — holder revenue 존재, 매출 대비 귀속 비중, P/HR 상대 매력, 희석 리스크를 별도 평가
- **P/S · P/F · Mcap/TVL** — 매출·수수료·자본효율 멀티플
- 같은 섹터 내 백분위로 정규화 → 종합 점수 (P/HR 40% · P/S 25% · Mcap/TVL 20% · P/F 15%, 성장·희석은 각 ±5점 보정)
- 활동성($100K)·규모($1M) 게이트로 좀비·마이크로캡 노이즈 제거

→ 자세한 방법론: [`docs/METHODOLOGY.md`](./docs/METHODOLOGY.md)

## 스택

- Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Vitest
- 서버에서 DefiLlama 4종 + CoinGecko를 **parent 프로토콜 단위로 집계·조인** 후 점수화, 페이지 ISR 30분 캐시
- → 기술 구조: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)

## 개발

```bash
npm install
# 사내/로컬 CA 환경에서 fetch SSL 오류 시 (PowerShell)
$env:NODE_OPTIONS="--use-system-ca"
npm run dev        # http://localhost:3000
npm test           # 엔진 단위 테스트
npm run build      # 프로덕션 빌드
```

작업 지침은 [`CLAUDE.md`](./CLAUDE.md), 작업 이력은 [`docs/WORKLOG.md`](./docs/WORKLOG.md) 참고.

## ⚠️ 면책

투자 조언이 아닙니다. 본 점수는 온체인 펀더멘털 기반의 상대적 참고 지표이며, 토큰 이코노믹스·베스팅·내러티브·리스크를 반영하지 않습니다. CEX·체인·브릿지처럼 TVL이 가치와 직결되지 않는 섹터는 Mcap/TVL 신호를 신뢰하지 마세요.
