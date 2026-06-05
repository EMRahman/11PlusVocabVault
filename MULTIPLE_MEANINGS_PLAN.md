# Plan — Multiple Meanings per Word

Status: **proposal / not yet implemented.** This document is the design + impact
review for letting a word carry its **main meanings** (each with its own example
sentence), instead of the single sense the app stores today. No app code or data
is changed by this document.

## Decisions captured (from the requester)

- **Scope of this pass: plan only.** Write the design; change no app code or data
  yet. Implementation lands in follow-up PRs, phase by phase.
- **Quizzes & games stay on the *primary* sense for now.** Only the
  *learn / browse* surfaces (word card, word detail modal, Flash-Blitz card,
  TTS read-along) display *all* meanings. Making the quiz test a *specific* sense
  is **deferred** (see §8) because of distractor-safety risk.
- **Haiku is planned, not run here.** The generation pipeline is human-in-the-loop
  by design (paste-based, like the existing `scripts/`), so it is *scaffolded* in
  a later phase and the bulk run happens out-of-band.

---

## 1. Problem

Many 11+ words are **polysemous** — they have more than one common meaning — but
`data/words.json` stores exactly **one** `word_type` + `definition` +
`sentence_usage` + `synonyms` + `antonyms` per word, plus one `themed_quest`.

Example — today **"Objective"** only ever appears as the *adjective*:

```jsonc
{
  "word": "Objective",
  "word_type": "Adjective",
  "definition": "Based on facts and evidence rather than personal feelings or opinions.",
  "sentence_usage": "A good scientist stays objective, setting aside personal wishes …",
  "synonyms": ["Impartial", "Unbiased", "Factual"],
  "antonyms": ["Subjective", "Biased", "Emotional"]
  // … the *noun* sense ("a goal you are trying to achieve") is missing entirely.
}
```

A child studying for the 11+ needs both senses (the adjective *and* the goal/aim
noun), each with its own kid-friendly example sentence.

---

## 2. The governing architectural constraint: the word **name** is the primary key

This is the single most important fact for the design. Across every subsystem, a
word is identified by its **`word` string**, and the code assumes that string maps
to **one** record:

| Subsystem | Keyed by word name | Evidence |
|---|---|---|
| Corpus lookup | `wordIndex` is a `Map` keyed by name; **first occurrence wins, duplicates are silently dropped** | `js/data.js:12-25` |
| Mastery / quiz history | `mastery[w.word]` | `js/store.js:14`, `js/storage.js:52-69` |
| View counts | `viewCounts[w.word]` | `js/store.js:11`, `js/storage.js:34-37` |
| Word Explorer data | `mood` / `etymology` / `popularity` objects keyed by name | `data/word-explorer.json` |
| 3D / map layouts | positions keyed by name | `data/word-positions.json`, `data/animal-constellations.json` |
| Data integrity | **word names must be unique** | `test/data-integrity.test.js:77-86` |

**Consequence:** we **cannot** represent a second meaning by adding a second
`"Objective"` row — it would be hidden by `findWordByName`, collide in
`mastery`/`viewCounts`, and fail the uniqueness test. **Multiple meanings must
live *inside* the single word record.**

---

## 3. Proposed data model — additive `meanings[]`, flat fields mirror the primary

Add a `meanings[]` array to each word. Keep the existing top-level
`word_type` / `definition` / `sentence_usage` / `synonyms` / `antonyms` as a
**verbatim mirror of `meanings[0]`** — the "primary" sense. `themed_quest` stays
one-per-word (it is built from the primary sense; see §4 / §6).

```jsonc
{
  "word": "Objective",
  "pronunciation": "ob-JEK-tiv",
  "usefulness_rating": 4,

  // ── PRIMARY sense — mirror of meanings[0]. Every current consumer keeps
  //    reading these unchanged, so nothing breaks on day one. ──
  "word_type": "Adjective",
  "definition": "Based on facts and evidence rather than personal feelings or opinions.",
  "sentence_usage": "A good scientist stays objective, setting aside personal wishes …",
  "synonyms": ["Impartial", "Unbiased", "Factual"],
  "antonyms": ["Subjective", "Biased", "Emotional"],

  // ── NEW: the full set of senses, most-important-first. meanings[0] === primary. ──
  "meanings": [
    {
      "word_type": "Adjective",
      "definition": "Based on facts and evidence rather than personal feelings or opinions.",
      "sentence_usage": "A good scientist stays objective, setting aside personal wishes …",
      "synonyms": ["Impartial", "Unbiased", "Factual"],
      "antonyms": ["Subjective", "Biased", "Emotional"]
    },
    {
      "word_type": "Noun",
      "definition": "A goal or aim that you are trying to achieve.",
      "sentence_usage": "Our main objective was to reach the summit before noon.",
      "synonyms": ["Goal", "Aim", "Target"],
      "antonyms": []          // many noun senses have no natural antonym — allowed for non-primary senses
    }
  ],

  "themed_quest": { /* unchanged — one per word, built from the primary sense */ }
}
```

