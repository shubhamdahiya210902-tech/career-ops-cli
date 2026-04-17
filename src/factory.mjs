/**
 * factory.mjs — Tailored CV + cover letter generator.
 *
 * For each job:
 *   1. Pick the archetype-specific summary from the user portfolio.
 *   2. Score-rank the user's projects against the JD (shared word overlap)
 *      and select the top 4 — no project ever dominates every CV.
 *   3. Render the Bosch-style CV template with categorized skills + a
 *      "Targeted Tools" anchor row that the scoring/rewrite_loop.py can
 *      safely inject JD keywords into without breaking layout.
 *   4. Emit HTML (always) and PDF (via generate-pdf.mjs).
 *   5. Record the run in storage/application_history.json for dedup.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { recordApplication } from './history.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PDF_GENERATOR = join(__dirname, '..', 'generate-pdf.mjs');

/** Normalize a company-like string into a filesystem-safe slug. */
function safeSlug(raw) {
  return String(raw || 'job')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'job';
}

const STOPWORDS = new Set((
  'a an and are as at be by for from has have in into is it its of on or our '
  + 'that the this to we with will your you'
).split(' '));

function tokens(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9+#.-]{2,}/g) || [];
}

/** Rank projects by overlap between project keywords and JD keywords. */
function pickProjects(projects, jdText, n = 4) {
  if (!Array.isArray(projects) || projects.length === 0) return [];
  const jdSet = new Set(tokens(jdText).filter(t => !STOPWORDS.has(t)));
  const scored = projects.map(p => {
    const blob = [p.title, p.description, ...(p.bullets || [])].filter(Boolean).join(' ');
    const pSet = new Set(tokens(blob).filter(t => !STOPWORDS.has(t)));
    let overlap = 0;
    for (const t of pSet) if (jdSet.has(t)) overlap++;
    return { p, overlap };
  });
  scored.sort((a, b) => b.overlap - a.overlap);
  return scored.slice(0, n).map(s => s.p);
}

/**
 * Normalize the user's skill list into the Bosch-style categorized grid.
 * Accepts either a flat array of strings (then auto-categorized) or an
 * already-categorized object shape { programming: [...], frameworks: [...] }.
 */
