#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import dotenv from 'dotenv';
import Conf from 'conf';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import open from 'open';

import { parseLegacyCVFolder } from './src/onboarding.mjs';
import { autonomousScan } from './src/scanner.mjs';
import { generateApplication } from './src/factory.mjs';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = new Conf({ projectName: 'career-ops-public' });
const program = new Command();

program.name('career-ops').version('1.0.0');

program
  .command('daily')
  .description('Find 15 fresh jobs and generate 85-score packages')
  .action(async () => {
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
      choices: ['🚀 Start Daily Factory', '🛠️  Update Profile', 'Exit']
    }]);

    if (action === 'Exit') return;
    if (action === 'Update Profile') { await runInit(); return; }

    const jobs = await autonomousScan(profile, apiKey);
    console.log(`✅ Found ${jobs.length} new ${profile.targetField} opportunities!`);

    const outputDir = join(__dirname, 'output');
    if (!existsSync(outputDir)) mkdirSync(outputDir);
    
    for (const job of jobs) {
      const result = await generateApplication(job, profile, portfolio, join(__dirname, 'templates'), outputDir);
      if (result) console.log(`   - ✅ Generated: ${job.company}`);
    }

    console.log('\n🏁 Sprint Complete! Check the /output folder.');
  });

program
  .command('init')
  .description('Setup your career profile from a folder of old CVs')
  .action(async () => { await runInit(); });

async function runInit() {
  console.log('\n--- Career-Ops Onboarding Wizard ---');
  
  let apiKey = config.get('geminiApiKey') || process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.log('\n🤖 To make this completely free, we use Google Gemini.');
    console.log('I am opening your browser to Google AI Studio to get your free API Key.');
    console.log('Just login, click "Create API Key", and paste it here.');
    
    await open('https://aistudio.google.com/app/apikey');
    
    const { newApiKey } = await inquirer.prompt([
      { type: 'input', name: 'newApiKey', message: 'Paste your free Gemini API Key here:' }
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
    { type: 'input', name: 'specificRoles', message: 'Target Job Titles (comma separated):', filter: (i) => i.split(',').map(s => s.trim()) }
  ]);

  config.set('profile', answers);

  if (apiKey) {
    const portfolio = await parseLegacyCVFolder(answers.cvFolder, apiKey);
    config.set('portfolio', portfolio);
    console.log('\n✅ Career Portfolio synthesized and saved!');
  }
}

program.parse();