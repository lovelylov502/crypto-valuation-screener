# UX Redesign Spec — Token Value Capture Workbench

## 1. Design intent

The product should feel like a serious crypto research desk for token value capture, not a market dashboard.

Target feeling:

```text
calm analyst workbench + research memo system + enough data density for power use
```

Avoid:

- casino/trading aesthetics;
- table-first layout;
- huge numeric scores as the hero;
- overcolored badges;
- buy/sell framing;
- hiding uncertainty.

## 2. Navigation

Primary navigation:

```text
의사결정 | 후보 큐 | 가치포획 맵 | 원자료 | 방법론
```

Default route/screen: `의사결정`.

Navigation behavior:

- Desktop: left sidebar or top segmented nav.
- Mobile: top horizontal scroll nav.
- Current section should be obvious with a calm accent, not neon.

## 3. Screen: 의사결정

### Purpose

Answer: “오늘 무엇을 리서치해야 하고, 왜?”

### Layout

Desktop wireframe:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Header: Token Value Capture Workbench                               │
│ subtitle: 프로토콜 가치가 토큰으로 연결되는지 보는 투자 판단 보드       │
├─────────────────────────────────────────────────────────────────────┤
│ KPI strip: [검토 우선] [싸지만 포획 약함] [고희석] [데이터 부족]       │
├───────────────────────────────────────────┬─────────────────────────┤
│ Main: Research Priority Candidate Cards   │ Side: Today's Questions │
│ - Card                                   │ - question 1            │
│ - Card                                   │ - question 2            │
│ - Card                                   │ - question 3            │
├───────────────────────────────────────────┴─────────────────────────┤
│ Trap lanes: cheap but unclear / high dilution / narrative-only        │
└─────────────────────────────────────────────────────────────────────┘
```

Mobile wireframe:

```text
Header
KPI strip horizontal scroll
Research priority cards
Today's questions
Trap lanes
```

### KPI cards

Required cards:

1. 검토 우선
2. 싸지만 포획 약함
3. 고희석
4. 데이터 부족

Each card contains:

- count;
- short explanation;
- click filter behavior later.

### Candidate card anatomy

Each candidate card should contain:

```text
[Decision bucket chip]
Coin name / symbol / category
One-line thesis
Evidence chips (2~3)
Risk chips (0~3)
Core metrics: P/HR, holder revenue, FDV/Mcap or value score
Next question
Primary action: 자세히 보기
```

Example:

```text
검토 우선
Gains Network / GNS
holder revenue가 있고 P/HR이 섹터 대비 싸다.
근거: P/HR 2.7x · holder revenue $5.3M · value 95
리스크: revenue 지속성 확인 필요
다음 질문: 수익이 어떤 방식으로 GNS 홀더에게 귀속되는가?
```

### Trap lanes

Show compact horizontal groups:

- 싸지만 포획 약함
- 포획은 강하지만 비쌈
- 고희석 주의
- 데이터 부족

These lanes are essential because they make the app better than a screener table.

## 4. Screen: 후보 큐

### Purpose

Turn analysis into a research workflow.

### Columns / statuses

```text
New | Reviewing | Watch | Reject | Resolved
```

v0 can be computed-only / non-persistent. Later versions may persist user state.

### Card content

Smaller than decision board cards:

- coin;
- bucket;
- thesis;
- next question;
- updated time/source.

### Empty state

If no candidates in a column:

```text
아직 여기에 분류된 후보가 없습니다.
```

## 5. Screen: 가치포획 맵

### Purpose

Separate two dimensions:

```text
싸냐? vs 토큰이 가치를 포획하냐?
```

### v0 layout: 2x2 matrix

```text
                    포획 명확
            ┌─────────────────────┬─────────────────────┐
            │ 싸고 포획 명확       │ 비싸지만 포획 명확   │
싸다        │ Research priority    │ Watch/pullback       │ 비싸다
            ├─────────────────────┼─────────────────────┤
            │ 싸지만 포획 불명확   │ 비싸고 포획 불명확   │
            │ Trap / research gap  │ Low priority         │
            └─────────────────────┴─────────────────────┘
                    포획 불명확
