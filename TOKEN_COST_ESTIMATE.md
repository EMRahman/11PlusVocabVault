# Token Cost Estimate — Theme-Aware Sentence Generation

## 1. The problem

Today every word in `data/words.json` carries **one** static `sentence_usage`
string. In Story Quest the chosen theme only wraps that question in a fixed
narrative template (`themeNarratives` in `js/app.js:727-777`) and slots the
word into a `{word}` placeholder. The example sentence itself never changes —
the same "Abundant berries hung from the hedge…" line is used whether the word
appears in the Dragon Mountain or the Sea Journey world.

The goal: the **sentence** should belong to the theme, so the word is genuinely
practised in a forest / castle / dragon / fairy / battle / sea / wizard context
rather than rotated through a theme-neutral line.

## 2. Scope — the generation matrix

| Dimension       | Count | Source |
|-----------------|-------|--------|
| Words           | 351   | `data/words.json` (`words` array) |
| Themes          | 7     | `THEME_KEYWORDS` / `themeNarratives`, `js/app.js` |
| Question types  | 5     | `definition`, `word`, `sentence`, `synonym`, `antonym` (`Mixed` reuses these) |

Only the **`sentence`** question type literally consumes a sentence; the other
four are driven by definitions and synonym/antonym lists. That gives two honest
scopes for "the word fits the theme":

- **Scope A — themed sentence per (word × theme):** 351 × 7 = **2,457 sentences**.
  Every word can appear, themed, in any of the 7 worlds.
- **Scope C — themed text per (question type × word × theme):** 5 × 351 × 7 =
  **12,285 short texts**. This is the literal "permutation for each quiz type
  and each word" — themed clue text for all five types, not just sentence-blank.
- **Scope B — themed sentence for each word's *assigned* theme only:** **351
  sentences**. Each word already resolves to exactly one theme via
  `getWordTheme()`, so this is the minimum that removes the static sentence.
