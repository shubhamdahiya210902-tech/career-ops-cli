#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import dotenv from 'dotenv';
import Conf from 'conf';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawnSync } from 'child_process';
import open from 'open';

import { parseLegacyCVFolder } from './src/onboarding.mjs';
import { autonomousScan } from './src/scanner.mjs';
import { generateApplication } from './src/factory.mjs';
import { dedupJobs, readHistory } from './src/history.mjs';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = new Conf({ projectName: 'career-ops-public' });
const program = new Command();

const SCORING_DIR = join(__dirname, 'scoring');
const REWRITE_LOOP = join(SCORING_DIR, 'rewrite_loop.py');
const BUILD_EXCEL = join(SCORING_DIR, 'build_excel.py');
const LIVENESS_MJS = join(__dirname, 'src', 'liveness.mjs');
const LIVENESS_HTTP = join(SCORING_DIR, 'liveness_http.py');

program.name('career-ops').version('1.1.0');

// ---------------------------------------------------------------------------
// daily — full pipeline: scan → dedup → generate → score/rewrite → tracker
// ---------------------------------------------------------------------------
program
  .command('daily')
  .description('Scan fresh jobs, generate tailored CVs + cover letters, ATS-optimize them, and refresh the tracker.')
  .option('--skip-score', 'Skip the ATS rewrite loop', false)
  .option('--skip-tracker', 'Skip rebuilding applications.xlsx', false)
  .option('--threshold <n>', 'ATS score threshold for rewrite loop', '60')
  .action(async (opts) => {
    const profile = config.get('profile');
    const portfolio = config.get('portfolio');
    const apiKey = config.get('geminiApiKey') || process.env.GEMINI_API_KEY;

    if (!profile || !portfolio) {
      console.log('Profile incomplete. Run "init" first.');
      return;
    }

    if (!apiKey) {
      console.log('Error: GEMINI_API_KEY not found. Run "init" to set it up.');
      return;
    }

    console.log(`\n👋 Welcome back, ${profile.name}! Field: ${profile.targetField}`);

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Workflow:',
      choices: ['🚀 Start Daily Factory', '🛠️  Update Profile', 'Exit'],
    }]);

    if (action === 'Exit') return;
    if (action.includes('Update Profile')) { await runInit(); return; }

    const outputDir = join(__dirname, 'output');
    if (!existsSync(outputDir)) mkdirSync(outputDir);

    // 1. Scan
    const raw = await autonomousScan(profile, apiKey);
    console.log(`🔎 Scanner returned ${raw.length} candidates.`);

    // 2. Dedup against application history
    const jobs = dedupJobs(raw);
    const skipped = raw.length - jobs.length;
    if (skipped > 0) console.log(`↩️  Skipped ${skipped} already-applied posting(s).`);
    console.log(`✅ ${jobs.length} new ${profile.targetField} opportunities to process.`);

    // 3. Generate
    const generated = [];
    for (const job of jobs) {
      const result = await generateApplication(job, profile, portfolio, join(__dirname, 'templates'), outputDir);
      if (result) {
        console.log(`   - ✅ Generated: ${job.company} — ${job.role}`);
        generated.push({ job, result });
      }
    }

    // 4. ATS scoring + rewrite loop (per CV HTML)
    if (!opts.skipScore && generated.length > 0) {
      console.log(`\n🎯 Running ATS rewrite loop (threshold=${opts.threshold})...`);
      for (const { job, result } of generated) {
        const jdText = [job.desc, job.jd, job.role].filter(Boolean).join('\n');
        runRewriteLoop(result.cvHtmlPath, jdText, opts.threshold);
        // Re-render the PDF after the HTML was rewritten.
        try {
          execFileSync('node', [join(__dirname, 'generate-pdf.mjs'), result.cvHtmlPath, result.cvPath],
            { stdio: 'inherit' });
        } catch (e) {
          console.error(`   ⚠️  PDF re-render failed for ${job.company}: ${e.message}`);
        }
      }
    }

    // 5. Tracker
    if (!opts.skipTracker) {
      buildTracker();
    }

    console.log('\n🏁 Sprint Complete! Check the /output folder.');
  });

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
program
  .command('init')
  .description('Setup your career profile from a folder of old CVs')
  .action(async () => { await runInit(); });

// ---------------------------------------------------------------------------
// score — one-off ATS check + rewrite against a JD
// ---------------------------------------------------------------------------
program
  .command('score <cvHtml> <jd>')
  .description('Score a CV HTML against a JD (text or path) and inject missing keywords.')
  .option('--threshold <n>', 'Score threshold', '60')
  .option('--max-iter <n>', 'Max rewrite iterations', '6')
  .option('--dry-run', 'Do not modify the CV file', false)
  .action((cvHtml, jd, opts) => {
    const args = [REWRITE_LOOP, cvHtml, jd, `--threshold=${opts.threshold}`, `--max-iter=${opts.maxIter}`];
    if (opts.dryRun) args.push('--dry-run');
    runPython(args);
  });

