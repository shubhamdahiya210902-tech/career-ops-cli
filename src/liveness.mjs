#!/usr/bin/env node
/**
 * liveness.mjs — Job-URL liveness checker (Playwright-based).
 *
 * Classifies each URL as: active / expired / uncertain.
 * Detection: HTTP status, expired-phrase patterns in the rendered body,
 * presence of an "Apply" button, and SPA-redirect signals.
 *
 * Zero LLM calls. Zero personal data. Sequential (never parallel) — Playwright
 * anti-bot systems flag parallel navigations quickly.
 *
 * Usage:
 *   node src/liveness.mjs <url1> [url2] ...
 *   node src/liveness.mjs --file urls.txt
 *   node src/liveness.mjs --json urls.json     # [{url, company}] → annotated JSON
 */

import { chromium } from 'playwright';
import { readFile, writeFile } from 'fs/promises';

const EXPIRED_PATTERNS = [
  /job (is )?no longer available/i,
  /job.*no longer open/i,
  /position has been filled/i,
  /this job has expired/i,
  /job posting has expired/i,
  /no longer accepting applications/i,
  /this (position|role|job) (is )?no longer/i,
  /this job (listing )?is closed/i,
  /job (listing )?not found/i,
  /the page you are looking for doesn.t exist/i,
  /\d+\s+jobs?\s+found/i,
  /search for jobs page is loaded/i,
  /diese stelle (ist )?(nicht mehr|bereits) besetzt/i,
  /offre (expir\u00e9e|n'est plus disponible)/i,
];

const EXPIRED_URL_PATTERNS = [
  /[?&]error=true/i,
  /errorpage/i,
];

const APPLY_PATTERNS = [
  /\bapply\b/i,
  /\bsolicitar\b/i,
  /\bbewerben\b/i,
  /\bpostuler\b/i,
  /submit application/i,
  /easy apply/i,
  /start application/i,
  /ich bewerbe mich/i,
];

const MIN_CONTENT_CHARS = 300;

async function checkUrl(page, url) {
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const status = response?.status() ?? 0;
    if (status === 404 || status === 410) {
      return { result: 'expired', reason: `HTTP ${status}`, http_status: status, final_url: page.url() };
    }
    await page.waitForTimeout(2000); // let SPA hydrate
    const finalUrl = page.url();
    for (const p of EXPIRED_URL_PATTERNS) {
      if (p.test(finalUrl)) return { result: 'expired', reason: `redirect to ${finalUrl}`, http_status: status, final_url: finalUrl };
    }
    const body = await page.evaluate(() => document.body?.innerText ?? '');
    if (APPLY_PATTERNS.some(p => p.test(body))) {
      return { result: 'active', reason: 'apply button detected', http_status: status, final_url: finalUrl };
    }
    for (const p of EXPIRED_PATTERNS) {
      if (p.test(body)) return { result: 'expired', reason: `pattern: ${p.source}`, http_status: status, final_url: finalUrl };
    }
    if (body.trim().length < MIN_CONTENT_CHARS) {
      return { result: 'expired', reason: 'insufficient content', http_status: status, final_url: finalUrl };
    }
    return { result: 'uncertain', reason: 'no apply signal', http_status: status, final_url: finalUrl };
  } catch (e) {
    return { result: 'expired', reason: `navigation error: ${(e.message || '').split('\n')[0]}`, http_status: null, final_url: null };
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node src/liveness.mjs <url1> [url2] ...');
    console.error('       node src/liveness.mjs --file urls.txt');
    console.error('       node src/liveness.mjs --json urls.json');
    process.exit(1);
  }

  let jobs;
  let jsonOut = null;
  if (args[0] === '--file') {
    const text = await readFile(args[1], 'utf-8');
    jobs = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(url => ({ url }));
  } else if (args[0] === '--json') {
    jsonOut = args[1];
    const raw = JSON.parse(await readFile(args[1], 'utf-8'));
    jobs = Array.isArray(raw) ? raw : (raw.jobs || []);
  } else {
    jobs = args.map(url => ({ url }));
  }

  console.log(`Checking ${jobs.length} URL(s)...\n`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (compatible; CareerOpsBot/1.0)' });

  const annotated = [];
  let active = 0, expired = 0, uncertain = 0;
  for (const job of jobs) {
    const res = await checkUrl(page, job.url);
    const icon = { active: '✅', expired: '❌', uncertain: '⚠️' }[res.result];
    console.log(`${icon} ${res.result.padEnd(10)} ${job.url}`);
    if (res.result !== 'active') console.log(`   ↳ ${res.reason}`);
    annotated.push({ ...job, liveness: res });
    if (res.result === 'active') active++; else if (res.result === 'expired') expired++; else uncertain++;
  }

  await browser.close();
  console.log(`\nResults: ${active} active · ${expired} expired · ${uncertain} uncertain`);

  if (jsonOut) {
    await writeFile(jsonOut, JSON.stringify(annotated, null, 2));
    console.log(`\nAnnotated JSON written to ${jsonOut}`);
  }

  if (expired > 0) process.exit(1);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
