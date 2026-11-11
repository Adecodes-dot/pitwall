import { describe, expect, it } from 'vitest';
import { classify, normalise, wordMatch } from './intent.ts';
import type { Intent } from './intent.ts';

// How a driver actually talks: no fixed phrases, any word order, fillers, plural/typo variants.
const CASES: [string, Intent | null][] = [
  // fuel
  ["how's my fuel", 'fuel'], ['do I have enough fuel to finish', 'fuel'], ['what is the fuel situation', 'fuel'], ['am I running out of petrol', 'fuel'], ['fuel check please', 'fuel'], ['how much gas have I got left', 'fuel'], ['tell me about my tank', 'fuel'],
  // tyres
  ['how are the tyres', 'tyres'], ['how are my tires holding up', 'tyres'], ['what is the tire wear like', 'tyres'], ['are the fronts getting hot', null], ['how is the rubber', 'tyres'], ['how bad is the degradation', 'tyres'],
  // losing time
  ['where am I losing time', 'losing'], ['where am I slow', 'losing'], ['what should I work on', 'losing'], ['where can I go faster', 'losing'], ['any tips', 'losing'], ['give me something to improve', 'losing'], ['where is the time', 'losing'], ['what are my weak corners', 'losing'], ['am I making mistakes', 'losing'],
  // best / last lap
  ["what's my best lap", 'best'], ['what is my fastest time', 'best'], ['what is my pb', 'best'], ['how was that lap', 'lap'], ['what was my last lap', 'lap'], ['how did I do on that one', 'lap'], ['what was that lap time', 'lap'], ['what was the previous lap', 'lap'],
  // other data
  ['am I being consistent', 'consistency'], ['how is my rhythm', 'consistency'], ['what position am I in', 'position'], ['where am I', 'position'], ['what place am I', 'position'],
  ['how many laps left', 'laps-left'], ['how many laps to go', 'laps-left'], ['how long to go', 'laps-left'], ['laps remaining', 'laps-left'],
  ['what track is this', 'track'], ['how many corners are there', 'track'], ['any flags', 'flags'], ['is there a yellow', 'flags'], ['is the safety car out', 'flags'],
  ['what is the gap ahead', 'gap'], ['is it going to rain', 'weather'], ['what is the weather doing', 'weather'],
  ['radio check', 'radio-check'], ['radio chick', 'radio-check'], ['radio chuck', 'radio-check'], ['a radio check please', 'radio-check'], ['can you hear me', 'radio-check'], ['are you there', 'radio-check'], ['thanks', 'thanks'], ['copy that', 'thanks'],
  // commands
  ['say that again', 'repeat'], ['what did you say', 'repeat'], ['repeat', 'repeat'], ['come again', 'repeat'], ['sorry say again', 'repeat'],
  ['be quiet', 'mode-quiet'], ['talk less', 'mode-quiet'], ['less chatter please', 'mode-quiet'], ['only the important stuff', 'mode-quiet'],
  ['talk more', 'mode-coach'], ['coach me', 'mode-coach'], ['give me more feedback', 'mode-coach'], ['help me improve', 'mode-coach'],
  ['normal mode', 'mode-normal'], ['back to normal', 'mode-normal'],
  ['mute', 'mute'], ['stop talking', 'mute'], ['shut up', 'mute'], ['unmute', 'unmute'], ['you can talk now', 'unmute'], ['talk to me', 'unmute'],
  // what the recogniser actually produced for these in the probe
  ['ineer has my fuel', 'fuel'], ['he engineer where am i loosen time', 'losing'], ['engineer taught to me less', 'mode-quiet'], ['engineer how many luts to go', 'laps-left'], ['how are the tires engineer', 'tyres'],
  ['engineer talklace', 'mode-quiet'], ['talkmore please', 'mode-coach'], ['he engineer where amalising time', 'losing'],
  ['he engineer how i attires', 'tyres'], ['engineer give me more feet back', 'mode-coach'], ['engineer what was my last love', 'lap'], ['has my feudal', 'fuel'],
  // the driver's own voice in the Miami race (2026-11-08): "how is my fuel" and "tyre wear" as heard
  ['how is my few', 'fuel'], ['how is my sioux', 'fuel'], ['how is my well', 'fuel'], ['toura', 'tyres'], ['tie away', 'tyres'], ['how am i tires', 'tyres'],
  ['talk less said his high preson driving', 'mode-quiet'], ['a few laps to go', 'laps-left'], ['how many laps left a few', 'laps-left'],
  // not racing
  ['what should I have for dinner', null], ['the cat is on the sofa', null], ['', null],
];

describe('intent matching on natural phrasing', () => {
  // the "null" cases above are deliberate: phrasings we do NOT claim to understand (the engineer asks the
  // driver to say it again instead of guessing)
  for (const [text, want] of CASES) it(`"${text}" → ${want}`, () => expect(classify(text)).toBe(want));
});

describe('building blocks', () => {
  it('folds contractions, plurals and tyre spellings', () => {
    expect(normalise("How's my TIRES?")).toEqual(['how', 'is', 'my', 'tyre']);
    expect(normalise("Don't")).toEqual(['do', 'not']);
  });
  it('tolerates one ASR typo in long words but not short ones', () => {
    expect(wordMatch('consistant', 'consistent')).toBe(true);
    expect(wordMatch('fuels', 'fuel')).toBe(true);
    expect(wordMatch('fool', 'fuel')).toBe(false);
    expect(wordMatch('lab', 'lap')).toBe(false);
  });
});
