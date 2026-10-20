// Pure TTS voice-ranking and selection helpers.
// Kept DOM- and storage-free so iOS/macOS/Windows voice lists can be tested under node --test.

export var TTS_VOICE_KEY      = '11plus-tts-voice';
export var TTS_VOICE_USER_KEY = '11plus-tts-voice-user';

var NOVELTY_VOICE_RE = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox)$/i;

export function isNaturalVoice(v) {
  return Boolean(v && /natural|neural|online/i.test(v.name || ''));
}

export function isSiriCompactVoice(v) {
  return Boolean(v && /\bsiri_/i.test(v.voiceURI || ''));
}

export function isNoveltyVoice(v) {
  return Boolean(v && NOVELTY_VOICE_RE.test((v.name || '').trim()));
}

// Lower score = higher quality in the voice picker.
// Neural/Natural/Online voices (Edge/Chrome desktop) rank first; on Apple
// devices where no voice name contains "Natural"/"Neural"/"Online", the
// system default / Daniel / Enhanced en-GB voices rank ahead of standard
// voices, while iOS Siri compact voices (e.g. Arthur/Martha, which appear in
// iOS Safari getVoices() even when unavailable to WebKit) and novelty voices
// rank last.
export function voiceScore(v) {
  if (!v) return 10;
  var name = v.name || '';
  var lang = v.lang || '';
  var isNatural = isNaturalVoice(v);
  var isGB = /^en[-_]GB/i.test(lang);
  var isUS = /^en[-_]US/i.test(lang);

  if (isNoveltyVoice(v))     return 9;
  if (isSiriCompactVoice(v)) return 8;
  if (isNatural && isGB)     return 0;
  if (isNatural && isUS)     return 1;
  if (isNatural)             return 2;
  if (isGB && (v.default || /enhanced|premium|daniel/i.test(name))) return 3;
  if (isGB)                  return 4;
  if (isUS && (v.default || /enhanced|premium|samantha/i.test(name))) return 5;
  if (isUS)                  return 6;
  return 7;
}

export function voiceDisplayName(v) {
  var isNatural = isNaturalVoice(v);
  var n = (v.name || '')
    .replace(/^Microsoft\s+/i, '')
    .replace(/\s+Online\s*\(Natural\)/i, '')
    .replace(/\s+Online\b/i, '')
    .replace(/\s+Neural\b/i, '')
    .replace(/\s+-\s+English.*$/i, '');
  return (isNatural ? '★ ' : '') + n + ' (' + v.lang + ')';
}

export function sortEnglishVoices(voices) {
  if (!Array.isArray(voices)) return [];
  var enVoices = voices.filter(function (v) {
    return v && /^en(?:[-_]|$)/i.test(v.lang || '');
  });
  enVoices.sort(function (a, b) {
    var diff = voiceScore(a) - voiceScore(b);
    return diff !== 0 ? diff : (a.name || '').localeCompare(b.name || '');
  });
  return enVoices;
}

// Decides which voice (if any) should be active after loading voices.
// - On Apple/mobile browsers where no Natural/Neural/Online voice exists,
//   defaults to null ("Default (browser)") unless the user explicitly chose
//   a voice in the dropdown (isUserSelected === true).
// - Heals legacy localStorage['11plus-tts-voice'] entries that were
//   auto-saved by older builds on first visit (which locked iPhones onto
//   the un-synthesizable 'Arthur' Siri voice).
export function selectInitialVoice(enVoices, savedName, isUserSelected) {
  if (!Array.isArray(enVoices) || enVoices.length === 0) {
    return { voice: null, targetValue: '', shouldClearLegacyStorage: false };
  }

  if (!isUserSelected) {
    var bestVoice = enVoices[0];
    var autoPick = isNaturalVoice(bestVoice) ? bestVoice : null;
    return {
      voice: autoPick,
      targetValue: autoPick ? autoPick.name : '',
      shouldClearLegacyStorage: savedName !== null && savedName !== undefined,
    };
  }

  if (!savedName) {
    return { voice: null, targetValue: '', shouldClearLegacyStorage: false };
  }

  var matched = enVoices.find(function (v) { return v.name === savedName; }) || null;
  return {
    voice: matched,
    targetValue: matched ? matched.name : '',
    shouldClearLegacyStorage: false,
  };
}
