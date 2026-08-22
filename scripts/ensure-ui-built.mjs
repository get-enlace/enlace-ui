// Makes `npm start` a true one-command experience on a fresh clone: builds
// the enlace-ui bundle only if it's missing, so the very first run doesn't
// require a separate manual `npm run build:ui` step (skipping the
// blank-page trap: @get-enlace/express serves whatever's in
// packages/enlace-ui/dist/, resolved via node_modules — see
// packages/enlace-express/src/index.ts — and there's nothing there until
// this runs at least once). Subsequent runs no-op — this does not rebuild
// on every `npm start`/`npm run dev`, only the first.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const marker = path.join(__dirname, '../packages/enlace-ui/dist/index.html');

if (existsSync(marker)) {
  process.exit(0);
}

console.log('No built enlace-ui bundle found — building it once (this only happens on first run)...');
const result = spawnSync('npm', ['run', 'build:ui'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