- **Scope D — themed text per (question type × word's assigned theme):** 5 ×
  351 = **1,755 short texts**. Scope C narrowed to the single theme each word
  resolves to via `getWordTheme()`. This is the scope that was implemented —
  see §6.

## 3. Per-item token model

A generation call needs an instruction, the word's data, and the theme
descriptor as input, and returns the sentence as output.

| Component                                   | Tokens |
|----------------------------------------------|--------|
| Instruction / task spec (constraints, format)| ~220   |
| Word context (word + definition + word_type) | ~30    |
| Theme descriptor (name + setting + keywords) | ~40 each |
| Output: one sentence (~11–15 words)          | ~18 content |
| Output: per-item JSON wrapper in a batch     | ~7     |
| Output: single-item JSON `{"sentence":"…"}`  | ~30    |

English runs ~4 characters per token; the current sentences average 65 chars
(~16 tokens), so a themed sentence of similar length is ~18 tokens of content.

**Batching is the main lever.** Generating all 7 themed sentences for one word
in a single call shares the instruction and theme block instead of repeating
them per sentence. That is the recommended approach below.

## 4. Estimates

Costs use illustrative public list prices — **verify current rates before
budgeting**: Haiku ≈ $1 / $5 per million input / output tokens; Sonnet ≈
$3 / $15. Sentence writing is well within Haiku's ability; Sonnet buys higher
prose quality.

### Scope A — 2,457 themed sentences (recommended)

Batched by word: **351 calls**, 7 sentences each.

- Input:  351 × (220 + 30 + 7×40) = 351 × 530 ≈ **186,000 tokens**
- Output: 351 × (7×25 + 20)       = 351 × 195 ≈ **68,000 tokens**
- **Total ≈ 254,000 tokens**

| Model  | Cost (one-time) |
|--------|-----------------|
| Haiku  | ≈ **$0.55**     |
| Sonnet | ≈ **$1.60**     |

For comparison, the naive un-batched version (one call per sentence, 2,457
calls) repeats the instruction every time → ~790K tokens, ≈ $1.10 (Haiku) /
$3.25 (Sonnet). Batching cuts cost roughly 3×.

### Scope B — 351 themed sentences (minimum)

One call per word, assigned theme only.

- Input ≈ 101,800 · Output ≈ 10,500 · **Total ≈ 112,000 tokens**
- Cost: ≈ **$0.15** (Haiku) / **$0.46** (Sonnet)

### Scope C — 12,285 themed texts, all five question types

Batched by word: 351 calls, 35 texts (5 types × 7 themes) each.

- Input:  351 × 650  ≈ **228,000 tokens**
- Output: 351 × 915  ≈ **321,000 tokens**
- **Total ≈ 549,000 tokens**
- Cost: ≈ **$1.85** (Haiku) / **$5.50** (Sonnet)

### Contingency

Budget **~20% extra** for regeneration — some outputs will fail validation
(word missing from the sentence, wrong grammatical form, too long, theme too
weak). With that overhead:

| Scope | Tokens (incl. retries) | Haiku | Sonnet |
|-------|------------------------|-------|--------|
| A (2,457 sentences)  | ~305,000 | **~$0.66** | **~$1.92** |
| B (351 sentences)    | ~135,000 | **~$0.18** | **~$0.55** |
| C (12,285 texts)     | ~660,000 | **~$2.22** | **~$6.60** |

## 5. Notes

- **One-time cost.** Generate once, write the results back into `words.json`
  (e.g. a `themed_sentences` map keyed by theme). Quiz runtime stays a static
  client-side app with zero per-quiz API cost or latency. Generating on demand
  at quiz time would be cheap per question (~few hundred tokens) but adds
  latency and recurring spend — pre-generation is clearly preferred.
- **Prompt caching.** The ~220-token instruction plus the ~280-token theme
  block are identical across all 351 calls. Caching that ~500-token prefix
  bills repeat reads at ~10%, dropping Scope A input cost to a few cents — minor
  in absolute terms but free to apply.
- **Bottom line.** Making every word's sentence theme-aware is inexpensive: the
  recommended Scope A is roughly **$0.55–$1.60** (≈ $0.66–$1.92 with retries),
  and even the full five-type permutation (Scope C) stays under **$7**. The real
  cost is authoring/validating the generation prompt, not the tokens.

## 6. Implementation

Scope D was generated with **Claude Haiku** and written into `data/words.json`.
Each word gains a `themed_quest` object — its assigned `theme` plus one text per
quiz type:

| Field        | Used by quiz type | Form |
|--------------|-------------------|------|
| `definition` | Definition → word | Themed clue that shows the meaning *without* naming the word |
| `word`       | Word → meaning    | Themed example sentence using the word |
| `sentence`   | Sentence blank    | Themed sentence with the word replaced by `_____` |
| `synonym`    | Synonym match     | Themed example sentence using the word |
| `antonym`    | Antonym match     | Themed example sentence using the word |

### Pipeline (`scripts/`)

1. `build-batches.js` — assigns each word its theme (mirrors `getWordTheme()`)
   and splits the 351 words into batch files under `scripts/batches/`.
2. A Haiku pass writes one `*.out.json` per batch with the themed texts.
3. `merge-themed.js` — validates every text (word present/absent as required,
   single cloze blank, no leaked synonym/antonym answer, length) and merges the
   passing fields into `words.json` as `themed_quest`.
4. `build-corrections.js` / `build-plain-batches.js` — retry passes that
   re-batch only the fields that failed validation; their Haiku output is
   merged the same way and overrides the originals.

`themes-lib.js` holds the shared theme keywords, descriptors and assignment
logic. Intermediate batch files are disposable and git-ignored.

### Result

1,744 of 1,755 fields (99.4%) passed validation across the generation and two
retry rounds; the 11 unfilled fields are synonym/antonym example sentences
whose only natural wording collided with a forbidden answer word, and the app
simply falls back (no example line) for those. `words.json` grew from ~163 KB
to ~352 KB. The quiz stays a static client-side app with zero runtime API cost.
`js/app.js` reads `themed_quest` only in Story Quest mode; the plain quiz and
all other screens are unchanged.
