// Listen-only: subscribe to the radio channel and print whatever the server replays (no commands sent).
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8787/ws');
ws.on('open', () => ws.send(JSON.stringify({ subscribe: ['radio', 'analysis'] })));
ws.on('message', (d) => { const m = JSON.parse(d); if (m.ch === 'radio') { const p = Array.isArray(m.payload) ? m.payload : [m.payload]; for (const e of p) console.log('RADIO', e.lap ?? '-', e.zone, e.priority, e.key, '|', e.text); } });
setTimeout(() => process.exit(0), 2500);
