# 11+ Vocab Builder

A lightweight, static web app that helps students aged 8–11 prepare for 11+ entrance exams by exploring a curated set of 210 sophisticated vocabulary words for creative writing.

## Features

- **210 curated words** — chosen specifically to elevate 11+ creative writing
- **Word detail cards** — click any word to see its definition, example sentence, synonyms, antonyms, and usefulness rating
- **Pronunciation guide** — phonetic spelling for every word
- **Search** — filter words by name in real time
- **Rating filter** — narrow the list to words with a specific usefulness rating (1–5 stars)
- **No server required** — works when opened directly as a local HTML file
- **Responsive** — works on desktop, tablet, and mobile

## Tech Stack

- Vanilla HTML, CSS, and JavaScript (no frameworks, no build step)
- Word data embedded directly in `js/app.js` for zero-dependency usage
- Hosted on GitHub Pages

## Getting Started

Clone the repo and open `index.html` in any browser — no installation needed.

```bash
git clone https://github.com/EMRahman/11PlusVocabVault.git
cd 11PlusVocabVault
open index.html
```

## Project Structure

```
├── index.html        # App shell and markup
├── css/
│   └── style.css     # All styling
├── js/
│   └── app.js        # App logic + embedded word data
├── data/
│   └── words.json    # Word dataset (reference copy)
└── SPEC.md           # Original product specification
```

## Word Data Format

Each word entry follows this schema:

| Field              | Type              | Description                                      |
|--------------------|-------------------|--------------------------------------------------|
| `word`             | string            | The vocabulary word                              |
| `pronunciation`    | string            | Phonetic spelling                                |
| `definition`       | string            | Plain-English definition accessible to an 8-year-old |
| `sentence_usage`   | string            | Example sentence for 11+ creative writing        |
| `synonyms`         | array of strings  | 2–3 similar words                                |
| `antonyms`         | array of strings  | 2–3 opposite words                               |
| `usefulness_rating`| integer (1–5)     | How versatile the word is in exam writing        |

## Adding Words

Extend the `WORDS` array in `js/app.js` following the schema above. Update `data/words.json` to keep the reference copy in sync.
