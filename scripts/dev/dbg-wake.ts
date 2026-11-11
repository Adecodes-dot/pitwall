import { WakeGate } from '../../src/voice/wake.ts';
import { normalise, wordMatch } from '../../src/voice/intent.ts';
const g = new WakeGate();
for (const t of ["engineer how's my fuel", 'how are the tires engineer', 'engineer', 'boss how is my fuel']) console.log(JSON.stringify(t), '→', JSON.stringify(g.onFinal(t, 0)), JSON.stringify(normalise(t)));
console.log(wordMatch('how', 'engineer'), wordMatch('is', 'engineer'), wordMatch('my', 'engineer'), wordMatch('fuel', 'engineer'));
