// Validates community-plugins.json.
//
// 1. Structure of the WHOLE file: a JSON array; every entry has non-empty string
//    fields id, name, author, description, repo; ids are unique and match
//    ^[a-z0-9-]+$; repo matches owner/name.
// 2. For entries ADDED compared to the base version of the file (new ids), the
//    plugin repository is checked on GitHub: it exists, has README.md and
//    manifest.json at HEAD, its latest release has `main.js` and `manifest.json`
//    assets, and the release's manifest.json has the same `id` and a `version`
//    equal to the release tag (no leading `v`).
//
// Usage:
//   node .github/scripts/validate-plugin-entry.mjs [--file community-plugins.json]
//        [--base <path to the base branch's file>] [--all]
//   --base omitted -> no entry counts as added (structure only);
//   --all          -> every entry counts as added.

import { readFile } from 'node:fs/promises';
import { getJson, getRaw } from './github.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const file = arg('--file') ?? 'community-plugins.json';
const basePath = arg('--base');
const checkAll = process.argv.includes('--all');

const errors = [];
const fail = (msg) => errors.push(msg);

function parse(text, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err.message}`);
  }
}

const FIELDS = ['id', 'name', 'author', 'description', 'repo'];
const ID_RE = /^[a-z0-9-]+$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

// ── 1. Structure ────────────────────────────────────────────────────────────
const entries = parse(await readFile(file, 'utf8'), file);
if (!Array.isArray(entries)) {
  console.error(`${file} must be a JSON array.`);
  process.exit(1);
}

const seen = new Set();
entries.forEach((entry, index) => {
  const where = `Entry #${index + 1}${entry && typeof entry.id === 'string' ? ` (${entry.id})` : ''}`;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    fail(`${where}: must be an object.`);
    return;
  }
  for (const field of FIELDS) {
    if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
      fail(`${where}: "${field}" must be a non-empty string.`);
    }
  }
  if (typeof entry.id === 'string') {
    if (!ID_RE.test(entry.id)) fail(`${where}: "id" must match ${ID_RE} (lowercase letters, digits, dashes).`);
    if (seen.has(entry.id)) fail(`${where}: duplicate id "${entry.id}".`);
    seen.add(entry.id);
  }
  if (typeof entry.repo === 'string' && !REPO_RE.test(entry.repo)) {
    fail(`${where}: "repo" must be "owner/name" (got "${entry.repo}").`);
  }
});

// ── 2. Added entries ────────────────────────────────────────────────────────
let added = [];
if (checkAll) {
  added = entries;
} else if (basePath) {
  let baseIds = new Set();
  try {
    const base = parse(await readFile(basePath, 'utf8'), basePath);
    if (Array.isArray(base)) baseIds = new Set(base.map((e) => e && e.id));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  added = entries.filter((e) => e && typeof e.id === 'string' && !baseIds.has(e.id));
}

async function checkRepository(entry) {
  const where = `${entry.id} (${entry.repo})`;
  if (!REPO_RE.test(entry.repo)) return; // already reported

  const repo = await getJson(`/repos/${entry.repo}`);
  if (!repo) {
    fail(`${where}: repository not found or not public.`);
    return;
  }

  const raw = (path) => `https://raw.githubusercontent.com/${entry.repo}/HEAD/${path}`;
  if ((await getRaw(raw('README.md'))).status !== 200) fail(`${where}: README.md is missing at the root of the default branch.`);
  if ((await getRaw(raw('manifest.json'))).status !== 200) fail(`${where}: manifest.json is missing at the root of the default branch.`);

  const release = await getJson(`/repos/${entry.repo}/releases/latest`);
  if (!release) {
    fail(`${where}: no published release. Create a GitHub release whose tag is the plugin version (e.g. 1.0.0, no "v") with main.js and manifest.json attached.`);
    return;
  }
  const tag = release.tag_name;
  const assets = new Map((release.assets ?? []).map((a) => [a.name, a]));
  for (const name of ['main.js', 'manifest.json']) {
    if (!assets.has(name)) fail(`${where}: latest release "${tag}" has no "${name}" asset.`);
  }
  if (!assets.has('manifest.json')) return;

  const res = await getRaw(`https://github.com/${entry.repo}/releases/download/${tag}/manifest.json`);
  if (res.status !== 200) {
    fail(`${where}: could not download manifest.json of release "${tag}" (HTTP ${res.status}).`);
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(res.text);
  } catch {
    fail(`${where}: manifest.json of release "${tag}" is not valid JSON.`);
    return;
  }
  if (manifest.id !== entry.id) fail(`${where}: manifest.json id is "${manifest.id}", expected "${entry.id}".`);
  if (manifest.version !== tag) {
    fail(`${where}: release tag "${tag}" must equal manifest.json version "${manifest.version}" (no leading "v").`);
  }
}

for (const entry of added) {
  try {
    await checkRepository(entry);
  } catch (err) {
    fail(`${entry.id}: ${err.message}`);
  }
}

console.log(`Checked ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}; added: ${added.length ? added.map((e) => e.id).join(', ') : 'none'}.`);
if (errors.length) {
  console.error(errors.map((e) => `- ${e}`).join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Plugin entry validation failed\n\n${errors.map((e) => `- ${e}`).join('\n')}\n`);
  }
  process.exit(1);
}
console.log('All checks passed.');
