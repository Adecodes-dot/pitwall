import { describe, expect, it } from 'vitest';
import { TtsEngine, BANK_PHRASES, defaultModelDir, modelAvailable, pcmToWav } from './tts.ts';

const have = modelAvailable();

describe.skipIf(!have)('tts engine (needs models/vits-piper-en_GB-alba-medium)', () => {
  it('loads in a worker, primes the bank, and serves banked phrases instantly', async () => {
    const tts = new TtsEngine({ modelDir: defaultModelDir(), threads: 4 });
    await tts.start();
    try {
      const t0 = performance.now();
      const n = await tts.prime(BANK_PHRASES.slice(0, 6));
      const primeMs = performance.now() - t0;
      expect(n).toBe(6);
      expect(primeMs / n).toBeLessThan(600);
      const t1 = performance.now();
      const hit = tts.get('Yellow flag, sector three.');
      expect(hit).not.toBeNull();
      expect(performance.now() - t1).toBeLessThan(2);
      expect(hit!.durationS).toBeGreaterThan(0.8);
      expect(hit!.sampleRate).toBe(22050);
      // dynamic phrase: whole-sentence synthesis. Not on the time-critical path (coaching calls are
      // synthesised a lap ahead); the bound only guards against regressions. Measured 167 ms p95 uncontended.
      const times: number[] = [];
      for (let i = 0; i < 8; i++) { const a = performance.now(); await tts.synth(`Turn ${i + 2}, braking ${10 + i * 5} metres early.`); times.push(performance.now() - a); }
      times.sort((a, b) => a - b);
      expect(times[Math.floor(times.length * 0.95) - 1]!).toBeLessThan(500);
      const wav = pcmToWav(hit!);
      expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    } finally { await tts.stop(); }
  }, 60000);
});

describe('wav encoder', () => {
  it('writes a valid 16-bit mono header', () => {
    const wav = pcmToWav({ samples: new Int16Array([0, 1000, -1000]), sampleRate: 22050, durationS: 3 / 22050 });
    const dv = new DataView(wav.buffer);
    expect(dv.getUint32(24, true)).toBe(22050);
    expect(dv.getUint16(22, true)).toBe(1);
    expect(dv.getUint32(40, true)).toBe(6);
    expect(wav.length).toBe(50);
  });
});
