// Download the models Pit Wall speaks and listens with into models/ (gitignored):
//  - engineer voice: Piper en_GB alba, medium (~60 MB, dataset CC BY 4.0)
//  - speech recognition for hands-free voice: streaming English zipformer 20M (~125 MB, Apache-2.0)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('models');
mkdirSync(dir, { recursive: true });

function fetchModel(label: string, name: string, url: string): void {
  if (existsSync(resolve(dir, name, 'tokens.txt'))) { console.log(`${label} already present`); return; }
  console.log(`downloading ${label} from ${url} …`);
  const archive = resolve(dir, `${name}.tar.bz2`);
  execFileSync('curl', ['-L', '--fail', '-o', archive, url], { stdio: 'inherit' });
  execFileSync('tar', ['xjf', `${name}.tar.bz2`], { cwd: dir, stdio: 'inherit' });
  rmSync(archive, { force: true });
  console.log(`${label} ready in models/${name}`);
}

fetchModel('engineer voice', 'vits-piper-en_GB-alba-medium', 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_GB-alba-medium.tar.bz2');
fetchModel('speech recognition model', 'sherpa-onnx-streaming-zipformer-en-20M-2023-02-17', 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17.tar.bz2');
