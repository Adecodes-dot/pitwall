const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8787/ws');
const t0 = Date.now(); let done = false;
ws.on('open', () => { ws.send(JSON.stringify({ subscribe: ['radio'] })); setTimeout(() => ws.send(JSON.stringify({ cmd: 'radio.ask', args: { text: 'radio check' } })), 300); });
ws.on('message', (d) => { const m = JSON.parse(d); if (m.ch === 'radio') { console.log('SPOKEN', JSON.stringify(m.payload && { text: m.payload.text, zone: m.payload.zone, latencyMs: m.payload.latencyMs })); done = true; ws.close(); } });
setTimeout(() => { if (!done) console.log('NOT SPOKEN within 6 s'); process.exit(0); }, 6000);