// ---------------------------------------------------------------------------
// liveness — check whether a posting URL is still open
// ---------------------------------------------------------------------------
program
  .command('liveness <targets...>')
  .description('Check whether posting URLs are still accepting applications.')
  .option('--http', 'Use the urllib HTTP fallback (no Playwright required)', false)
  .option('--file <path>', 'Read URLs (one per line) from a file')
  .option('--json <path>', 'Read/annotate a JSON list of {url, company, ...}')
  .action((targets, opts) => {
    if (opts.http) {
      const urls = [...targets];
      if (opts.file) {
        const list = readFileSync(opts.file, 'utf8')
          .split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        urls.push(...list);
      }
      if (urls.length === 0) {
        console.error('No URLs supplied.');
        process.exit(1);
      }
      runPython([LIVENESS_HTTP, ...urls]);
      return;
    }

    const args = [LIVENESS_MJS];
    if (opts.file) args.push('--file', opts.file);
    else if (opts.json) args.push('--json', opts.json);
    else args.push(...targets);
    const r = spawnSync('node', args, { stdio: 'inherit' });
    if (r.status && r.status !== 0) process.exit(r.status);
  });

// ---------------------------------------------------------------------------
// tracker — rebuild output/applications.xlsx
// ---------------------------------------------------------------------------
program
  .command('tracker')
  .description('Export the application history to an Excel tracker.')
  .option('--out <path>', 'Output .xlsx path')
  .action((opts) => {
    const history = readHistory();
    console.log(`📒 ${history.length} application(s) on record.`);
    buildTracker(opts.out);
  });

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function pythonBin() {
  return process.env.PYTHON || process.env.PYTHON3 || 'python3';
}

function runPython(args) {
  const r = spawnSync(pythonBin(), args, { stdio: 'inherit' });
  if (r.error) {
    console.error(`❌ Could not launch Python (${pythonBin()}): ${r.error.message}`);
    process.exit(1);
  }
  if (r.status && r.status !== 0) process.exit(r.status);
}

function runRewriteLoop(cvHtmlPath, jdText, threshold) {
  // Pass the JD as a file to avoid shell-arg size limits.
  const tmp = join(__dirname, 'output', `.jd-${Date.now()}.txt`);
  writeFileSync(tmp, jdText || '');
  try {
    execFileSync(pythonBin(), [REWRITE_LOOP, cvHtmlPath, tmp, `--threshold=${threshold}`],
      { stdio: 'inherit' });
  } catch (e) {
    console.error(`   ⚠️  ATS rewrite failed for ${cvHtmlPath}: ${e.message}`);
  }
}

function buildTracker(outPath) {
  const args = [BUILD_EXCEL];
  if (outPath) args.push('--out', outPath);
  try {
    execFileSync(pythonBin(), args, { stdio: 'inherit' });
  } catch (e) {
    console.error(`⚠️  Tracker build failed: ${e.message}`);
  }
}

async function runInit() {
  console.log('\n--- Career-Ops Onboarding Wizard ---');

  let apiKey = config.get('geminiApiKey') || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.log('\n🤖 To make this completely free, we use Google Gemini.');
    console.log('I am opening your browser to Google AI Studio to get your free API Key.');
    console.log('Just login, click "Create API Key", and paste it here.');

    await open('https://aistudio.google.com/app/apikey');

    const { newApiKey } = await inquirer.prompt([
      { type: 'input', name: 'newApiKey', message: 'Paste your free Gemini API Key here:' },
    ]);

    // Strip whitespace AND any non-printable/newline chars so a multi-line
    // paste can't inject additional KEY=VALUE lines into the .env file.
    const cleanKey = (newApiKey || '').replace(/[^\x20-\x7E]/g, '').trim();
    if (cleanKey) {
      apiKey = cleanKey;
      config.set('geminiApiKey', apiKey);
      // Optionally write to .env for persistence across environments.
      // File is created with 0600 so other local users can't read it.
      writeFileSync(join(__dirname, '.env'), `GEMINI_API_KEY=${apiKey}\n`, { mode: 0o600 });
    } else {
      console.log('⚠️ Skipping API Key setup. CV parsing and scanning will be disabled.');
      return;
    }
  }

  const answers = await inquirer.prompt([
    { type: 'input', name: 'name', message: 'Full Name:', default: config.get('profile.name') },
    { type: 'input', name: 'email', message: 'Email:', default: config.get('profile.email') },
    { type: 'input', name: 'location', message: 'Target Region (e.g. Munich, Remote DE):', default: 'Germany' },
    { type: 'input', name: 'cvFolder', message: 'Path to folder containing your old CVs:', validate: (i) => existsSync(i) || 'Folder not found!' },
    { type: 'input', name: 'targetField', message: 'Your Main Field (e.g. Data Science, Marketing):' },
    { type: 'input', name: 'specificRoles', message: 'Target Job Titles (comma separated):', filter: (i) => i.split(',').map(s => s.trim()) },
  ]);

  config.set('profile', answers);

  if (apiKey) {
    const portfolio = await parseLegacyCVFolder(answers.cvFolder, apiKey);
    config.set('portfolio', portfolio);
    console.log('\n✅ Career Portfolio synthesized and saved!');
  }
}

program.parse();
