import { readPwcap } from '../../src/capture/pwcap.ts';
import { decodeF1 } from '../../src/adapters/f1/codec.ts';
const { records } = readPwcap(process.argv[2]!);
let shown = 0, last = -1; let line: string[] = [];
const start = Number(process.argv[3] ?? 150000);
for (let i = start; i < records.length && shown < 6; i++) {
  const d = decodeF1(records[i]!.data);
  if ('error' in d) { line.push(`ERR:${d.error}`); continue; }
  const h = d.kind === 'ignored' ? (d as any).header : (d as any).header;
  const tag = d.kind === 'ignored' ? `ign#${(d as any).packetId}` : d.kind;
  const fid = h?.frameIdentifier;
  if (fid !== last) { if (line.length) { console.log(`frame ${last}: ${line.join(' ')}`); shown++; } line = []; last = fid; }
  line.push(`${tag}(${h?.overallFrameIdentifier})`);
}
