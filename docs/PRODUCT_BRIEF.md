# Token Value Capture Workbench — Product Brief

## 1. Product thesis

This project should no longer be framed as a generic crypto valuation screener.

It should become a **Token Value Capture Workbench**: a personal investment decision tool for deciding whether a protocol's economic value can plausibly accrue to its token, and what to research next.

## 2. User

Primary user: 태규.

Profile:

- Crypto investor with long market experience.
- Cares about hard linkage between protocol fundamentals and token price.
- Skeptical of vague institutional/RWA/regulation narratives unless the value path to the token is clear.
- Wants clear Korean reasoning, not just a table of numbers.

## 3. User job

When opening the app, 태규 wants to answer:

1. What is worth researching today?
2. Why is it worth researching?
3. Is the project actually capturing value into the token, or just generating protocol activity?
4. What looks cheap but may be a value-capture trap?
5. What exact question should I verify next?

## 4. Non-goals

This is not:

- a buy/sell recommendation tool;
- a trading terminal;
- a generic coin ranking site;
- a prettier version of DefiLlama;
- a table-first financial dashboard.

## 5. Product promise

> Show which tokens deserve research priority, why the value might accrue to the token, what the main risks are, what remains unknown, and the next question to verify.

## 6. Core UX shift

Old model:

```text
Score → metrics → user interprets
```

New model:

```text
Decision bucket → thesis → evidence → risks → unknowns → next action → metrics
```

The raw data table stays available, but it is no longer the product's main surface.

## 7. Key concepts

### Decision bucket

Every token should be classified into a practical research state:

- `research-priority`: direct/credible capture and attractive enough to inspect.
- `clear-but-expensive`: value capture is real, but valuation is not attractive.
- `cheap-but-unclear-capture`: looks cheap, but token capture is weak or unknown.
- `dilution-risk`: capture may exist, but future supply pressure is severe.
- `narrative-only`: narrative is strong, but token value path is not proven.
- `data-missing`: cannot judge without more information.
- `ignore`: low activity, stale, microcap noise, or otherwise not useful now.

### Thesis

One sentence explaining why the token is in the bucket.

Example:

```text
holder revenue is measured and P/HR is cheap relative to sector, but revenue durability still needs verification.
```

### Evidence

Facts that support the thesis.

Examples:

- holder revenue exists and is fresh;
- P/HR is sector-attractive;
- protocol revenue scale passes threshold;
- FDV/Mcap is not extreme.

### Risks

Reasons not to over-trust the candidate.

Examples:

- holder revenue missing;
- high FDV/Mcap;
- low activity / stale data;
- TVL not relevant to the sector;
- revenue could be one-off or incentive-driven.

### Unknowns

What the app cannot know from current data.

Important principle:

```text
Unknowns should not be hidden inside a score. Unknowns become research questions.
```

### Next questions

Copyable research questions the user can answer with docs, protocol research, or further agent work.

Examples:

- Does the token legally/economically receive protocol revenue?
- Is the fee switch currently active, or only governance-possible?
- Is revenue distributed, burned, bought back, or retained by treasury?
- Is token demand required for protocol usage/security/collateral?
- Are current revenues sustainable or incentive-driven?

## 8. Information architecture

Primary navigation:

```text
의사결정 | 후보 큐 | 가치포획 맵 | 원자료 | 방법론
```

### 의사결정

Default screen. Not a table. Shows research priorities, traps, high-risk candidates, and next questions.

### 후보 큐

Workflow surface for candidates by status: `New`, `Reviewing`, `Watch`, `Reject`, `Resolved`.

### 가치포획 맵

Matrix view separating valuation attractiveness from capture clarity.

### 원자료

Legacy valuation screener and raw metrics explorer.

### 방법론

Human-readable explanation of how to use the workbench.

## 9. UX principles

1. Table is not the product.
2. Scores are secondary to reasoning.
3. Separate “cheap” from “captures value.”
4. Unknowns are visible and actionable.
5. No buy/sell language.
6. Korean readability comes before data density.
7. The product should feel like an analyst workbench, not a crypto casino.

## 10. Acceptance criteria

The redesign succeeds when:

- the user does not land on a giant table;
- the first screen identifies specific candidates worth researching;
- every candidate has a thesis and next question;
- “cheap but unclear capture” is visible as a trap;
- high dilution and data gaps are visible;
- the old screener remains accessible but secondary;
- the app feels like a decision partner, not just a dashboard.
