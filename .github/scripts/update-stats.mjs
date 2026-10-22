// Recomputes community-plugin-stats.json from the GitHub releases of every
// plugin listed in community-plugins.json.
//
// Output shape (same as obsidian-releases):
//   { "<id>": { "downloads": <total>, "updated": <epoch ms>, "<version>": <count>, ... } }
// - per-version counts = download_count of the release's `main.js` asset, keyed by tag name;
// - `downloads` = sum of those counts;
// - `updated` = published_at of the most recent release, in epoch MILLISECONDS
//   (omitted when the repository has no release yet).
//
// Usage: node .github/scripts/update-stats.mjs [catalog] [stats]

import { readFile, writeFile } from 'node:fs/promises';
import { getAllPages } from './github.mjs';

const catalogPath = process.argv[2] ?? 'community-plugins.json';
const statsPath = process.argv[3] ?? 'community-plugin-stats.json';

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
let previous = {};
try {
  previous = JSON.parse(await readFile(statsPath, 'utf8'));
} catch {
  /* no previous stats */
}

const stats = {};
for (const entry of [...catalog].sort((a, b) => a.id.localeCompare(b.id))) {
  let releases;
  try {
    releases = await getAllPages(`/repos/${entry.repo}/releases`);
  } catch (err) {
    // Transient API error: keep the previous numbers rather than resetting them.
    console.warn(`! ${entry.id}: ${err.message}`);
    if (previous[entry.id]) stats[entry.id] = previous[entry.id];
    continue;
  }
  if (releases === null) {
    console.warn(`! ${entry.id}: repository ${entry.repo} not found`);
    releases = [];
  }

  const record = { downloads: 0 };
  const versions = {};
  let latest = 0;
  for (const release of releases) {
    if (release.draft) continue;
    const main = (release.assets ?? []).find((a) => a.name === 'main.js');
    const count = main ? main.download_count : 0;
    versions[release.tag_name] = count;
    record.downloads += count;
    const published = Date.parse(release.published_at ?? release.created_at ?? '');
    if (Number.isFinite(published) && published > latest) latest = published;
  }
  if (latest > 0) record.updated = latest;
  for (const tag of Object.keys(versions).sort()) record[tag] = versions[tag];
  stats[entry.id] = record;
  console.log(`${entry.id}: ${releases.length} release(s), ${record.downloads} download(s)`);
}

await writeFile(statsPath, JSON.stringify(stats, null, 2) + '\n');