```

Each quadrant:

- top 5 candidates;
- why they are there;
- empty state if none.

### Later v1

Scatter plot:

- x-axis: valuation attractiveness;
- y-axis: capture clarity;
- bubble size: market cap or holder revenue;
- color: bucket.

Do not build scatter before matrix proves useful.

## 6. Screen: 원자료

### Purpose

Preserve the existing valuation screener as a data explorer.

### Header copy

```text
원자료 탐색
점수와 멀티플을 직접 확인하는 화면입니다. 투자 판단은 의사결정 보드에서 시작하세요.
```

### Required filters

- decision bucket;
- capture route / clarity;
- has holder revenue;
- exclude high dilution;
- data missing only;
- category;
- market cap range;
- P/HR range.

### Existing functionality to preserve

- sorting;
- category filtering;
- mcap/tvl/P-HR ranges;
- external links;
- high dilution warning.

## 7. Screen: 방법론

### Purpose

Explain how to use the workbench in 2 minutes.

### Sections

1. 가치포획이란?
2. 싸다 vs 토큰에 꽂힌다
3. P/HR이 중요한 이유와 한계
4. holder revenue 없음의 의미
5. 모르는 것을 리서치 질문으로 바꾸는 방식
6. 앱 사용 순서

### Tone

Plain Korean. No academic wall of text.

## 8. Candidate detail drawer

### Trigger

Click `자세히 보기` on any candidate card or row.

### Drawer layout

```text
Header: coin, symbol, category, bucket
Thesis: one-line judgement
Tabs: 판단 | 숫자 | 리스크 | 리서치 질문
```

### 판단 tab

- capture route;
- evidence list;
- one-line conclusion.

### 숫자 tab

- P/HR;
- P/S;
- holder revenue;
- protocol revenue;
- fees;
- FDV/Mcap;
- market cap;
- TVL where relevant.

### 리스크 tab

- risk chips;
- severity;
- explanation.

### 리서치 질문 tab

- copy-friendly questions;
- optional later: send to wiki/Telegram.

### Behavior

- close button;
- Escape closes;
- overlay click closes;
- keep scroll independent from page.

## 9. Visual system

### Color roles

```text
Green: direct/clear value capture
Amber: indirect/needs verification
Red: structural risk/high dilution
Blue: research action/focus
Gray: unknown/data missing
```

### Typography

- Use system font or Inter.
- Korean body text must be readable at 14~15px minimum.
- Metrics can use tabular numbers.
- Avoid tiny text in core reasoning.

### Density

Default should be medium density.

- Home: spacious enough for reasoning.
- Raw explorer: high density allowed.

## 10. Loading, empty, and error states

### Loading

Use skeleton cards, not a blank table.

### Empty bucket

Show explanation:

```text
현재 조건에서 검토 우선 후보가 없습니다. 필터를 넓히거나 원자료를 확인하세요.
```

### API/data error

Show:

- data source affected;
- last successful update if available later;
- retry instruction.

## 11. Responsive behavior

### Desktop >= 1200px

- sidebar or top nav;
- two-column decision layout;
- drawer width 480~560px.

### Tablet

- top nav;
- candidate cards in 2 columns;
- drawer full-height overlay.

### Mobile

- one-column cards;
- metric chips wrap;
- raw table horizontally scrolls;
- drawer full-screen.

## 12. Interaction priorities

v0 interactions:

- switch nav screens;
- open/close candidate drawer;
- filter raw explorer by bucket/capture status;
- click candidate external link;
- copy research question if easy.

Do not build:

- drag/drop queue persistence;
- login;
- personalized saved notes;
- complex chart interactions;
- watchlist database.

## 13. Acceptance checklist

Before production deployment, verify:

- [ ] Default screen is not a table.
- [ ] Candidate cards include thesis/evidence/risk/question.
- [ ] Trap categories are visible.
- [ ] Raw table remains accessible.
- [ ] Drawer works with keyboard close.
- [ ] Mobile layout is usable.
- [ ] Console errors are zero.
- [ ] `npm test`, `npx tsc --noEmit`, and `npm run build` pass.
