import fs from 'node:fs/promises';
import path from 'node:path';

import { runCli } from '../../../skills/project/sync-upstream-skills/scripts/sync-skills.mjs';

export async function runUpstreamSync({ session, io, repoRoot, sources, sync = runCli }) {
  const write = (text) => {
    if (io.write) io.write(text);
    else io.output.write(text);
  };
  sources ??= JSON.parse(await fs.readFile(path.join(repoRoot, 'skills/sources.json'), 'utf8')).sources;
  const ids = Object.keys(sources).sort();
  const choice = await session.select('Select upstream sources', ids.map((id) => ({ name: id })));
  if (choice.disableAll || !choice.indexes.length) return { cancelled: true };
  const selected = choice.indexes.map((index) => ids[index]);
  const checked = {};
  const applied = {};
  async function execute(command, id) {
    write(`\n${command}: ${id}\n`);
    try {
      const result = await sync([command, '--source', id], { repoRoot });
      const report = result.report.sources[id];
      write(`${JSON.stringify(report, null, 2)}\n`);
      return report;
    } catch (error) {
      const report = { status: 'failed', error: error.message };
      write(`${JSON.stringify(report)}\n`);
      return report;
    }
  }
  for (const id of selected) checked[id] = await execute('check', id);
  const updates = selected.filter((id) => checked[id].status === 'update-available');
  if (updates.length) {
    write('\nUpdates replace managed catalog content; existing mounts may observe changed source files. No force, commit, push, or mount reconciliation is performed.\n');
    if (!(await session.confirm('Apply upstream updates? [y/N]'))) return { cancelled: true, checked };
    for (const id of updates) applied[id] = await execute('apply', id);
  } else write('\nNo upstream updates available.\n');
  const exitCode = [...Object.values(checked), ...Object.values(applied)].some((report) => report.status === 'failed') ? 1 : 0;
  return { exitCode, checked, applied };
}
