/**
 * history.mjs — Application history + dedup ledger.
 *
 * Persists a JSON record of every generated CV/CL pair so the daily run
 * can skip jobs that were already produced (by URL or by company+role
 * fingerprint). Pure local file I/O — no network, no telemetry.
 *
 * Shape on disk (storage/application_history.json):
 *   {
 *     "version": 1,
 *     "entries": [
 *       { slug, company, role, archetype, url, key, generatedAt,
 *         cvPath, clPath, cvHtmlPath, clHtmlPath }
 *     ]
 *   }
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STORAGE_DIR = join(__dirname, '..', 'storage');
const HISTORY_FILE = join(STORAGE_DIR, 'application_history.json');

function ensureDir() {
  if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!existsSync(HISTORY_FILE)) return { version: 1, entries: [] };
  try {
    const raw = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return { version: 1, entries: [] };
    if (!Array.isArray(raw.entries)) raw.entries = [];
    return raw;
  } catch {
    return { version: 1, entries: [] };
  }
}

function save(db) {
  ensureDir();
  writeFileSync(HISTORY_FILE, JSON.stringify(db, null, 2));
}

/** Normalize a string for fuzzy comparison. */
function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

/**
 * Build a stable dedup key for a job posting. Prefers the URL (after
 * stripping tracking params), falls back to company + role.
 */
export function jobKey(job) {
  const url = job?.link || job?.url || '';
  if (url) {
    try {
      const u = new URL(url);
      // Drop tracking params that change between visits.
      for (const k of [...u.searchParams.keys()]) {
        if (/^utm_|^gh_src$|^gclid$|^fbclid$|^src$/i.test(k)) u.searchParams.delete(k);
      }
      u.hash = '';
      return `url:${u.toString().toLowerCase()}`;
    } catch {
      return `url:${url.toLowerCase()}`;
    }
  }
  return `cr:${norm(job?.company)}::${norm(job?.role)}`;
}

/** Return the set of all dedup keys currently on disk. */
export function loadKnownKeys() {
  const db = load();
  return new Set(db.entries.map(e => e.key).filter(Boolean));
}

/** True if we've already generated an application for this job. */
export function isAlreadyApplied(job) {
  return loadKnownKeys().has(jobKey(job));
}

/**
 * Filter a freshly-scraped job list down to jobs we haven't generated yet.
 * Also dedups within the input list itself (in case the scanner returned
 * the same posting via two boards).
 */
export function dedupJobs(jobs) {
  const known = loadKnownKeys();
  const seen = new Set();
  const out = [];
  for (const j of jobs || []) {
    const k = jobKey(j);
    if (known.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(j);
  }
  return out;
}

/** Append a generated application to the history ledger. */
export function recordApplication(entry) {
  const db = load();
  const key = entry.key || jobKey({ link: entry.url, company: entry.company, role: entry.role });
  // Replace any prior entry with the same key so the file doesn't grow
  // unbounded if the user re-runs against the same job.
  db.entries = db.entries.filter(e => e.key !== key);
  db.entries.push({
    slug: entry.slug,
    company: entry.company || '',
    role: entry.role || '',
    archetype: entry.archetype || '',
    url: entry.url || '',
    key,
    generatedAt: entry.generatedAt || new Date().toISOString(),
    cvPath: entry.cvPath || '',
    clPath: entry.clPath || '',
    cvHtmlPath: entry.cvHtmlPath || '',
    clHtmlPath: entry.clHtmlPath || '',
  });
  save(db);
  return key;
}

/** Read the full history (for tracker export). */
export function readHistory() {
  return load().entries.slice();
}
