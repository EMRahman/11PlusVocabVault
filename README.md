# 11+ Vocab Vault

**Live app: [https://emrahman.github.io/11PlusVocabVault/](https://emrahman.github.io/11PlusVocabVault/)**

A lightweight, static web app that helps students aged 8–11 prepare for 11+ entrance exams by exploring and quizzing themselves on a curated set of vocabulary words for creative writing.

## Features

### Word browsing
- **497 curated words** — chosen specifically to elevate 11+ creative writing
- **Word detail cards** — click any word to see its definition, part of speech, example sentence, synonyms, antonyms, and usefulness rating
- **Multiple meanings** — polysemous words show all their senses; tap through each one
- **Phonetic pronunciation** — shown in every word card and detail view
- **Audio pronunciation** — tap the speaker button to hear the word read aloud (British English)
- **Research links** — one-click links to Google definition and in-context example sentences

### Filtering & search
- **Search** — filter words by name in real time
- **Star filter** — narrow to words with a usefulness rating of 3, 4, or 5 stars
- **Viewed filter** — hide words you've already opened so you can focus on unfamiliar ones
- **Mastery filter** — show only New, Learning, or Mastered words

### Progress tracking (saved in browser)
- **View counts** — each word card records how many times you've opened it
- **Mastery levels** — words progress from New → Learning → Mastered based on quiz performance, stored in `localStorage`
- **Home dashboard** — mastered/learning counts, progress bar, and a cross-game daily activity streak

### Quiz mode
- Launch with the **Quiz me!** button
- **6 question types**: Mixed, Definition → word, Word → meaning, Sentence blank, Synonym match, Antonym match
- **3 lengths**: 5 quick, 10 standard, 15 challenge
- **3 word scopes**: All words, 5-star only, Weakest words (those you've got wrong most)
- **Streak counter** and **personal best** tracking
- **Miss review** at the end — see every question you got wrong with the correct answer

### Story Mode
- Launch with the **Story Mode** button
- A library of **35 hand-written short stories** that together cover the full word list — every vocabulary word appears in a story, with around 10 words per story
- Featured words are **highlighted** in the prose — tap any one for an instant definition
- Finish a story and tap **Quiz me on this story** for a quiz scoped to just that story's words
- Best score per story is saved so you can re-read and improve

### Daily News
- Launch with the **Daily News** button — a quick daily reading-and-quiz routine
- Each day the app picks **10, 15, or 20 words**, favouring new and not-yet-mastered words
- Copy the generated prompt into any web-enabled AI chat (Gemini, ChatGPT, or Claude), then
  paste back the **Newsround-style roundup of real, current news** it writes — no API key needed
- The day's words are highlighted in the article for tap-to-define reading
- A **morning quiz** on the day's words builds a daily **streak**

### Reading modes
Seven thematic reading libraries, each with a scoped follow-up quiz:

| Mode | Articles |
|------|----------|
| **History** | 40 articles on world history |
| **Money** | 16 articles on how money works |
| **Animals** | 10 wildlife articles |
| **Insects** | 10 articles on the insect world |
| **Space** | 10 space exploration articles |
| **Technology** | 10 technology articles |
| **Street Smarts** | 28 articles on real-world skills (scams, psychology, media literacy, game theory, tech) |

Featured vocabulary words are highlighted for tap-to-define reading. Each library shows collection progress ("You've read X of Y") and article read-time estimates.

### Fables
- **45 fables** from around the world with featured vocabulary highlighted
- Each fable ends with the moral and a scoped quiz

### Proverbs
- **105 proverbs** across **35 cultural collections**, each shown in its original script alongside the English translation
- Tap any featured word for an instant definition

### Comics
- **10 illustrated vocabulary comics** — short visual stories where the words appear in context

### Games
- **Word Universe** — an interactive 3D word cloud; click any word to explore it
- **Constellation Quest** — a 3D constellation-building quiz game
- **Detective Quest** — solve vocabulary-based mystery cases
- **Word Scramble** — unscramble jumbled vocabulary words against the clock
- **Flash-Blitz** — rapid-fire flashcard speed round
- **Synonym Snap** — match synonyms under time pressure
- **Word-in-the-Wild** — identify a word from a real-world context clue

### Responsive & accessible
- Works on desktop, tablet, and mobile
- Keyboard navigable, ARIA-labelled throughout

## Tech Stack

- Vanilla HTML, CSS, and JavaScript — no frameworks, no bundler, no build step
- Client-side code is organised as native ES modules (`<script type="module">`,
  `import`/`export`), served directly
- Word data and all reading content loaded from `data/*.json` at runtime
- Progress and mastery data persisted in `localStorage`
- Unit / characterization tests run on Node's built-in test runner (no dependencies)
- Hosted on GitHub Pages

## Getting Started

**Use it now** — no sign-up, no install: [https://emrahman.github.io/11PlusVocabVault/](https://emrahman.github.io/11PlusVocabVault/)

Or run it locally with any static file server (required because content is loaded via `fetch`):

```bash
git clone https://github.com/EMRahman/11PlusVocabVault.git
cd 11PlusVocabVault
npx serve .        # or: python3 -m http.server 8080
```

Then open `http://localhost:3000` (or whichever port the server reports).

> A static server is required: the app loads data files via `fetch` and
> uses native ES modules, neither of which work from a `file://` URL.

## Development

No build step or dependencies are required. The client-side code is split into
native ES modules under `js/`, loaded with `<script type="module">`.

Run the unit / characterization tests with Node's built-in test runner (Node 18+,
nothing to install):

```bash
node --test
```

## Project Structure

```
├── index.html             # App shell and all mode markup (~2k lines)
├── css/
│   └── style.css          # All styling (~5k lines)
├── build-info.js          # Generated banner (date/time); regenerated by CI
├── js/
│   ├── app.js             # Main orchestrator + all mode init functions
│   ├── data.js            # O(1) word lookup index (setWords / findWordByName)
│   ├── store.js           # Shared mutable state singletons
│   ├── storage.js         # localStorage persistence + mastery thresholds
│   ├── dom-utils.js       # Pure helpers (shuffle, pickDistractors, …)
│   ├── selection.js       # Pure selection algorithms (daily words, weakest pool)
│   ├── quiz.js            # Pure question-eligibility logic
│   ├── meanings.js        # Multi-sense word helpers (getMeanings, primaryMeaning)
│   ├── game-feedback.js   # Quiz feedback helpers (praise, scoring, tiers)
│   ├── celebrate.js       # Confetti / toast celebration layer
│   ├── progress-stats.js  # Home-dashboard stats and streak logic
│   ├── word-universe.js   # Three.js 3D word cloud
│   ├── word-quest-3d.js   # Constellation Quest 3D game
│   └── …                  # Standalone visualisations (mood-map, word-portrait, …)
├── data/
│   ├── words.json         # Word dataset (497 words)
│   ├── stories.json       # Story Mode library (35 stories)
│   ├── history.json       # History reading mode (40 articles)
│   ├── money.json         # Money reading mode (16 articles)
│   ├── animals.json       # Animals reading mode (10 articles)
│   ├── insects.json       # Insects reading mode (10 articles)
│   ├── space.json         # Space reading mode (10 articles)
│   ├── technology.json    # Technology reading mode (10 articles)
│   ├── street-smarts.json # Street Smarts reading mode (28 articles)
│   ├── fables.json        # Fables (45 fables)
│   ├── proverbs.json      # Proverbs (105 proverbs, 35 cultural collections)
│   ├── comics.json        # Comics (10 illustrated stories)
│   ├── word-positions.json         # Word Universe layout data
│   ├── word-explorer.json          # Mood map / etymology data
│   └── animal-constellations.json  # Constellation Quest data
├── test/                  # node --test characterization tests
└── SPEC.md                # Original product specification
```

## Word Data Format

Each entry in `data/words.json` follows this schema:

| Field              | Type              | Description                                      |
|--------------------|-------------------|--------------------------------------------------|
| `word`             | string            | The vocabulary word                              |
| `word_type`        | string            | Part of speech (e.g. adjective, noun, verb)      |
| `pronunciation`    | string            | Phonetic spelling                                |
| `definition`       | string            | Plain-English definition accessible to an 8-year-old |
| `sentence_usage`   | string            | Example sentence for 11+ creative writing        |
| `synonyms`         | array of strings  | 2–3 similar words                                |
| `antonyms`         | array of strings  | 2–3 opposite words                               |
| `usefulness_rating`| integer (1–5)     | How versatile the word is in exam writing        |
| `themed_quest`     | object            | Pipeline-baked Story Quest payload (`theme`, `word`, pre-blanked `sentence`; optional `synonym`/`antonym`) |
| `meanings`         | array (optional)  | Extra senses for polysemous words — each `{ word_type, definition, sentence_usage, synonyms[], antonyms[] }`; `meanings[0]` mirrors the flat fields exactly |

## Adding Words

Add entries to the `words` array in `data/words.json` following the schema above. The integrity test enforces non-empty fields, a rating of 1–5, and unique word names. `meanings[]` is optional — omit it for a single-sense word.
