# 크립토 밸류에이션 리서치

현금흐름은 개선되지만 가격에는 아직 충분히 반영되지 않은 **재발견 전 후보**를 찾는 단일 화면 스크리너.
주식·일반 기업 리서치, 조사노트, 후보 큐 같은 별도 워크플로는 다루지 않는다.

**🌐 라이브: https://crypto-valuation-screener.vercel.app**
데이터: [DefiLlama](https://defillama.com) · [CoinMarketCap Keyless](https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api) · [CoinGecko](https://coingecko.com)

## Current v4

- Independent views for business improvement, current holder flows and observed zero/positive transitions. Signals can overlap and remain visible despite a low experimental score.
- Same 30-day basis for P/HR, P/S, P/F and holder amount ratios; zero and missing component history remain distinct.
- Automatic and manual refresh, visible source status, bounded ISR retry, and last-good-table retention on failure.
- A compact responsive table, searchable filters, persistent favorites and column choices, and an accessible coin detail panel for conditions and calculation evidence.
- Previous-view comparisons and up to 60 days of browser observations, with JSON export.
- Twice-daily GitHub observation artifacts and website cache warming, active once merged into the default branch. No new paid data service.

The current rule version is `research-v4-same-window`. Scores are experimental and holder-centric; they are not the eligibility rule for the independent signal views. Field completeness is not a return probability. Conditional ve/voter flows remain outside general P/HR but can be discovered separately.

Read [the current v4 product, accounting, UX and operational contract](./docs/SCREENER_V4.md). The older brief and UX/methodology sections preserve the v3 baseline. Production safety is in [DEPLOYMENT.md](./docs/DEPLOYMENT.md).

## 개발

```bash
npm install
# 사내/로컬 CA 환경에서 fetch SSL 오류 시 (PowerShell)
$env:NODE_OPTIONS="--use-system-ca"
npm run dev
npm test
npx tsc --noEmit
npm run build
```

## 프로덕션 배포

프로덕션 소스는 `C:\Users\TAE\Workspace\projects\hermes\crypto-valuation-screener` 하나다. `C:\Users\TAE\Workspace\projects\taegyu\holder revenue`는 폐기된 중복 체크아웃이므로 Vercel 연결과 배포를 금지한다.

승인된 로컬 환경에서 `VERCEL_TOKEN`을 불러온 뒤 canonical 루트에서 다음 명령만 사용한다.

```powershell
npm run deploy:production
```

이 명령은 canonical 실경로·Git fetch/push 원격·로컬 Vercel 연결, clean `main`과 `origin/main` 일치, 인증된 원격 project/team을 먼저 검사하고 테스트·타입 검사·프로덕션 빌드를 통과한 뒤 배포한다. 마지막에는 canonical `/`와 `/api/screener`를 다시 읽어 고급 UI와 API 계약을 확인한다. 전체 정책과 배포 없는 점검 명령은 [프로덕션 배포 안전 규칙](./docs/DEPLOYMENT.md)에 있다.

## 면책

투자 조언이 아니다. 점수는 온체인 펀더멘털 기반의 상대가치 참고값이며, 토큰 이코노믹스·베스팅·법적 권리·내러티브·시장 수급은 별도 검증해야 한다.
