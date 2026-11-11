import { checkCall } from '../../src/radio/rules.ts';
for (const text of ['Lost data on that lap, ask me after the next one.', 'Nowhere big, you matched your best through every corner.', 'No reference lap yet, keep lapping.'])
  console.log(JSON.stringify(checkCall({ text, priority: 2, key: 'qa:1', reason: 'answer', facts: {}, dueAfter: 0, expiresAt: 1, immediate: false, createdAt: 0, triggerT: 0 })), text);
