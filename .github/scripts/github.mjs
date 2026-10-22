// Minimal GitHub REST helper shared by the scripts of this repository.
// Uses the global fetch of Node >= 18 and GITHUB_TOKEN when present.

const API = 'https://api.github.com';

function headers() {
  const h = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'fragment-releases',
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

/** GET a JSON endpoint. Returns `null` on 404, throws on any other error. */
export async function getJson(path) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

/** GET every page of a list endpoint (100 per page). Returns `null` on 404. */
export async function getAllPages(path) {
  const all = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const items = await getJson(`${path}${sep}per_page=100&page=${page}`);
    if (items === null) return page === 1 ? null : all;
    all.push(...items);
    if (items.length < 100) return all;
  }
}

/** GET a raw URL (no API headers needed). Returns `{status, text}`. */
export async function getRaw(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'fragment-releases' }, redirect: 'follow' });
  return { status: res.status, text: res.status === 200 ? await res.text() : '' };
}
