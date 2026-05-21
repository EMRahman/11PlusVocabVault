# 11+ Vocab Builder

**Live app: [https://emrahman.github.io/11PlusVocabVault/](https://emrahman.github.io/11PlusVocabVault/)**

A lightweight, static web app that helps students aged 8–11 prepare for 11+ entrance exams by exploring and quizzing themselves on a curated set of vocabulary words for creative writing.

## Features

### Word browsing
- **351 curated words** — chosen specifically to elevate 11+ creative writing
- **Word detail cards** — click any word to see its definition, part of speech, example sentence, synonyms, antonyms, and usefulness rating
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

### Quiz mode
- Launch with the **Quiz me!** button
- **6 question types**: Mixed, Definition → word, Word → meaning, Sentence blank, Synonym match, Antonym match
- **3 lengths**: 5 quick, 10 standard, 15 challenge
- **3 word scopes**: All words, 5-star only, Weakest words (those you've got wrong most)
- **Streak counter** and **personal best** tracking
- **Miss review** at the end — see every question you got wrong with the correct answer

### Story Mode
- Launch with the **Story Mode** button
- A library of hand-written short stories that use vocabulary words naturally in context
- Featured words are **highlighted** in the prose — tap any one for an instant definition
- Finish a story and tap **Quiz me on this story** for a quiz scoped to just that story's words
- Best score per story is saved so you can re-read and improve

### Daily News
- Launch with the **Daily News** button — a quick daily reading-and-quiz routine
- Each day the app picks **10, 15, or 20 words**, favouring new and not-yet-mastered words
- Copy the generated prompt into any AI chat (Gemini, ChatGPT, or Claude), then paste the
  kid-friendly news article it writes back into the app — no API key needed
- The day's words are highlighted in the article for tap-to-define reading
- A **morning quiz** on the day's words builds a daily **streak**

### Responsive & accessible
- Works on desktop, tablet, and mobile
- Keyboard navigable, ARIA-labelled throughout

## Tech Stack

- Vanilla HTML, CSS, and JavaScript (no frameworks, no build step)
- Word data loaded from `data/words.json` at runtime
- Progress and mastery data persisted in `localStorage`
- Hosted on GitHub Pages

## Getting Started

**Use it now** — no sign-up, no install: [https://emrahman.github.io/11PlusVocabVault/](https://emrahman.github.io/11PlusVocabVault/)

Or run it locally with any static file server (required because word data is loaded via `fetch`):

```bash
git clone https://github.com/EMRahman/11PlusVocabVault.git
cd 11PlusVocabVault
npx serve .        # or: python3 -m http.server 8080
```

Then open `http://localhost:3000` (or whichever port the server reports).

## Project Structure

```
├── index.html        # App shell and markup
├── css/
│   └── style.css     # All styling
├── js/
│   └── app.js        # App logic
├── data/
│   ├── words.json    # Word dataset
│   └── stories.json  # Story Mode story library
└── SPEC.md           # Original product specification
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

## Adding Words

Add entries to the `words` array in `data/words.json` following the schema above.
