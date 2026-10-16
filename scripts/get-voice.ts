// Download the default engineer voice (Piper en_GB alba, medium) from the sherpa-onnx release assets.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('models');
const name = 'vits-piper-en_GB-alba-medium';
if (existsSync(resolve(dir, name, 'tokens.txt'))) { console.log('voice already present'); process.exit(0); }
mkdirSync(dir, { recursive: true });
const url = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${name}.tar.bz2`;
console.log(`downloading ${url} (~60 MB) …`);
execFileSync('curl', ['-L', '-o', resolve(dir, `${name}.tar.bz2`), url], { stdio: 'inherit' });
execFileSync('tar', ['xjf', `${name}.tar.bz2`], { cwd: dir, stdio: 'inherit' });
console.log(`voice ready in models/${name} (dataset licence CC BY 4.0, see THIRD_PARTY.md)`);