### Why this shape

- **Zero-regression migration.** ~30 read sites in `js/app.js` plus 5
  visualisation files read the *flat* fields (see §5). Mirroring `meanings[0]`
  onto them means they keep working untouched; surfaces are upgraded to be
  meaning-aware **one at a time**, each behind tests.
- **Primary key preserved.** One record per name → `findWordByName`, `mastery`,
  `viewCounts`, explorer data, and the uniqueness test are all unaffected.
- **Mastery stays per-word, not per-sense.** Pedagogically fine — "you've learned
  the word *Objective*." (Per-sense mastery would multiply the `localStorage`
  schema and is explicitly out of scope.)

### Rejected alternative — one row per sense

Splitting into `"Objective (adj.)"` / `"Objective (noun)"` rows (or duplicate
`"Objective"` rows) was rejected: it breaks the primary-key invariant in §2,
fragments mastery/progress, and forces a rename of the on-screen word. Not viable.

---

## 4. Migration / phasing

| Phase | What | App-code risk | In this pass? |
|---|---|---|---|
| **A. Schema + safety net** | Add `meanings[]` to every word (initially `[primary]` for mono-sense words via a one-time `scripts/init-meanings.js`); extend `test/data-integrity.test.js`; add a pure `js/meanings.js` helper + characterization tests; update docs. | None (additive) | **No — planned** |
| **B. Learn/browse surfaces show all senses** | Word card, word detail modal, Flash-Blitz back, TTS read-along iterate `meanings[]`. | Low (display only) | **No — planned** |
| **C. Haiku augmentation** | `scripts/build-meanings-prompts.js` + `scripts/merge-meanings.js`; bulk Haiku run; only *append* new senses, never clobber curated primaries. | None (offline data) | **No — planned** |
| **D. Meaning-aware quizzes** (deferred) | Quiz/Story Quest test a chosen sense with distractor-safety. | **High** | **No — deferred (§8)** |

Phases A→C are independent of D. The requester chose to keep quizzes on the
primary sense, so D is documented for readiness but not scheduled.

---

## 5. Impact review — every dependent surface

Read sites were mapped across `js/app.js`, `js/dom-utils.js`,
`js/word-universe.js`, `js/word-quest-3d.js`, `js/mood-map.js`,
`js/word-portrait.js`, `js/word-roots-garden.js`, `js/animal-constellation.js`.

### 5.1 Becomes meaning-aware (Phase B — the actual feature)

| Surface | Today | Change | Key refs |
|---|---|---|---|
| **Word card** (browse/filter) | one definition under the word | render each sense (POS chip + definition) | `js/app.js:636-690` |
| **Word detail modal** | one definition, sentence, syn/ant list | section per sense; pronunciation + rating stay word-level | `js/app.js:798-826` |
| **Flash-Blitz card back** | one definition/sentence/synonyms | list all senses | `js/app.js:4130-4135` |
| **TTS read-along** | reads word + one definition + one sentence | read each sense | `js/app.js:62, 83-84` |

### 5.2 Stays on the primary sense (no change needed — flat fields preserved)

| Surface | Why it stays primary | Key refs |
|---|---|---|
| **Quiz / Story Quest** | requester chose primary-only; 1:1 word↔definition; `pickDistractors` matches the single `word_type`; `themed_quest` is one-per-word | `js/app.js:1339-1575`, `js/dom-utils.js:36-53` |
| **Synonym Snap / Detective** | need both synonyms *and* antonyms — the primary sense supplies both | `js/app.js:3486-3540, 4373-4430` |
| **Scramble / Wild** | use definition as a hint / cloze from one sentence | `js/app.js:3818, 4736-4894` |
| **Word Universe / Mood Map / Word Portrait / Roots Garden / Constellations** | colour/size/position by a *single* `word_type` & `usefulness_rating`; explorer data is per-word, not per-sense | `word-universe.js:178-182`, `mood-map.js:94-95`, `word-portrait.js:183-345`, `word-quest-3d.js:51-259`, `animal-constellation.js:73-74` |

