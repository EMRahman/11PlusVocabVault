// Pure quiz question-eligibility logic, extracted from app.js so it can be
// unit-tested without a DOM (same approach as js/selection.js). These functions
// decide *which* question types a word can be asked as — both for the normal
// quiz and for Story Quest's themed clozes — and are fully deterministic (no
// RNG, no app state beyond the word object and an isQuestMode flag). The actual
// choice/distractor assembly (buildQuestion/buildRelationQuestion) still lives
// in app.js because it depends on shuffle/RNG and the live distractor pool.
'use strict';

import { getSentenceBlank } from './dom-utils.js';

// A lowercase-keyed lookup set, used to block a word/synonym from appearing as a
// distractor case-insensitively. Falsy items are ignored.
export function caseInsensitiveSet(items) {
  var set = {};
  items.forEach(function (s) { if (s) set[s.toLowerCase()] = true; });
  return set;
}

// The pre-themed, pre-blanked Story Quest payload baked into the word data, or
// null for words that were never themed.
export function getThemedQuest(wordObj) {
  return wordObj && wordObj.themed_quest ? wordObj.themed_quest : null;
}

// In Story Quest the cloze sentence is pre-themed and pre-blanked in the word
// data; elsewhere fall back to blanking the static example sentence.
export function getQuestSentenceBlank(wordObj) {
  var themed = getThemedQuest(wordObj);
  if (themed && themed.sentence) return themed.sentence;
  return getSentenceBlank(wordObj);
}

// In Story Quest, a synonym/antonym question is a themed fill-in-the-blank:
// returns { cloze, answer } when the word has a valid themed relation cloze.
export function getThemedRelation(wordObj, kind) {
  var themed = getThemedQuest(wordObj);
  var relation = themed && themed[kind];
  if (relation && typeof relation.cloze === 'string' && relation.answer) {
    return relation;
  }
  return null;
}

// True when a word's themed synonym/antonym cloze is usable as a quest
// question: its answer must be one of the word's own synonyms/antonyms,
// matching the gate buildRelationQuestion applies.
export function hasUsableThemedRelation(wordObj, kind) {
  var relation = getThemedRelation(wordObj, kind);
  if (!relation) return false;
  var positives = (kind === 'synonym' ? wordObj.synonyms : wordObj.antonyms) || [];
  return positives.indexOf(relation.answer) !== -1;
}

// The list of question types a word is eligible for. In quest mode only themed
// fill-in-the-blank clozes are played (word / synonym / antonym completing a
// themed sentence), always falling back to 'sentence'. Otherwise definition and
// word are always available, with sentence/synonym/antonym added when the word
// supports them.
export function getQuestionTypesForWord(wordObj, isQuestMode) {
  if (isQuestMode) {
    var questTypes = [];
    if (getQuestSentenceBlank(wordObj)) questTypes.push('sentence');
    if (hasUsableThemedRelation(wordObj, 'synonym')) questTypes.push('synonym');
    if (hasUsableThemedRelation(wordObj, 'antonym')) questTypes.push('antonym');
    return questTypes.length ? questTypes : ['sentence'];
  }

  var types = ['definition', 'word'];
  if (getSentenceBlank(wordObj)) {
    types.push('sentence');
  }
  if (wordObj.synonyms && wordObj.synonyms.length) {
    types.push('synonym');
  }
  if (wordObj.antonyms && wordObj.antonyms.length) {
    types.push('antonym');
  }
  return types;
}
