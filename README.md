# 크립토 밸류에이션 스크리너

가격이 아니라 **펀더멘털**(수수료·매출·**holder revenue**·예치자산)로 코인의 저평가/고평가를 가늠하는 웹 스크리너.
각 밸류에이션 멀티플을 **같은 섹터 안에서 백분위로 정규화**한 뒤 가중 평균해 **0~100 종합 점수**(높을수록 저평가)로 보여준다.

**🌐 라이브: https://crypto-valuation-screener.vercel.app**
데이터: [DefiLlama](https://defillama.com) · [CoinGecko](https://coingecko.com) (무료 API, 키 불필요)

## 핵심 지표

- **P/HR** (시총÷홀더귀속수익) — 크립토 PER, 점수 최고 가중. 토큰 홀더에게 실제 귀속되는 수익 대비 시총
- **P/S · P/F · Mcap/TVL** — 매출·수수료·자본효율 멀티플
- 같은 섹터 내 백분위로 정규화 → 종합 점수 (P/HR 28% · P/F 18% · P/S 18% · Mcap/TVL 16% · 성장 12% · 희석 8%)
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