### 5.3 Not affected at all

- **`data/word-explorer.json`** (mood/etymology/popularity) — keyed per word, one
  entry per name; a word having two senses doesn't change its etymology/mood dot.
- **Mastery / view counts / all `localStorage`** — per word name (§2).
- **Cache-busting** — `update-build-info.yml` stamps `?v=` on `<script>` tags only,
  never on fetched JSON, so a bigger `words.json` needs no build change (CLAUDE.md
  Gotcha #2).

### 5.4 Notable single-sense assumptions to keep in mind

- `pickDistractors` (`js/dom-utils.js:36-53`) prefers distractors whose
  `word_type` equals the correct word's — it reads the **single** primary
  `word_type`. Fine while quizzes stay primary; central to the §8 hazard if D ships.
- `getSentenceBlank` (`js/dom-utils.js:58-68`) blanks the **first** match in the
  **single** `sentence_usage`. A meaning-aware cloze (Phase D) must pass the chosen
  sense's sentence in explicitly.

---

## 6. Haiku generation pipeline (Phase C — planned, mirrors existing `scripts/`)

The repo already has the exact offline, human-in-the-loop pattern and an explicit
model tiering — *"etymology → Haiku (factual, well-bounded — bulk price wins)"*
(`scripts/build-explorer-prompts.js:11-13`). Enumerating a word's main senses is
equally well-bounded, so **Haiku** (`claude-haiku-4-5-20251001`) fits.

### New scripts (CommonJS, under `scripts/`, not shipped)

1. **`scripts/build-meanings-prompts.js`** — emits
   `scripts/meanings-prompts/meanings-NN.json` batches (≈25 words each), each with
   a ready-to-paste `prompt`, the `inputs` (word + current primary
   definition/word_type so the model doesn't re-derive it), and an empty `outputs`
   field. Prompt asks, for each word:

   > Give the **1–3 most important distinct meanings** an 11-year-old (UK 11+)
   > should know, most useful first. For each: `word_type`; a kid-friendly
   > `definition` (≤ 25 words, **must not contain the word itself or its stem**);
   > an `example` sentence (≤ 30 words, **must contain the word**); 3 `synonyms`;
   > up to 3 `antonyms` (`[]` if none is natural). Distinct senses only — don't
   > pad. Reply ONLY with JSON keyed by the exact word string.

2. **A Haiku pass** writes the JSON into each file's `outputs` (out-of-band; same
   step as today's themed/explorer batches).

3. **`scripts/merge-meanings.js`** — validates and merges into `data/words.json`:
   - Reuse the validators already proven in `scripts/merge-themed.js:22-39`
     (`containsWord`, `namesWord`, `wordCount`): example **must** contain the word;
     definition **must not** name the word/stem; length bounds.
   - Drop malformed meanings; **dedupe** by `word_type` + normalised definition.
   - **Never clobber the curated primary:** keep the existing flat fields as
     `meanings[0]`; only **append** genuinely new senses after it. Cap at 3.
   - Re-mirror flat fields ← `meanings[0]` (no-op when unchanged); **don't touch
     `themed_quest`**. Idempotent and update-in-place, like `merge-themed.js`.

   Optional pre-pass: a cheap Haiku "polysemy detector" that flags which words
   even *have* a second 11+-relevant sense, so generation only spends on those.

### Cost (mirrors `TOKEN_COST_ESTIMATE.md`, illustrative list prices — verify first)

437 words, batched ~25/call (≈18 calls). Input ≈ instruction (~260) + 25×(word +
primary def, ~35) per call; output ≈ up to 3 senses × ~55 tokens × 25 words.
Order of magnitude ≈ **250–350K tokens total → well under ~$1 on Haiku**, one-time.
Prompt-caching the shared instruction trims it further. (Consistent with the
"making this theme/■-aware is a sub-dollar one-off" findings in the cost doc; note
that doc's word count of 351 is stale — the corpus is now **437**.)

---

## 7. Safety net & tests (Phase A — the only automated guard)

`node --test` is the sole correctness check (no DOM tests), so the data guard must
grow with the schema. All changes here **add** coverage — they never weaken it, so
`test/coverage-floor.test.js` (`TEST_FLOOR=34`, `ASSERT_FLOOR=93`) only ratchets up.

1. **Extend `test/data-integrity.test.js`** (additive — existing assertions stay):
   - every word has a `meanings` array with ≥ 1 entry;
   - each meaning has non-empty `word_type`, `definition`, `sentence_usage`, and a
     non-empty `synonyms` array; `antonyms` is an array (may be **empty** for
     non-primary senses — many nouns have no natural antonym);
   - `meanings[0]` deep-equals the flat primary fields (the mirror invariant);
   - meanings are distinct, but the **sense identity is `word_type` plus
     normalised `definition`** (matching the §6 merge dedupe) — **not `word_type`
     alone**, so same-part-of-speech polysemy is allowed (e.g. two noun senses
     like *bank* = river edge / money store, or *bat* = animal / sports gear);
   - each meaning's `sentence_usage` actually contains the word.
   - The existing rule that the **primary** (flat) `synonyms`/`antonyms` are
     non-empty is **unchanged** — not relaxed.
2. **New `js/meanings.js`** (pure, importable in Node) with helpers like
   `getMeanings(word)` (always returns a normalised non-empty array, even for
   legacy records lacking `meanings`) and `primaryMeaning(word)`. Back it with
   `test/meanings.test.js` characterization tests (golden values), per the
   `selection.js` model.
3. **`scripts/init-meanings.js`** (Phase A migration) gets a small test or a
   dry-run/idempotency check so re-running it is safe.

This satisfies CLAUDE.md *Test & CI governance* ("adding/strengthening tests needs
no approval; never weaken the net").

---

## 8. Deferred: meaning-aware quizzes (Phase D) + the distractor-safety hazard

Not in scope (requester kept quizzes on the primary sense), but documented so it's
ready. If quizzes ever test a *specific* sense:

- **Distractor collision.** When asking "what does *Objective* mean?" with the
  **noun** definition as the answer, a wrong option must **not** be the word's own
  **adjective** definition (it's also correct) — and `pickDistractors` must not
  surface a distractor word whose chosen sense is a true synonym of the target
  sense. Mitigation: tag the question with the sense index and exclude the same
  word's other senses + that sense's synonyms from the distractor pool.
- **Cloze source.** A sentence-blank must come from the **chosen** sense's
  `sentence_usage`, passed explicitly into `getSentenceBlank`.
- **`themed_quest`.** It's one-per-word, built from the primary. Either keep Story
  Quest primary-only, or extend the baking pipeline to one themed quest per sense
  (larger change).
- **Mastery.** Decide whether a per-sense miss should count toward the word's
  single mastery record (recommended: yes, keep per-word).

---

## 9. File-by-file change checklist (for the implementation PRs)

**Phase A — schema + safety net**
- `scripts/init-meanings.js` *(new)* — wrap each word's flat fields into
  `meanings: [ {…} ]` when absent; idempotent.
- `data/words.json` — gains `meanings[]` on every word (initially `[primary]`).
- `test/data-integrity.test.js` — add the `meanings[]` assertions (§7).
- `js/meanings.js` *(new)* + `test/meanings.test.js` *(new)*.
- `CLAUDE.md` — update the Word-schema bullet + the data-integrity note; `SPEC.md`
  schema section.

**Phase B — display**
- `js/app.js` — word card (`~636-690`), modal (`~798-826`), Flash-Blitz
  (`~4130-4135`), TTS (`~62, 83-84`) iterate `meanings[]` via `js/meanings.js`.
- `css/style.css` — styles for the per-sense list / POS chips.
- `index.html` — only if new container markup is needed for the modal sense list.

**Phase C — Haiku pipeline**
- `scripts/build-meanings-prompts.js`, `scripts/merge-meanings.js` *(new)*.
- `data/words.json` — augmented with real extra senses (Haiku output).
- `.gitignore` — ignore `scripts/meanings-prompts/` intermediates (match existing
  `scripts/batches/` handling).

**Phase D — deferred** (see §8).

---

## 10. Risks & open questions

- **`words.json` size** grows ~30–50% for polysemous words (currently ~527 KB,
  437 words). It's fetched once by a static app — acceptable; note it.
- **How many senses to keep?** Proposed cap **3**, most-useful-first. Confirm.
- **Antonym-less senses.** Allowed for non-primary senses (`[]`); the primary keeps
  the existing non-empty guarantee. Confirm this is acceptable.
- **Stale docs.** `TOKEN_COST_ESTIMATE.md`/`SPEC.md` word counts are already stale
  (per CLAUDE.md, don't trust their numbers); `CLAUDE.md` is the authoritative
  schema doc to update.
