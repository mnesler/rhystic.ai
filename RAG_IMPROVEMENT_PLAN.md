# RAG Improvement Plan — Rhystic Study (MTG Commander Assistant)

## Table of Contents

1. [Current System Baseline](#1-current-system-baseline)
2. [Why You Cannot Know If Results Are Better (Yet)](#2-why-you-cannot-know-if-results-are-better-yet)
3. [Phase 0 — Evaluation Infrastructure](#3-phase-0--evaluation-infrastructure)
4. [Phase 1 — Hybrid Search with Reciprocal Rank Fusion (RRF)](#4-phase-1--hybrid-search-with-reciprocal-rank-fusion-rrf)
5. [Phase 2 — HyDE Query Rewriting](#5-phase-2--hyde-query-rewriting)
6. [Phase 3 — Multi-hop Retrieval](#6-phase-3--multi-hop-retrieval)
7. [Phase 4 — Cross-Encoder Reranking](#7-phase-4--cross-encoder-reranking)
8. [Phase 5 — Richer Embedding Text](#8-phase-5--richer-embedding-text)
9. [Implementation Order and Dependencies](#9-implementation-order-and-dependencies)
10. [Expected Metric Deltas](#10-expected-metric-deltas)

---

## 1. Current System Baseline

### Pipeline (as of writing)

```
POST /api/chat { message, sessionId, mode }
  │
  ├─ [server.ts:276]  LLM #1 (gpt-4o-mini, T=0)
  │     classifyIntent() → Intent { type, cardNames, commander, colors, tags, themes, searchQuery }
  │
  ├─ [server.ts:320]  retrieve(effectiveIntent)
  │     Dispatches by intent.type to one of five strategy functions:
  │
  │     card-lookup  → exact SQL → LIKE SQL → vector fallback
  │     deck-build   → commander SQL + tag-join SQL + vector (30) → merge → color filter → top 50
  │     combo-find   → card SQL + combo-join → vector (15) → merge
  │     tag-search   → tag-join SQL (60) → color filter → top 30 [+ vector blend if < 20 results]
  │     power-assess → card-lookup + per-card combo-join
  │     general      → vector only (top 20)
  │
  ├─ [server.ts:328]  buildContext()
  │     Formats cards + combos as markdown
  │     Budget: 14,000 chars. Combos first, then cards. Truncates at budget.
  │
  ├─ [server.ts:341]  LLM #2 (kimi-k2, T=0.7)
  │     streamAnswer() → SSE token stream
  │
  └─ [server.ts:368]  extractConfirmedCardNames()
        Regex **bold** spans → DB validation → citation list sent in `done` event
```

### Key Files

| File | Role |
|---|---|
| `backend/src/assistant/intent.ts` | Intent classifier (LLM #1) |
| `backend/src/assistant/retrieve.ts` | All retrieval strategies |
| `backend/src/assistant/vector.ts` | Embedding cache + cosine search |
| `backend/src/assistant/context.ts` | Context shaping + token budget |
| `backend/src/assistant/answer.ts` | Streaming answer LLM (LLM #2) |
| `backend/src/assistant/server.ts` | Pipeline orchestration |
| `backend/src/db/schema.ts` | SQLite schema |

### Known Weaknesses

| # | Weakness | Impact |
|---|---|---|
| W1 | SQL and vector results merged by naive dedup (highest vectorScore wins), not jointly scored | Wrong cards surface when SQL rank and vector rank disagree |
| W2 | Query vector = raw user query text, which is semantically distant from card oracle text | Low recall for vague/strategic queries ("I need card draw for my tempo deck") |
| W3 | Single retrieval pass — retrieved cards are never used to seed a second retrieval | Combos found but their enablers/tutors/protection never retrieved |
| W4 | No reranking after the top-50 is assembled — 14K budget fills with marginal cards | Best cards may be truncated from context |
| W5 | Embedding text = `name. type. oracle_text. Keywords` — tags not included | Cards with opaque names or complex text have poor semantic neighbors |
| W6 | No persistent logging of queries, intents, retrieved cards, or scores | Impossible to measure before vs. after any change |

---

## 2. Why You Cannot Know If Results Are Better (Yet)

There is currently **zero evaluation infrastructure** in this repo:

- No golden query dataset
- No recall/precision metrics
- No logging of what was retrieved per query
- No way to replay past queries after a code change

Every "improvement" made without an eval harness is a guess. You might make retrieval faster but less accurate. You might improve one intent type while regressing another. Without numbers, you will not know.

**The eval harness must be built before any RAG changes are implemented.**

---

## 3. Phase 0 — Evaluation Infrastructure

This is the most important phase. Everything else depends on it.

### 3.1 What We Are Measuring

For a Commander deck-building assistant, "better retrieval" means:

1. **Recall@K** — Did the correct cards appear in the top K retrieved results?
2. **Context Coverage** — Did the correct cards survive the 14K char truncation and reach the LLM?
3. **Color Identity Correctness** — Did the LLM suggest only cards legal in the commander's color identity?
4. **Latency** — How long did retrieval take? Did a change add unacceptable overhead?

We deliberately do not start with LLM-as-judge answer quality metrics, because those are expensive (API cost), noisy (temperature > 0), and slow to compute. Retrieval metrics are deterministic and free.

### 3.2 Golden Dataset Schema

**File: `backend/eval/queries.json`**

```typescript
// TypeScript type for a single eval case
interface EvalCase {
  // Unique identifier for this test case
  id: string;

  // The raw user query as typed
  query: string;

  // Expected intent classification (used to verify intent LLM is working)
  expected_intent: {
    type: "card-lookup" | "deck-build" | "combo-find" | "tag-search" | "power-assess" | "general";
    commander?: string;
    colors?: string[];        // e.g. ["G", "U"]
    tags?: string[];          // subset of the 70-tag vocabulary
  };

  // Cards that MUST appear in the top-K retrieved results for this query to pass
  // At least one of must_retrieve or must_retrieve_any must be non-empty.
  must_retrieve: string[];        // ALL of these must be in top K (AND)
  must_retrieve_any: string[];    // AT LEAST ONE of these must be in top K (OR)

  // Cards that must NEVER appear (off-color, banned, wrong type, etc.)
  must_not_retrieve: string[];

  // The K value to evaluate against (default 20)
  top_k: number;

  // Human notes on why this case is interesting or tricky
  notes: string;
}
```

**Example entries covering all 6 intent types:**

```json
[
  {
    "id": "deck-build-kinnan-ramp",
    "query": "What ramp spells should I run in a Kinnan, Bonder Prodigy deck?",
    "expected_intent": {
      "type": "deck-build",
      "commander": "Kinnan, Bonder Prodigy",
      "colors": ["G", "U"],
      "tags": ["ramp", "mana-rock", "mana-dork"]
    },
    "must_retrieve": ["Sol Ring", "Arcane Signet", "Birds of Paradise"],
    "must_retrieve_any": ["Selvala, Heart of the Wilds", "Bloom Tender", "Faeburrow Elder"],
    "must_not_retrieve": ["Cabal Coffers", "Nykthos, Shrine to Nyx"],
    "top_k": 20,
    "notes": "Kinnan is G/U. Black ramp must not appear. Non-human mana dorks get extra value."
  },
  {
    "id": "deck-build-edgar-tokens",
    "query": "Build me an Edgar Markov vampire tribal token deck",
    "expected_intent": {
      "type": "deck-build",
      "commander": "Edgar Markov",
      "colors": ["W", "B", "R"],
      "tags": ["token-gen", "anthem", "draw"]
    },
    "must_retrieve": ["Edgar Markov"],
    "must_retrieve_any": ["Bloodline Keeper", "Legion Lieutenant", "Crimson Honor Guard"],
    "must_not_retrieve": ["Chatterfang, Squirrel General", "Rhys the Redeemed"],
    "top_k": 20,
    "notes": "Vampire tribal. Green token producers must not appear."
  },
  {
    "id": "combo-find-thassa",
    "query": "What combos does Thassa's Oracle go in?",
    "expected_intent": {
      "type": "combo-find",
      "tags": ["combo-piece", "win-condition"]
    },
    "must_retrieve": ["Thassa's Oracle"],
    "must_retrieve_any": ["Demonic Consultation", "Tainted Pact", "Laboratory Maniac"],
    "must_not_retrieve": [],
    "top_k": 20,
    "notes": "Classic cEDH win condition. Should surface the Oracle + Consultation line."
  },
  {
    "id": "combo-find-kiki",
    "query": "Show me infinite combos with Kiki-Jiki, Mirror Breaker",
    "expected_intent": {
      "type": "combo-find",
      "tags": ["combo-piece"]
    },
    "must_retrieve": ["Kiki-Jiki, Mirror Breaker"],
    "must_retrieve_any": ["Zealous Conscripts", "Pestermite", "Deceiver Exarch"],
    "must_not_retrieve": [],
    "top_k": 20,
    "notes": "Untapper combos. Should surface the haste + untapper package."
  },
  {
    "id": "tag-search-blue-counter",
    "query": "Show me blue counterspells under 2 mana",
    "expected_intent": {
      "type": "tag-search",
      "colors": ["U"],
      "tags": ["counter"]
    },
    "must_retrieve": ["Counterspell", "Flusterstorm"],
    "must_retrieve_any": ["Swan Song", "Mental Misstep", "Fierce Guardianship"],
    "must_not_retrieve": ["Mana Drain"],
    "top_k": 20,
    "notes": "Mana Drain costs UU = CMC 2, borderline — must_not_retrieve tests strict < 2."
  },
  {
    "id": "tag-search-green-ramp-cheap",
    "query": "Best green ramp spells under 3 mana",
    "expected_intent": {
      "type": "tag-search",
      "colors": ["G"],
      "tags": ["ramp", "land-fetch"]
    },
    "must_retrieve": ["Cultivate", "Kodama's Reach"],
    "must_retrieve_any": ["Farseek", "Nature's Lore", "Three Visits", "Rampant Growth"],
    "must_not_retrieve": ["Gilded Lotus", "Boundless Realms"],
    "top_k": 20,
    "notes": "Tests CMC budget filter + color filter working together."
  },
  {
    "id": "card-lookup-exact",
    "query": "What does Rhystic Study do?",
    "expected_intent": {
      "type": "card-lookup"
    },
    "must_retrieve": ["Rhystic Study"],
    "must_retrieve_any": [],
    "must_not_retrieve": [],
    "top_k": 5,
    "notes": "Exact name lookup. Should be position 1 with no vector search needed."
  },
  {
    "id": "card-lookup-fuzzy",
    "query": "Tell me about the Oracle of the sea god card",
    "expected_intent": {
      "type": "card-lookup"
    },
    "must_retrieve": ["Thassa's Oracle"],
    "must_retrieve_any": [],
    "must_not_retrieve": [],
    "top_k": 10,
    "notes": "Fuzzy name — user doesn't know exact name. Tests LIKE + vector fallback."
  },
  {
    "id": "general-aristocrats-strategy",
    "query": "Explain the aristocrats strategy in Commander",
    "expected_intent": {
      "type": "general",
      "tags": []
    },
    "must_retrieve_any": ["Viscera Seer", "Zulaport Cutthroat", "Blood Artist", "Dictate of Erebos"],
    "must_retrieve": [],
    "must_not_retrieve": [],
    "top_k": 20,
    "notes": "Pure semantic search. Tests whether vector search finds thematically relevant cards."
  },
  {
    "id": "general-stax-pieces",
    "query": "What are the best stax pieces for cEDH?",
    "expected_intent": {
      "type": "general",
      "tags": ["stax"]
    },
    "must_retrieve_any": ["Collector Ouphe", "Drannith Magistrate", "Orcish Bowmasters", "Rhystic Study"],
    "must_retrieve": [],
    "must_not_retrieve": [],
    "top_k": 20,
    "notes": "Tests retrieval for a meta-level strategy question."
  },
  {
    "id": "deck-build-vague-draw",
    "query": "I need card draw for my tempo deck",
    "expected_intent": {
      "type": "general",
      "tags": ["draw"]
    },
    "must_retrieve_any": ["Rhystic Study", "Mystic Remora", "Brainstorm", "Ponder"],
    "must_retrieve": [],
    "must_not_retrieve": [],
    "top_k": 20,
    "notes": "Vague query with no commander or colors. Tests pure semantic recall. This is where HyDE helps most."
  },
  {
    "id": "tag-search-removal-black",
    "query": "Best black removal spells",
    "expected_intent": {
      "type": "tag-search",
      "colors": ["B"],
      "tags": ["removal"]
    },
    "must_retrieve_any": ["Toxic Deluge", "Damnation", "Deadly Rollick", "Cyclonic Rift"],
    "must_retrieve": [],
    "must_not_retrieve": ["Swords to Plowshares", "Path to Exile"],
    "top_k": 20,
    "notes": "White removal must not appear. Cyclonic Rift is blue — if it appears, color filter is broken."
  }
]
```

### 3.3 Eval Harness — Pseudocode

**File: `backend/eval/run.ts`**

This script imports `retrieve()` directly from `retrieve.ts` and runs it on each golden case. No LLM calls needed (retrieval is deterministic given a fixed embedding model + DB state).

```typescript
// backend/eval/run.ts
//
// Usage:
//   npx tsx backend/eval/run.ts                    → runs all cases
//   npx tsx backend/eval/run.ts --id kinnan-ramp   → runs one case
//   npx tsx backend/eval/run.ts --out results/baseline.json
//
// Reads:   backend/eval/queries.json
// Writes:  stdout (markdown table) + optional JSON file via --out

import { retrieve } from "../src/assistant/retrieve.js";
import { classifyIntent } from "../src/assistant/intent.js";
import type { EvalCase } from "./types.js";
import cases from "./queries.json" assert { type: "json" };

interface CaseResult {
  id: string;
  query: string;
  // Intent classification results
  classified_type: string;
  expected_type: string;
  intent_correct: boolean;
  // Retrieval results
  retrieved_names: string[];    // all card names in retrieval result
  top_k_names: string[];        // top K only
  // Metric computations
  recall_at_k: number;          // 0.0 – 1.0: fraction of must_retrieve found in top K
  any_hit: boolean;             // true if at least one must_retrieve_any was in top K
  forbidden_hit: boolean;       // true if any must_not_retrieve appeared
  passed: boolean;              // recall_at_k == 1.0 AND any_hit AND NOT forbidden_hit
  // Timing
  retrieval_ms: number;
  intent_ms: number;
}

interface EvalReport {
  run_at: string;               // ISO timestamp
  git_sha: string;              // current HEAD SHA for reproducibility
  total_cases: number;
  passed: number;
  failed: number;
  pass_rate: number;            // 0.0 – 1.0
  avg_recall_at_k: number;
  avg_retrieval_ms: number;
  avg_intent_ms: number;
  cases: CaseResult[];
}

async function runEval(subset?: string[]): Promise<EvalReport> {
  const filtered = subset
    ? (cases as EvalCase[]).filter(c => subset.includes(c.id))
    : (cases as EvalCase[]);

  const results: CaseResult[] = [];

  for (const c of filtered) {
    // Step 1: classify intent (optional — skip with --no-intent flag to save cost)
    const intentStart = Date.now();
    const intent = await classifyIntent(c.query, []);
    const intentMs = Date.now() - intentStart;

    // Step 2: retrieve
    const retrievalStart = Date.now();
    const result = await retrieve(intent);
    const retrievalMs = Date.now() - retrievalStart;

    const topK = c.top_k ?? 20;
    const retrievedNames = result.cards.map(c => c.name);
    const topKNames = retrievedNames.slice(0, topK);

    // Step 3: compute metrics
    const mustSet = new Set(c.must_retrieve);
    const hitsInTopK = c.must_retrieve.filter(name => topKNames.includes(name));
    const recall = mustSet.size === 0 ? 1.0 : hitsInTopK.length / mustSet.size;

    const anyHit = c.must_retrieve_any.length === 0
      || c.must_retrieve_any.some(name => topKNames.includes(name));

    const forbiddenHit = c.must_not_retrieve.some(name => topKNames.includes(name));

    const passed = recall === 1.0 && anyHit && !forbiddenHit;

    results.push({
      id: c.id,
      query: c.query,
      classified_type: intent.type,
      expected_type: c.expected_intent.type,
      intent_correct: intent.type === c.expected_intent.type,
      retrieved_names: retrievedNames,
      top_k_names: topKNames,
      recall_at_k: recall,
      any_hit: anyHit,
      forbidden_hit: forbiddenHit,
      passed,
      retrieval_ms: retrievalMs,
      intent_ms: intentMs,
    });
  }

  const passed = results.filter(r => r.passed).length;
  return {
    run_at: new Date().toISOString(),
    git_sha: execSync("git rev-parse --short HEAD").toString().trim(),
    total_cases: results.length,
    passed,
    failed: results.length - passed,
    pass_rate: passed / results.length,
    avg_recall_at_k: mean(results.map(r => r.recall_at_k)),
    avg_retrieval_ms: mean(results.map(r => r.retrieval_ms)),
    avg_intent_ms: mean(results.map(r => r.intent_ms)),
    cases: results,
  };
}

// Print a compact markdown table to stdout
function printReport(report: EvalReport): void {
  console.log(`## Eval Report — ${report.run_at} (${report.git_sha})\n`);
  console.log(`Pass rate: ${(report.pass_rate * 100).toFixed(1)}%  (${report.passed}/${report.total_cases})`);
  console.log(`Avg Recall@K: ${(report.avg_recall_at_k * 100).toFixed(1)}%`);
  console.log(`Avg retrieval latency: ${report.avg_retrieval_ms.toFixed(0)}ms`);
  console.log();
  console.log("| ID | Pass | Recall@K | Intent✓ | Any Hit | Forbidden | Retrieval ms |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of report.cases) {
    const icon = r.passed ? "✅" : "❌";
    console.log(
      `| ${r.id} | ${icon} | ${(r.recall_at_k * 100).toFixed(0)}% | ${r.intent_correct ? "✓" : "✗"} | ${r.any_hit ? "✓" : "✗"} | ${r.forbidden_hit ? "⚠️" : "—"} | ${r.retrieval_ms}ms |`
    );
  }
}
```

**Add to `package.json` scripts:**

```json
{
  "scripts": {
    "eval": "npx tsx backend/eval/run.ts",
    "eval:baseline": "npx tsx backend/eval/run.ts --out backend/eval/results/baseline.json",
    "eval:diff": "npx tsx backend/eval/diff.ts backend/eval/results/baseline.json backend/eval/results/latest.json"
  }
}
```

### 3.4 Diff Tool — Pseudocode

**File: `backend/eval/diff.ts`**

```typescript
// backend/eval/diff.ts
// Compares two eval report JSON files and shows what improved / regressed.
//
// Usage:
//   npx tsx backend/eval/diff.ts results/baseline.json results/rrf.json

import baseline from "./results/baseline.json";
import candidate from "./results/rrf.json";

interface Diff {
  pass_rate_delta: number;         // +0.08 means 8 percentage points better
  recall_delta: number;
  latency_delta_ms: number;
  regressions: string[];           // case IDs that went from pass → fail
  improvements: string[];          // case IDs that went from fail → pass
  unchanged_pass: string[];
  unchanged_fail: string[];
}

function diff(a: EvalReport, b: EvalReport): Diff {
  const aById = new Map(a.cases.map(c => [c.id, c]));
  const bById = new Map(b.cases.map(c => [c.id, c]));

  const regressions: string[] = [];
  const improvements: string[] = [];
  const unchangedPass: string[] = [];
  const unchangedFail: string[] = [];

  for (const [id, bCase] of bById) {
    const aCase = aById.get(id);
    if (!aCase) continue;
    if (aCase.passed && !bCase.passed) regressions.push(id);
    else if (!aCase.passed && bCase.passed) improvements.push(id);
    else if (aCase.passed && bCase.passed) unchangedPass.push(id);
    else unchangedFail.push(id);
  }

  return {
    pass_rate_delta: b.pass_rate - a.pass_rate,
    recall_delta: b.avg_recall_at_k - a.avg_recall_at_k,
    latency_delta_ms: b.avg_retrieval_ms - a.avg_retrieval_ms,
    regressions,
    improvements,
    unchanged_pass: unchangedPass,
    unchanged_fail: unchangedFail,
  };
}
```

### 3.5 Eval Workflow (Before / After Any Change)

```bash
# 1. Establish baseline on current code (main branch)
npm run eval:baseline
# → saves backend/eval/results/baseline.json

# 2. Implement a change (e.g. RRF in Phase 1)

# 3. Run eval on changed code
npx tsx backend/eval/run.ts --out backend/eval/results/rrf.json

# 4. Compare
npx tsx backend/eval/diff.ts backend/eval/results/baseline.json backend/eval/results/rrf.json

# Expected output:
# pass_rate_delta: +0.08   (8 percentage points better)
# recall_delta:    +0.12   (12 pp better average recall)
# latency_delta:   +18ms   (acceptable overhead)
# improvements:    ["deck-build-kinnan-ramp", "tag-search-blue-counter"]
# regressions:     []
```

---

## 4. Phase 1 — Hybrid Search with Reciprocal Rank Fusion (RRF)

### 4.1 Problem Statement

Currently, SQL results and vector results are merged by `dedupeCards()` (`retrieve.ts:129`):

```typescript
// Current: keep the entry with the highest vectorScore
function dedupeCards(cards: RetrievedCard[]): RetrievedCard[] {
  const seen = new Map<string, RetrievedCard>();
  for (const card of cards) {
    const existing = seen.get(card.oracle_id);
    if (!existing || (card.vectorScore ?? 0) > (existing.vectorScore ?? 0)) {
      seen.set(card.oracle_id, card);
    }
  }
  return [...seen.values()];
}
```

This means:
- A card that is rank #1 in the SQL tag list but rank #30 in vector gets its SQL rank discarded
- A card that is rank #3 in both lists gets no bonus for appearing in both
- The final sort (`retrieve.ts:239`) uses a 0.02 threshold that is arbitrary and not derived from data

### 4.2 Reciprocal Rank Fusion

RRF is a parameter-free rank aggregation formula from information retrieval research. For a card appearing at rank `r` in a list, its RRF score contribution is `1 / (k + r)` where `k = 60` (a smoothing constant). Cards that appear in multiple lists accumulate scores.

```
RRF score = sum over all lists: 1 / (k + rank_in_list)
```

Example:
```
Sol Ring:
  - SQL tag rank: 1   → 1/(60+1)  = 0.01639
  - Vector rank: 3    → 1/(60+3)  = 0.01587
  - RRF total:          0.03226

Arcane Signet:
  - SQL tag rank: 2   → 1/(60+2)  = 0.01613
  - Vector rank: 1    → 1/(60+1)  = 0.01639
  - RRF total:          0.03252   ← ranks higher than Sol Ring

Cultivate:
  - SQL tag rank: 5   → 1/(60+5)  = 0.01538
  - Vector rank: not found (score 0)
  - RRF total:          0.01538   ← ranks below both
```

### 4.3 Implementation — Pseudocode

**New function in `retrieve.ts`:**

```typescript
// Replace dedupeCards() with this
function rrfMerge(
  lists: Array<{ cards: RetrievedCard[]; weight?: number }>,
  k: number = 60
): RetrievedCard[] {
  // card oracle_id → { card, rrfScore, seen in which lists }
  const scoreMap = new Map<string, { card: RetrievedCard; score: number }>();

  for (const { cards, weight = 1.0 } of lists) {
    for (let rank = 0; rank < cards.length; rank++) {
      const card = cards[rank]!;
      const contribution = weight * (1 / (k + rank + 1));  // rank is 0-indexed
      const existing = scoreMap.get(card.oracle_id);
      if (existing) {
        existing.score += contribution;
        // Keep the entry with non-null vectorScore for context.ts to display
        if (card.vectorScore !== undefined) {
          existing.card.vectorScore = card.vectorScore;
        }
      } else {
        scoreMap.set(card.oracle_id, { card: { ...card }, score: contribution });
      }
    }
  }

  // Sort by RRF score descending
  const merged = [...scoreMap.values()].sort((a, b) => b.score - a.score);
  
  // Attach RRF score as vectorScore so context.ts can display it
  for (const entry of merged) {
    entry.card.rrfScore = entry.score;
  }
  
  return merged.map(e => e.card);
}
```

**Update `retrieveDeckBuild()` to use RRF:**

```typescript
// BEFORE (retrieve.ts:232-243)
const sqlWithTags = attachTags(sqlCards);
const merged = dedupeCards([...sqlWithTags, ...vectorCards]);
const finalFiltered = applyColorFilter(merged, allowedColors);
finalFiltered.sort((a, b) => {
  const scoreDiff = (b.vectorScore ?? 0) - (a.vectorScore ?? 0);
  if (Math.abs(scoreDiff) > 0.02) return scoreDiff;
  return (a.edhrec_rank ?? 999999) - (b.edhrec_rank ?? 999999);
});

// AFTER
const sqlWithTags = attachTags(sqlCards);

// Build named lists so RRF can weight them independently
// SQL tag results are given 1.2x weight (we trust tag labels for Commander)
// Vector results are given 1.0x weight
// EDHREC rank is used as a third implicit "list" — rank 1 = most popular
const edhrecList = [...sqlWithTags].sort(
  (a, b) => (a.edhrec_rank ?? 999999) - (b.edhrec_rank ?? 999999)
);

const merged = rrfMerge([
  { cards: sqlWithTags, weight: 1.2 },   // tag-match results
  { cards: vectorCards, weight: 1.0 },   // semantic results
  { cards: edhrecList,  weight: 0.5 },   // popularity signal
]);

const finalFiltered = applyColorFilter(merged, allowedColors);
// No need for the secondary sort — RRF already accounts for all signals
```

**Also update `retrieveTagSearch()` at `retrieve.ts:424-432`:**

```typescript
// BEFORE
const result = attachTags(filtered.slice(0, 30));
if (result.length < 20 && hasEmbeddings()) {
  const vectorCards = await retrieveByVector(intent.searchQuery, 20);
  return dedupeCards([...result, ...vectorCards]).slice(0, 30);
}
return result;

// AFTER
const tagCards = attachTags(filtered);
let result: RetrievedCard[];
if (hasEmbeddings()) {
  const vectorCards = await retrieveByVector(intent.searchQuery, 30, intent.colors);
  result = rrfMerge([
    { cards: tagCards,    weight: 1.3 },
    { cards: vectorCards, weight: 1.0 },
  ]).slice(0, 30);
} else {
  result = tagCards.slice(0, 30);
}
return result;
```

### 4.4 Schema Change

None required. RRF is purely in-memory computation.

### 4.5 Expected Eval Impact

- Recall@K: **+8–15 percentage points** on `deck-build` and `tag-search` cases
- Latency: **+0ms** (pure math, no new I/O)
- Regressions: possible on `card-lookup` cases (exact matches should still rank first — verify in eval)

---

## 5. Phase 2 — HyDE Query Rewriting

### 5.1 Problem Statement

The vector search embeds the raw user query text and computes cosine similarity against card oracle text. These are semantically distant:

```
User: "I need something grindy for my Meren deck"
      ↓ embedded as-is
      → cosine similarity against card oracle text is low
      → "grindy" is not a word that appears in oracle text

Ideal: embed a synthetic card description instead:
"Creature — you get value when creatures die or enter. 
 Sacrifice outlets. Reanimation. Grind opponents out."
      → much higher cosine similarity against Viscera Seer, 
        Grave Pact, Dictate of Erebos, etc.
```

This technique is called **HyDE — Hypothetical Document Embedding**. Instead of embedding the query, you ask a small LLM to generate a hypothetical oracle text passage that would answer the query, then embed that.

### 5.2 Implementation — Pseudocode

**New file: `backend/src/assistant/hyde.ts`**

```typescript
// backend/src/assistant/hyde.ts
//
// HyDE: generate a hypothetical card description that matches what the user is
// looking for, then embed that description instead of the raw query.
//
// Falls back to raw query if the LLM call fails or takes too long.

import fetch from "node-fetch";
import type { Intent } from "./intent.js";

const HYDE_MODEL = process.env.HYDE_MODEL ?? "openai/gpt-4o-mini";
const HYDE_TIMEOUT_MS = 3000;  // bail out and use raw query if too slow

const HYDE_SYSTEM_PROMPT = `You are an expert Magic: The Gathering rules text writer.

Given a description of what the user is looking for, write a hypothetical MTG oracle text 
passage (2-4 sentences) that would appear on a card matching that description.

Write ONLY the oracle text. No card name, no mana cost, no type line. Just the text box.
Be specific and use real MTG terminology (tap, untap, sacrifice, exile, enters the battlefield, etc.)

Examples:
User: "ramp for a green deck"
Output: "When this creature enters the battlefield, you may search your library for a basic land 
card and put it onto the battlefield tapped. {T}: Add {G}{G}."

User: "protection for my commander"  
Output: "{1}{U}: Until end of turn, target creature you control gains hexproof and is 
indestructible. Draw a card."

User: "aristocrats win condition"
Output: "Whenever a creature you control dies, each opponent loses 1 life and you gain 1 life. 
Whenever a nontoken creature enters the battlefield under your control, create a 1/1 black 
Rat creature token."`;

export async function generateHyDE(intent: Intent): Promise<string> {
  // HyDE is most valuable for general/deck-build intents with no explicit card names
  // Skip for card-lookup (exact match is better) and when searchQuery is a card name
  if (intent.type === "card-lookup" || intent.cardNames.length > 0) {
    return intent.searchQuery;
  }

  const userPrompt = [
    intent.commander ? `Commander: ${intent.commander}` : "",
    intent.themes.length > 0 ? `Themes: ${intent.themes.join(", ")}` : "",
    `Looking for: ${intent.searchQuery}`,
  ].filter(Boolean).join("\n");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HYDE_TIMEOUT_MS);

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: HYDE_MODEL,
        messages: [
          { role: "system", content: HYDE_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 120,
      }),
    });

    clearTimeout(timeout);

    if (!res.ok) return intent.searchQuery;  // fallback

    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const hydeText = data.choices?.[0]?.message?.content?.trim() ?? "";

    // Return HyDE text if it's substantive, otherwise fall back to searchQuery
    return hydeText.length > 20 ? hydeText : intent.searchQuery;
  } catch {
    return intent.searchQuery;  // always fall back gracefully
  }
}
```

**Update `retrieveByVector()` in `retrieve.ts`:**

```typescript
// BEFORE (retrieve.ts:435-438)
async function retrieveByVector(query: string, topK: number, allowedColors: string[] = []): Promise<RetrievedCard[]> {
  const fetchK = allowedColors.length > 0 ? topK * 2 : topK;
  const matches = await searchByText(query, fetchK);

// AFTER: accept both a raw query and optional HyDE text; search both and RRF-merge
async function retrieveByVector(
  query: string,
  topK: number,
  allowedColors: string[] = [],
  hydeText?: string
): Promise<RetrievedCard[]> {
  const fetchK = allowedColors.length > 0 ? topK * 2 : topK;

  if (hydeText && hydeText !== query) {
    // Run both searches in parallel; RRF-merge the results
    const [rawMatches, hydeMatches] = await Promise.all([
      searchByText(query, fetchK),
      searchByText(hydeText, fetchK),
    ]);
    
    // Convert VectorMatch lists to RetrievedCard lists and RRF-merge
    // rawMatches weighted 0.6, hydeMatches weighted 1.0 (trust HyDE more for semantic)
    const rawCards = await matchesToCards(rawMatches, allowedColors);
    const hydeCards = await matchesToCards(hydeMatches, allowedColors);
    const merged = rrfMerge([
      { cards: rawCards, weight: 0.6 },
      { cards: hydeCards, weight: 1.0 },
    ]);
    return merged.slice(0, topK);
  }

  // No HyDE text — original path
  const matches = await searchByText(query, fetchK);
  // ... rest of original implementation
}
```

**Call site in `retrieveDeckBuild()` and `retrieveTagSearch()`:**

```typescript
// In retrieve.ts — retrieveDeckBuild()
// After classifying intent and before vector search:

import { generateHyDE } from "./hyde.js";

// Step 3: generate HyDE text (runs concurrently with SQL queries)
const [hydeText, tagCardsRaw] = await Promise.all([
  generateHyDE(intent),
  fetchTagCards(intent),   // the SQL tag-join, extracted to its own async fn
]);

vectorCards = await retrieveByVector(searchQuery, 30, allowedColors, hydeText);
```

### 5.3 Latency Considerations

HyDE adds one extra LLM call (~200–400ms with gpt-4o-mini). Mitigations:

1. **Parallelism**: the HyDE call can run at the same time as the SQL tag queries (they are independent)
2. **Timeout**: 3000ms timeout with graceful fallback to raw query
3. **Skip conditions**: skip for `card-lookup` (exact match), skip when `intent.cardNames.length > 0`
4. **Caching** (optional): hash the `searchQuery` + `commander` and cache the HyDE text in memory for the lifetime of the process — repeated queries for the same commander strategy return instantly

### 5.4 Expected Eval Impact

- Recall@K: **+10–20 percentage points** on `general` and vague `deck-build` cases (e.g. `deck-build-vague-draw`)
- Recall@K: **+0 pp** on `card-lookup` (skipped entirely for those)
- Latency: **+200–400ms** if not parallelised, **+0ms** if parallelised with SQL queries
- Regressions: unlikely — raw query is always included in the RRF merge

---

## 6. Phase 3 — Multi-hop Retrieval

### 6.1 Problem Statement

The current pipeline does one retrieval pass and sends the results to the LLM. For Commander deck building, one pass is not enough because the answer to "build me a Thassa's Oracle combo deck" requires:

- **Hop 1**: Find the win condition (Thassa's Oracle + Demonic Consultation combo)
- **Hop 2**: From those combo pieces, find the tutors that find them (Mystical Tutor, Vampiric Tutor, Demonic Tutor)
- **Hop 3**: Find the protection for the combo (Swan Song, Flusterstorm, Silence, Force of Will)
- **Hop 4**: Find the fast mana to execute the plan (Mana Crypt, Sol Ring, Dockside Extortionist)

None of hops 2–4 are discoverable from the user query alone — they require knowing what hop 1 returned first.

### 6.2 Multi-hop Architecture

```
User query → Intent classification
  │
  ├─ Hop 1: Base retrieval (existing logic)
  │     → returns: combo pieces, commander, primary strategy cards
  │
  ├─ Hop 2: Seed retrieval from Hop 1 results [NEW]
  │     Input:  card names from Hop 1
  │     Queries: "tutors that find [card names]"
  │              "protection for [card names]"
  │              "enablers for [card names]"
  │     → returns: support package cards
  │
  └─ Context assembly: merge hop1 + hop2 results, RRF-rank, apply budget
```

### 6.3 When to Run Hop 2

Multi-hop is expensive (extra SQL + vector calls) and only needed for certain intent types. The trigger conditions:

```typescript
function shouldRunHop2(intent: Intent, hop1: RetrievalResult): boolean {
  // Only for deck-build and combo-find
  if (intent.type !== "deck-build" && intent.type !== "combo-find") return false;
  // Only if hop 1 returned combos (there are pieces to find support for)
  if (hop1.combos.length === 0) return false;
  // Only if we have embeddings (vector search needed for hop 2)
  if (!hop1.hasEmbeddings) return false;
  return true;
}
```

### 6.4 Hop 2 Query Generation — Pseudocode

```typescript
// backend/src/assistant/retrieve.ts (new function)

interface Hop2Queries {
  tutorQuery: string;      // "cards that search for Thassa's Oracle or Demonic Consultation"
  protectionQuery: string; // "counterspells and protection for combo deck"
  enablerQuery: string;    // "fast mana and ritual effects for combo"
}

function buildHop2Queries(
  intent: Intent,
  hop1Cards: RetrievedCard[],
  hop1Combos: RetrievedCombo[]
): Hop2Queries {
  // Collect the combo pieces by name
  const comboPieceNames = [
    ...hop1Combos.flatMap(c => c.card_names),
    ...hop1Cards.filter(c => c.tags.includes("combo-piece") || c.tags.includes("win-condition"))
      .map(c => c.name)
      .slice(0, 5),
  ].slice(0, 8);  // cap to avoid overly long queries

  const comboNameStr = comboPieceNames.join(", ") || intent.searchQuery;
  const commander = intent.commander ?? "commander";

  return {
    tutorQuery: `cards that tutor for or search library for ${comboNameStr}`,
    protectionQuery: `counterspells and hexproof protection for ${commander} combo strategy`,
    enablerQuery: `fast mana artifacts and rituals for ${commander} combo`,
  };
}

async function retrieveHop2(
  intent: Intent,
  hop1: RetrievalResult,
  allowedColors: string[]
): Promise<RetrievedCard[]> {
  if (!shouldRunHop2(intent, hop1)) return [];

  const queries = buildHop2Queries(intent, hop1.cards, hop1.combos);

  // Run all three vector searches in parallel
  const [tutorCards, protectionCards, enablerCards] = await Promise.all([
    retrieveByVector(queries.tutorQuery, 10, allowedColors),
    retrieveByVector(queries.protectionQuery, 10, allowedColors),
    retrieveByVector(queries.enablerQuery, 10, allowedColors),
  ]);

  // Also get tag-based tutor results from SQL (more precise than vector for tutors)
  const tutorSqlCards = await retrieveByTag(["tutor"], allowedColors, 15);

  // RRF-merge all hop 2 results
  const hop2merged = rrfMerge([
    { cards: tutorCards,      weight: 1.0 },
    { cards: tutorSqlCards,   weight: 1.3 },
    { cards: protectionCards, weight: 0.9 },
    { cards: enablerCards,    weight: 0.8 },
  ]);

  // Remove cards already in hop 1 results (avoid duplicates in context)
  const hop1Ids = new Set(hop1.cards.map(c => c.oracle_id));
  return hop2merged.filter(c => !hop1Ids.has(c.oracle_id)).slice(0, 20);
}
```

### 6.5 Context Assembly Change

The hop 2 results are appended to the retrieval result before `buildContext()`:

```typescript
// In retrieve.ts — retrieveDeckBuild()

const hop1 = { cards: finalFiltered.slice(0, 35), combos };  // leave room for hop 2
const hop2Cards = await retrieveHop2(intent, hop1, allowedColors);

return {
  cards: [...hop1.cards, ...hop2Cards],  // hop 1 first (higher priority in context budget)
  combos: hop1.combos,
  hasEmbeddings: embeds,
};
```

**Context section labelling** — update `context.ts` to label hop 2 cards differently:

```typescript
// Attach a hop field to RetrievedCard to let context.ts distinguish
card.retrievalHop = 2;  // 1 = primary, 2 = support package

// In buildContext():
if (formattedCards.length === 0 && result.hop2Cards.length > 0) {
  sections.push("## Support Package (Tutors, Protection, Enablers)");
}
```

### 6.6 Latency Considerations

Hop 2 adds 3 parallel vector searches (each ~10ms in-memory cosine) + 1 SQL query:
- Vector: ~10ms × 3 = ~30ms (parallel)
- SQL: ~5ms
- **Total hop 2 overhead: ~35–40ms**

This is acceptable. The expensive part (embedding the query) is only done for hop 2 if the queries are different from hop 1. Since they are (`tutor for X`, `protection for Y`), two embedding API calls are needed. Mitigate by caching embeddings for common hop-2 query patterns.

### 6.7 Expected Eval Impact

- Recall@K on `combo-find` cases: **+15–25 pp** (tutors and protection now surface)
- Recall@K on `deck-build` cases with combos: **+10–20 pp**
- No impact on `card-lookup`, `tag-search`, `power-assess`, `general`
- Latency: **+35ms** in-memory ops, **+400ms** if embedding API calls needed

---

## 7. Phase 4 — Cross-Encoder Reranking

### 7.1 Problem Statement

After retrieving 50 cards and assembling context, the 14K char budget (`context.ts:15`) can only fit ~20–25 cards. The current truncation is positional — the last cards in the array are dropped. If a highly relevant card ends up at position 22 due to imperfect RRF scoring, it gets cut.

A reranker scores each (query, card) pair jointly — it can assess "given this specific question, how useful is this specific card?" and reorder before truncation.

### 7.2 Reranker Options

| Option | Model | Cost | Latency | Quality |
|---|---|---|---|---|
| API reranker | `cohere/rerank-v3.5` via OpenRouter | ~$0.001/query | ~200ms | High |
| LLM-as-reranker | gpt-4o-mini with structured output | ~$0.002/query | ~400ms | Medium-High |
| Keyword overlap | count query term matches per card | Free | <1ms | Low |
| BM25 | okapi BM25 over oracle text | Free | ~5ms | Medium |

**Recommendation**: start with the LLM-as-reranker using `openai/gpt-4o-mini` with a batch scoring prompt. It is cheap, requires no new API integrations, and produces interpretable scores.

### 7.3 LLM-as-Reranker — Pseudocode

**New file: `backend/src/assistant/rerank.ts`**

```typescript
// backend/src/assistant/rerank.ts
//
// Given a user query and a list of cards, ask a small LLM to score each card's
// relevance 0-10. Reorder cards by score descending.
//
// Called AFTER retrieval, BEFORE buildContext(), only when the retrieved set
// exceeds the context budget (i.e. > ~20 cards for deck-build).

import fetch from "node-fetch";
import type { RetrievedCard } from "./retrieve.js";

const RERANK_MODEL = process.env.RERANK_MODEL ?? "openai/gpt-4o-mini";
const RERANK_BATCH_SIZE = 20;  // score up to 20 cards per LLM call

const RERANK_SYSTEM = `You are a Magic: The Gathering Commander deck expert.
Given a user query and a list of cards, score each card's relevance to the query from 0 to 10.
Respond ONLY with a JSON array of { "oracle_id": string, "score": number } objects, one per card.
Consider: does this card directly answer the query? Does it synergize with the mentioned commander?
Is it legal in the color identity? Is it commonly played in this archetype?`;

export async function rerankCards(
  query: string,
  cards: RetrievedCard[],
  topN: number = 20
): Promise<RetrievedCard[]> {
  if (cards.length <= topN) return cards;  // no need to rerank if small set

  // Format cards as compact strings for the LLM
  const cardSummaries = cards.slice(0, RERANK_BATCH_SIZE).map(c =>
    `{"oracle_id":"${c.oracle_id}","name":"${c.name}","type":"${c.type_line}","text":"${(c.oracle_text ?? "").slice(0, 100)}","tags":"${c.tags.join(",")}"}`
  );

  const userPrompt = `Query: ${query}\n\nCards:\n${cardSummaries.join("\n")}`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: RERANK_MODEL,
        messages: [
          { role: "system", content: RERANK_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 500,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) return cards;  // fallback to original order

    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const scores = JSON.parse(data.choices[0]!.message.content) as Array<{ oracle_id: string; score: number }>;

    const scoreMap = new Map(scores.map(s => [s.oracle_id, s.score]));

    // Sort by reranker score; cards not scored keep their original relative order at the bottom
    return [...cards].sort((a, b) => {
      const sa = scoreMap.get(a.oracle_id) ?? -1;
      const sb = scoreMap.get(b.oracle_id) ?? -1;
      return sb - sa;
    });
  } catch {
    return cards;  // always fall back gracefully
  }
}
```

**Call site in `server.ts`:**

```typescript
// After retrieve(), before buildContext()
// Only call reranker for deck-build (where context budget matters most)

const result = await retrieve(effectiveIntent);

if (effectiveIntent.type === "deck-build" && result.cards.length > 20) {
  result.cards = await rerankCards(
    effectiveIntent.searchQuery,
    result.cards,
    20  // keep top 20 after reranking
  );
}

const context = buildContext(result, effectiveIntent);
```

### 7.4 Expected Eval Impact

- Context Coverage metric: **+10–20 pp** (right cards now survive truncation)
- Recall@K (retrieval): **unchanged** (reranker runs after retrieval, doesn't change what was found)
- Latency: **+400ms** (one extra LLM call)

---

## 8. Phase 5 — Richer Embedding Text

### 8.1 Problem Statement

Current embedding text (`embed.ts:57-70`):

```typescript
function cardToText(card: EmbeddedCard): string {
  const keywords = jsonArr(card.keywords).join(", ");
  return `${card.name}. ${card.type_line}. ${card.oracle_text ?? ""}. Keywords: ${keywords}`;
}
```

This means cards with opaque names (`Yawgmoth, Thran Physician`, `Ad Nauseam`) have embeddings that don't encode their strategic role — only their oracle text.

A human expert reading the card knows "Yawgmoth = sacrifice engine, aristocrats payoff, graveyard value, combo piece" but the embedding only captures "pay 1 life, put a -1/-1 counter, proliferate, draw".

### 8.2 Enriched Embedding Text Format

```typescript
// New cardToText() in embed.ts
function cardToText(card: EmbeddedCard, tags: string[]): string {
  const keywords = jsonArr(card.keywords).join(", ");
  const colorId = jsonArr(card.color_identity).join("");
  const tagStr = tags.length > 0 ? `Roles: ${tags.join(", ")}.` : "";

  // Include EDHREC rank as a proxy for "how widely played is this"
  const popularity = card.edhrec_rank
    ? card.edhrec_rank < 500 ? "staple" : card.edhrec_rank < 2000 ? "popular" : "niche"
    : "";

  return [
    `${card.name}.`,
    `${card.type_line}.`,
    card.oracle_text ?? "",
    keywords ? `Keywords: ${keywords}.` : "",
    colorId ? `Color identity: ${colorId}.` : "",
    tagStr,
    popularity ? `Popularity: ${popularity}.` : "",
  ].filter(Boolean).join(" ");
}
```

Example output for Yawgmoth:
```
Yawgmoth, Thran Physician. Legendary Creature — Human Wizard. 
Protection from Humans. Pay 1 life, Sacrifice another creature: Put a -1/-1 counter on up to 
one target creature and draw a card. {B}, Discard a card: Proliferate.
Keywords: Protection. Color identity: B.
Roles: combo-piece, draw, death-trigger, activated-ability, graveyard-hate.
Popularity: popular.
```

### 8.3 Re-embedding Process

Re-embedding requires wiping the `card_embeddings` table and re-running `embed.ts`. This is a one-time offline operation.

```bash
# 1. Clear existing embeddings
sqlite3 backend/data/mtg.db "DELETE FROM card_embeddings;"

# 2. Re-run embed with enriched text format
npm run embed:cards
# This takes ~30-60 minutes for 30K cards (rate limited by OpenRouter)
```

**No changes to retrieval code needed** — the enriched embeddings are drop-in replacements.

### 8.4 A/B Test Strategy

Because re-embedding is destructive (you cannot run old and new embeddings simultaneously without adding a new column), test this carefully:

```bash
# 1. Establish eval baseline with current embeddings
npm run eval:baseline -- --out results/embeddings-v1.json

# 2. Add a second model column to card_embeddings
#    Use model = "openai/text-embedding-3-small-v2" as a tag
sqlite3 backend/data/mtg.db "
  ALTER TABLE card_embeddings ADD COLUMN IF NOT EXISTS embedding_v2 BLOB;
"

# 3. Embed with new text format, store in embedding_v2 column
# (modify embed.ts to write to a different model slug)

# 4. Run eval against v2
npm run eval -- --embed-model openai/text-embedding-3-small-v2 --out results/embeddings-v2.json

# 5. Diff
npm run eval:diff results/embeddings-v1.json results/embeddings-v2.json
```

Alternatively, store the enriched embeddings under a different model name: `openai/text-embedding-3-small+tags` and compare the two models in eval.

### 8.5 Expected Eval Impact

- Recall@K on `general` (semantic) cases: **+5–12 pp**
- Recall@K on `deck-build` cases with vague queries: **+5–10 pp**
- Recall@K on `card-lookup` (exact match): **unchanged** (no vector used)
- Re-embedding cost: ~$2–4 in OpenRouter credits for 30K cards at $0.02/1M tokens

---

## 9. Implementation Order and Dependencies

```
Phase 0 (Eval Infrastructure)          ← MUST be done first, no deps
  │
  ├─ Phase 1 (RRF)                     ← no new services, no API calls, pure math
  │     Depends on: Phase 0 (need baseline to verify improvement)
  │
  ├─ Phase 2 (HyDE)                    ← adds 1 LLM call (gpt-4o-mini)
  │     Depends on: Phase 0, Phase 1 (RRF used to merge HyDE + raw results)
  │
  ├─ Phase 3 (Multi-hop)               ← adds 3 parallel vector searches
  │     Depends on: Phase 0, Phase 1 (RRF used for hop 2 merge)
  │     Can run in parallel with Phase 2
  │
  ├─ Phase 4 (Reranker)                ← adds 1 LLM call (gpt-4o-mini)
  │     Depends on: Phase 0
  │     Can be done any time after Phase 0
  │     More impactful after Phase 3 (more candidates to rerank)
  │
  └─ Phase 5 (Richer Embeddings)       ← offline re-embed, destructive
        Depends on: Phase 0
        Do this last — need baseline before destroying current embeddings
        Validate with A/B test using separate model slug
```

### Recommended Sprint Order

| Sprint | Phases | Goal |
|---|---|---|
| Sprint 1 | Phase 0 | Build eval, establish baseline, write golden dataset |
| Sprint 2 | Phase 1 | Implement RRF, prove measurable improvement in eval |
| Sprint 3 | Phase 2 + 3 | HyDE + Multi-hop (can be developed in parallel) |
| Sprint 4 | Phase 4 | Reranker, validate context coverage metric improves |
| Sprint 5 | Phase 5 | Re-embed with richer text, A/B test |

---

## 10. Expected Metric Deltas

The table below shows **estimated** improvements per phase on the golden dataset. Actual numbers will be established by the eval harness.

| Phase | Recall@K | Context Coverage | Color Correctness | Latency |
|---|---|---|---|---|
| Baseline | ~55% | ~70% | ~90% | ~80ms |
| + Phase 1 (RRF) | ~65% (+10pp) | ~75% (+5pp) | ~90% | ~80ms (+0) |
| + Phase 2 (HyDE) | ~75% (+10pp) | ~78% (+3pp) | ~90% | ~280ms (+200) |
| + Phase 3 (Multi-hop) | ~83% (+8pp) | ~82% (+4pp) | ~90% | ~320ms (+40) |
| + Phase 4 (Reranker) | ~83% (+0pp) | ~90% (+8pp) | ~90% | ~720ms (+400) |
| + Phase 5 (Embeddings) | ~88% (+5pp) | ~92% (+2pp) | ~90% | ~720ms (+0) |

**Recall@K**: fraction of must-retrieve cards in top K results  
**Context Coverage**: fraction of must-retrieve cards that survived budget truncation and reached the LLM  
**Color Correctness**: fraction of LLM card suggestions that are legal in the commander's color identity  
**Latency**: end-to-end retrieval time (not including LLM answer streaming)

> The latency column shows cumulative totals. Phase 2 (HyDE) adds the most latency because it adds a serial LLM call. Phases 1 and 5 add no latency. Phases 3 and 4 can be hidden behind the answer LLM streaming (which takes 2–10s), making the overhead invisible to users.

---

*Last updated: 2026-03-06*  
*Author: RAG improvement plan based on analysis of `backend/src/assistant/` as of commit at that date*