function formatSkills(skills) {
  const cats = {
    Programming: /^(python|java|javascript|typescript|go|rust|c\+\+|c#|c|sql|ruby|php|kotlin|swift|scala|r|bash|shell)$/i,
    Frameworks: /^(react|angular|vue|nextjs|express|spring|django|flask|fastapi|rails|laravel|tensorflow|pytorch|playwright|selenium|jest|pytest|node\.?js|nest\.?js)$/i,
    'Cloud & Infra': /^(aws|gcp|azure|kubernetes|docker|terraform|ansible|linux|vmware|ec2|s3|rds|lambda|eks|gke|helm|istio|serverless|mariadb|postgres(ql)?|mysql|mongodb|redis|elastic(search)?)$/i,
    'AI / ML': /^(tensorflow|pytorch|scikit.*|keras|pandas|numpy|scipy|llm|transformer|bert|gpt|rag|gemini|anthropic|openai|huggingface|ollama|langchain)$/i,
    Security: /^(oauth|saml|jwt|tls|mtls|owasp|penetration|iso|nist|siem|vulnerability|soc|phishing|csrf|xss|mitm)$/i,
    Methodologies: /^(agile|scrum|kanban|tdd|bdd|devops|devsecops|ci|cd|cicd|git(hub|lab)?)$/i,
  };

  let categorized;
  if (Array.isArray(skills)) {
    categorized = { Programming: [], Frameworks: [], 'Cloud & Infra': [], 'AI / ML': [], Security: [], Methodologies: [], Other: [] };
    for (const s of skills) {
      let placed = false;
      for (const [cat, re] of Object.entries(cats)) {
        if (re.test(s)) { categorized[cat].push(s); placed = true; break; }
      }
      if (!placed) categorized.Other.push(s);
    }
  } else if (skills && typeof skills === 'object') {
    categorized = skills;
  } else {
    categorized = { Other: [] };
  }

  return Object.entries(categorized)
    .filter(([, arr]) => Array.isArray(arr) && arr.length > 0)
    .map(([label, arr]) =>
      `<div class="skill-cat"><div class="skill-cat-title">${label}:</div>`
      + `<div class="skill-list">${arr.join(', ')}</div></div>`
    )
    .join('\n    ');
}

function formatExperience(exp = []) {
  return exp.map(e => {
    const bullets = Array.isArray(e.bullets) ? `<ul>${e.bullets.map(b => `<li>${b}</li>`).join('')}</ul>` : '';
    return `<div class="entry">
      <div class="entry-header"><span class="entry-title">${e.company || ''}</span><span class="entry-date">${e.date || ''}</span></div>
      <div class="entry-subtitle">${e.role || ''}${e.location ? ` — ${e.location}` : ''}</div>
      ${bullets}
    </div>`;
  }).join('\n');
}

function formatProjects(projs = []) {
  return projs.map(p => {
    const bullets = Array.isArray(p.bullets) ? `<ul>${p.bullets.map(b => `<li>${b}</li>`).join('')}</ul>` : '';
    return `<div class="entry">
      <div class="entry-header"><span class="entry-title">${p.title || ''}</span><span class="entry-date">${p.date || ''}</span></div>
      ${p.description ? `<div class="entry-subtitle">${p.description}</div>` : ''}
      ${bullets}
    </div>`;
  }).join('\n');
}

function formatEducation(edu = []) {
  return edu.map(e =>
    `<div class="entry">
      <div class="entry-header"><span class="entry-title">${e.school || ''}</span><span class="entry-date">${e.date || ''}</span></div>
      <div class="entry-subtitle">${e.degree || ''}</div>
    </div>`
  ).join('\n');
}

function formatCerts(certs = []) {
  return certs.map(c => `<div class="cert-item">${c}</div>`).join('\n');
}

/** Build a concise, JD-aware cover letter body from the user's portfolio. */
function buildCoverLetter(job, userProfile, userPortfolio) {
  const summary = userPortfolio.summaries?.[job.archetype]
    || userPortfolio.summaries?.general
    || Object.values(userPortfolio.summaries || {})[0]
    || `I am a motivated ${userProfile.targetField || 'engineer'} with relevant technical experience.`;

  const topProject = pickProjects(userPortfolio.projects || [], `${job.desc || ''} ${job.role || ''}`, 1)[0];
  const proof = topProject
    ? `<p>Most relevant recent work: <strong>${topProject.title}</strong> — ${topProject.description || ''}.</p>`
    : '';

  return `<p>Dear Hiring Team,</p>
<p>I am writing to apply for the <strong>${job.role}</strong> position at <strong>${job.company}</strong>. ${summary}</p>
${proof}
<p>The role's focus on ${job.archetype || job.role || 'your team\'s mission'} aligns with my trajectory, and I would welcome the chance to contribute. Thank you for your consideration.</p>`;
}

/**
 * Generate CV + cover letter for one job. Returns { cvPath, clPath, slug }
 * or null on failure. Does not throw — callers can continue the batch.
 */
export function generateApplication(job, userProfile, userPortfolio, templatesDir, outputDir) {
  const cvTemplate = readFileSync(join(templatesDir, 'cv-template.html'), 'utf8');
  const clTemplate = readFileSync(join(templatesDir, 'cl-template.html'), 'utf8');

  const slug = `${safeSlug(job.company)}-${safeSlug(job.role).slice(0, 20)}`;
  const jdText = [job.desc, job.jd, job.role, job.archetype].filter(Boolean).join(' ');

  const summary = userPortfolio.summaries?.[job.archetype]
    || userPortfolio.summaries?.general
    || Object.values(userPortfolio.summaries || {})[0]
    || '';
  const selectedProjects = pickProjects(userPortfolio.projects || [], jdText, 4);

  let cvHtml = cvTemplate
    .replace(/{{NAME}}/g, userProfile.name || '')
    .replace(/{{EMAIL}}/g, userProfile.email || '')
    .replace(/{{PHONE}}/g, userProfile.phone || '')
    .replace(/{{LOCATION}}/g, userProfile.location || '')
    .replace(/{{LINKEDIN}}/g, userProfile.linkedin || '')
    .replace(/{{SUMMARY}}/g, summary)
    .replace(/{{SKILLS_BLOCK}}/g, formatSkills(userPortfolio.skills))
    .replace(/{{TARGETED_TOOLS}}/g, '') // filled by rewrite_loop.py
    .replace(/{{EXPERIENCE_BLOCK}}/g, formatExperience(userPortfolio.experience))
    .replace(/{{PROJECTS_BLOCK}}/g, formatProjects(selectedProjects))
    .replace(/{{EDUCATION_BLOCK}}/g, formatEducation(userPortfolio.education))
    .replace(/{{CERTIFICATIONS_BLOCK}}/g, formatCerts(userPortfolio.certifications));

  const clContent = buildCoverLetter(job, userProfile, userPortfolio);
  let clHtml = clTemplate
    .replace(/{{NAME}}/g, userProfile.name || '')
    .replace(/{{EMAIL}}/g, userProfile.email || '')
    .replace(/{{PHONE}}/g, userProfile.phone || '')
    .replace(/{{LOCATION}}/g, userProfile.location || '')
    .replace(/{{LINKEDIN}}/g, userProfile.linkedin || '')
    .replace(/{{COMPANY}}/g, job.company || '')
    .replace(/{{COMPANY_LOCATION}}/g, job.location || '')
    .replace(/{{ROLE}}/g, job.role || '')
    .replace(/{{DATE}}/g, new Date().toLocaleDateString())
    .replace(/{{CONTENT}}/g, clContent);

  const cvHtmlPath = join(outputDir, `cv-${slug}.html`);
  const clHtmlPath = join(outputDir, `cl-${slug}.html`);
  const cvPath = join(outputDir, `cv-${slug}.pdf`);
  const clPath = join(outputDir, `cl-${slug}.pdf`);
  writeFileSync(cvHtmlPath, cvHtml);
  writeFileSync(clHtmlPath, clHtml);

  try {
    execFileSync('node', [PDF_GENERATOR, cvHtmlPath, cvPath], { stdio: 'inherit' });
    execFileSync('node', [PDF_GENERATOR, clHtmlPath, clPath], { stdio: 'inherit' });
  } catch (e) {
    console.error(`   ⚠️  PDF generation failed for ${job.company}: ${e.message}`);
    return null;
  }

  try {
    recordApplication({
      slug, company: job.company, role: job.role, archetype: job.archetype,
      url: job.link || job.url, cvPath, clPath, cvHtmlPath, clHtmlPath,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`   ⚠️  history write failed: ${e.message}`);
  }

  return { cvPath, clPath, cvHtmlPath, clHtmlPath, slug };
}
