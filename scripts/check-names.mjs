// Fails if any client module uses a name it never defines or imports.
// The Game class is assembled from method groups (src/client/game/*.js), so
// a regular type check reports thousands of `this.x` false positives; this
// script keeps only the errors that mean "this identifier does not exist".
import { spawnSync } from 'node:child_process';

const tsc = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.names.json'], { encoding: 'utf8' });
const fatal = /error TS(2304|2552|2448|2454|2588|2630):/;
const lines = (tsc.stdout + tsc.stderr).split(/\r?\n/).filter((l) => fatal.test(l));
if (lines.length) {
  console.error(lines.join('\n'));
  console.error(`\n${lines.length} undefined-name error(s)`);
  process.exit(1);
}
console.log('check-names: every identifier resolves');
