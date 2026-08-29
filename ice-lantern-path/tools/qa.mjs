// One command QA sweep: framing on every device, then the review states.
import { spawn } from 'node:child_process';

function run(script, args = []) {
  return new Promise((res, rej) => {
    const p = spawn('node', [script, ...args], { stdio: 'inherit', env: process.env });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`${script} exited ${c}`))));
  });
}

await run('tools/framing.mjs');
await run('tools/rotate.mjs');
await run('tools/states.mjs');
console.log('QA sweep done');
