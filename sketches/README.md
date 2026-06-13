# UX Sketches — Token Value Capture Workbench

Three disposable UX directions for the from-scratch redesign.

## Variants

### 001 — Research Desk

Path: `sketches/001-research-desk/index.html`

A calm analyst workbench with:

- left navigation;
- KPI strip;
- research-priority candidate cards;
- right-side “today's research questions”;
- bottom trap lanes;
- candidate detail drawer.

Best for the default home screen.

### 002 — Command Center

Path: `sketches/002-command-center/index.html`

A dense power-user scanner with:

- top metrics;
- filterable candidate table;
- right-side detail panel;
- compact bucket stats.

Best as a secondary scanning/raw explorer mode. Risk: too close to the existing table-first product.

### 003 — Memo Cards

Path: `sketches/003-memo-cards/index.html`

A warm research memo board with:

- kanban-like columns by decision bucket;
- card-based token theses;
- click-to-open detail modal;
- checklist/next-action framing.

Best for candidate queue and Obsidian-like research workflow.

## Head-to-head

| Dimension | Research Desk | Command Center | Memo Cards |
|---|---|---|---|
| Best role | Default decision home | Fast scanner | Research queue |
| Density | Medium | High | Medium-low |
| Reasoning visibility | High | Medium | High |
| Raw data scanning | Medium | High | Low |
| Risk of repeating old UX | Low | High | Low |
| Fit for 태규 | High | Medium | High |

## Recommendation

Use a hybrid:

```text
Research Desk as the default home
Memo Cards as the candidate queue
Command Center patterns only inside 원자료/스캔 mode
```

This avoids the old mistake: building another table with one more score column.

## Verification

Rendered in browser and checked visually:

- `001-research-desk`: no visible layout break, drawer opens, console errors 0.
- `002-command-center`: no visible layout break, filter buttons work, console errors 0.
- `003-memo-cards`: no visible layout break, modal opens, console errors 0.
