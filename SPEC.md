# Product Specification: 11+ Creative Writing Vocabulary App

## 1. Project Overview
The "11+ Vocab Builder" (Working Title: LexiLeap or WordWeaver) is a lightweight web application designed to help students prepare for their 11+ entrance exams. It provides a curated database of 200 sophisticated words specifically chosen to elevate creative writing.

## 2. Target Audience
* **Primary:** Students aged 8-11 preparing for 11+ grammar and independent school exams.
* **Secondary:** Parents and tutors looking for a reliable, structured resource.

## 3. Core Features
* **Interactive Word Grid/List:** A clean, searchable interface displaying the 200 words.
* **Simple Definitions:** Every word features a plain-English definition written specifically to be easily understood by an 8-year-old.
* **Word Detail Cards:** Clicking a word expands it to show its full profile (simple definition, sentence usage, synonyms, antonyms, and rating).
* **Search & Filter:** Users can search for a specific word or filter the list by its "Usefulness Rating."
* **Responsive Design:** Must work seamlessly on desktop, tablet, and mobile.

## 4. Data Structure (JSON Schema)
The core of the application is the 200-word dataset. Each entry in the database must follow this structure:

* `word` (String): The target vocabulary word.
* `definition` (String): A highly simplified explanation of the word, easily grasped by an 8-year-old (avoiding complex dictionary jargon).
* `sentence_usage` (String): An example sentence demonstrating how to use the word effectively in 11+ creative writing.
* `synonyms` (Array of Strings): 2-3 similar words.
* `antonyms` (Array of Strings): 2-3 opposite words.
* `usefulness_rating` (Integer 1-5): A rating out of 5 stars indicating how easily and effectively the word can be dropped into an exam story (5 = incredibly versatile).

## 5. Sample Dataset (The First 10 Words)
Below is a sample of the data to populate the app. *(Note: The full dataset will contain 200 entries following this exact format).*

### 1. Trepidation
* **Definition:** A shaky, nervous feeling that something scary is about to happen.
* **Sentence Usage:** As he pushed open the creaking door of the abandoned mansion, a wave of cold trepidation washed over him.
* **Synonyms:** Fear, anxiety, apprehension
* **Antonyms:** Confidence, bravery, calm
* **Usefulness Rating:** 5/5

### 2. Melancholy
* **Definition:** A quiet, heavy sadness that lasts a long time.
* **Sentence Usage:** The constant, drumming rain matched the melancholy mood that hung heavily over the deserted town.
* **Synonyms:** Sorrow, sadness, gloom
* **Antonyms:** Joy, cheerfulness, exuberance
* **Usefulness Rating:** 4/5

### 3. Cacophony
* **Definition:** A horrible, loud mix of messy noises.
* **Sentence Usage:** The peaceful morning was shattered by a sudden cacophony of screeching tires, blaring horns, and shouting voices.
* **Synonyms:** Din, racket, noise
* **Antonyms:** Silence, harmony, peace
* **Usefulness Rating:** 5/5

### 4. Ephemeral
* **Definition:** Something beautiful that lasts for only a very short time, like a bubble.
* **Sentence Usage:** The beautiful sunset was an ephemeral masterpiece, fading into darkness almost as quickly as it had appeared.
* **Synonyms:** Fleeting, temporary, brief
* **Antonyms:** Permanent, eternal, lasting
* **Usefulness Rating:** 3/5

### 5. Ubiquitous
* **Definition:** Something that seems to be everywhere you look.
* **Sentence Usage:** In the futuristic city, glowing neon signs were ubiquitous, illuminating every dark alley and towering skyscraper.
* **Synonyms:** Everywhere, omnipresent, universal
* **Antonyms:** Rare, scarce, uncommon
* **Usefulness Rating:** 4/5

### 6. Luminous
* **Definition:** Glowing brightly in the dark.
* **Sentence Usage:** The cave was bathed in a luminous, ethereal glow emanating from the strange crystals on the ceiling.
* **Synonyms:** Radiant, shining, glowing
* **Antonyms:** Dark, dull, gloomy
* **Usefulness Rating:** 5/5

### 7. Serpentine
* **Definition:** Twisting and turning like a moving snake.
* **Sentence Usage:** The river carved a serpentine path through the dense, unforgiving jungle.
* **Synonyms:** Winding, twisting, snake-like
* **Antonyms:** Straight, direct
* **Usefulness Rating:** 4/5

### 8. Petrified
* **Definition:** So incredibly scared that you freeze up like a stone statue.
* **Sentence Usage:** Rooted to the spot, the young boy stood entirely petrified as the shadow detached itself from the wall.
* **Synonyms:** Terrified, paralyzed, frozen
* **Antonyms:** Fearless, relaxed, unbothered
* **Usefulness Rating:** 5/5

### 9. Dilapidated
* **Definition:** Old, broken, and falling apart from being ignored for a long time.
* **Sentence Usage:** At the end of the lane sat a dilapidated cottage, its roof caved in and windows shattered by time.
* **Synonyms:** Ruined, decaying, crumbling
* **Antonyms:** Pristine, immaculate, restored
* **Usefulness Rating:** 5/5

### 10. Voracious
* **Definition:** Super hungry, like you could eat absolutely everything in sight.
* **Sentence Usage:** After wandering in the wilderness for three days, the survivor ate the berries with a voracious appetite.
* **Synonyms:** Ravenous, insatiable, greedy
* **Antonyms:** Satisfied, full, quenched
* **Usefulness Rating:** 4/5

## 6. Technical Stack Recommendations
* **Frontend:** HTML/CSS/JavaScript (Vanilla or React/Vue).
* **Backend/Data:** No complex backend required. 200 words stored in a static `words.json` file.
* **Hosting:** GitHub Pages.
