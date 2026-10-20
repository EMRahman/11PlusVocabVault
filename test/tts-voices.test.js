import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TTS_VOICE_KEY,
  TTS_VOICE_USER_KEY,
  isNaturalVoice,
  isSiriCompactVoice,
  isNoveltyVoice,
  voiceScore,
  voiceDisplayName,
  sortEnglishVoices,
  selectInitialVoice,
} from '../js/tts-voices.js';

const IOS_IPHONE_VOICES = [
  { name: 'Albert', voiceURI: 'com.apple.speech.synthesis.voice.Albert', lang: 'en-US', default: false },
  { name: 'Arthur', voiceURI: 'com.apple.ttsbundle.siri_Arthur_en-GB_compact', lang: 'en-GB', default: false },
  { name: 'Bad News', voiceURI: 'com.apple.speech.synthesis.voice.BadNews', lang: 'en-US', default: false },
  { name: 'Daniel', voiceURI: 'com.apple.ttsbundle.Daniel-compact', lang: 'en-GB', default: true },
  { name: 'Eddy (English (UK))', voiceURI: 'com.apple.eloquence.en-GB.Eddy', lang: 'en-GB', default: false },
  { name: 'Martha', voiceURI: 'com.apple.ttsbundle.siri_Martha_en-GB_compact', lang: 'en-GB', default: false },
  { name: 'Samantha', voiceURI: 'com.apple.ttsbundle.Samantha-compact', lang: 'en-US', default: false },
];

test('tts-voices: ranks Daniel (default en-GB) above iOS Siri compact (Arthur/Martha) and novelty voices', () => {
  const sorted = sortEnglishVoices(IOS_IPHONE_VOICES);
  assert.equal(sorted[0].name, 'Daniel');
  assert.equal(sorted[1].name, 'Eddy (English (UK))');
  const names = sorted.map(v => v.name);
  assert.ok(names.indexOf('Daniel') < names.indexOf('Arthur'));
  assert.ok(names.indexOf('Eddy (English (UK))') < names.indexOf('Arthur'));
  assert.ok(names.indexOf('Arthur') < names.indexOf('Albert'));
  assert.equal(isSiriCompactVoice(IOS_IPHONE_VOICES[1]), true);
  assert.equal(isNoveltyVoice(IOS_IPHONE_VOICES[0]), true);
});

test('tts-voices: defaults to browser default (voice: null) on iPhone first visit and clears legacy poisoned Arthur storage', () => {
  const sorted = sortEnglishVoices(IOS_IPHONE_VOICES);
  const firstVisit = selectInitialVoice(sorted, null, false);
  assert.equal(firstVisit.voice, null);
  assert.equal(firstVisit.targetValue, '');
  assert.equal(firstVisit.shouldClearLegacyStorage, false);

  const healed = selectInitialVoice(sorted, 'Arthur', false);
  assert.equal(healed.voice, null);
  assert.equal(healed.targetValue, '');
  assert.equal(healed.shouldClearLegacyStorage, true);
});

test('tts-voices: auto-selects genuine Natural/Neural/Online voices on desktop first visit', () => {
  const desktopVoices = [
    ...IOS_IPHONE_VOICES,
    { name: 'Microsoft Sonia Online (Natural) - English (United Kingdom)', voiceURI: 'Sonia', lang: 'en-GB', default: false },
  ];
  const sorted = sortEnglishVoices(desktopVoices);
  assert.equal(isNaturalVoice(sorted[0]), true);
  assert.equal(voiceScore(sorted[0]), 0);
  assert.equal(voiceDisplayName(sorted[0]), '★ Sonia (en-GB)');

  const sel = selectInitialVoice(sorted, null, false);
  assert.equal(sel.voice.name, 'Microsoft Sonia Online (Natural) - English (United Kingdom)');
  assert.equal(sel.targetValue, 'Microsoft Sonia Online (Natural) - English (United Kingdom)');
});

test('tts-voices: respects explicit user choice (both specific voice and Default)', () => {
  const sorted = sortEnglishVoices(IOS_IPHONE_VOICES);
  const explicitVoice = selectInitialVoice(sorted, 'Eddy (English (UK))', true);
  assert.equal(explicitVoice.voice.name, 'Eddy (English (UK))');
  assert.equal(explicitVoice.targetValue, 'Eddy (English (UK))');
  assert.equal(explicitVoice.shouldClearLegacyStorage, false);

  const explicitDefault = selectInitialVoice(sorted, '', true);
  assert.equal(explicitDefault.voice, null);
  assert.equal(explicitDefault.targetValue, '');
  assert.equal(explicitDefault.shouldClearLegacyStorage, false);
  assert.equal(TTS_VOICE_KEY, '11plus-tts-voice');
  assert.equal(TTS_VOICE_USER_KEY, '11plus-tts-voice-user');
});

test('tts-voices: handles underscore locale strings (en_GB / en_US) on older iOS versions', () => {
  const underscoreVoices = IOS_IPHONE_VOICES.map(v => ({ ...v, lang: v.lang.replace('-', '_') }));
  const sorted = sortEnglishVoices(underscoreVoices);
  assert.equal(sorted[0].name, 'Daniel');
});
