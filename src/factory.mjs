import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Resolve generate-pdf.mjs relative to this file, not the caller's CWD.
const PDF_GENERATOR = join(__dirname, '..', 'generate-pdf.mjs');

// Sanitize company strings used in filenames: keep alphanumerics and hyphens.
function safeSlug(raw) {
  return String(raw || 'job')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'job';
}

export function generateApplication(job, userProfile, userPortfolio, templatesDir, outputDir) {
  const cvTemplate = readFileSync(join(templatesDir, 'cv-template.html'), 'utf8');
  const clTemplate = readFileSync(join(templatesDir, 'cl-template.html'), 'utf8');

  // --- CV LOGIC ---
  const slug = `${safeSlug(job.company)}-${Math.floor(Math.random()*1000)}`;
  
  // Choose projects based on archetype (simplified for public version initially)
  const selectedProjects = userPortfolio.projects.slice(0, 4); 

  let cvHtml = cvTemplate
    .replace(/{{NAME}}/g, userProfile.name)
    .replace(/{{EMAIL}}/g, userProfile.email)
    .replace(/{{PHONE}}/g, userProfile.phone || '')
    .replace(/{{LOCATION}}/g, userProfile.location || '')
    .replace(/{{LINKEDIN}}/g, userProfile.linkedin || '')
    .replace(/{{SUMMARY}}/g, userPortfolio.summaries[job.archetype] || userPortfolio.summaries['general'])
    .replace(/{{SKILLS_BLOCK}}/g, formatSkills(userPortfolio.skills))
    .replace(/{{EXPERIENCE_BLOCK}}/g, formatExperience(userPortfolio.experience))
    .replace(/{{PROJECTS_BLOCK}}/g, formatProjects(selectedProjects))
    .replace(/{{EDUCATION_BLOCK}}/g, formatEducation(userPortfolio.education))
    .replace(/{{CERTIFICATIONS_BLOCK}}/g, formatCerts(userPortfolio.certifications));

  // --- CL LOGIC ---
  const clContent = `I am writing to express my strong interest in the ${job.role} position at ${job.company}. My technical background and passion for ${job.archetype} align perfectly with your team's mission.`;

  let clHtml = clTemplate
    .replace(/{{NAME}}/g, userProfile.name)
    .replace(/{{EMAIL}}/g, userProfile.email)
    .replace(/{{COMPANY}}/g, job.company)
    .replace(/{{ROLE}}/g, job.role)
    .replace(/{{DATE}}/g, new Date().toLocaleDateString())
    .replace(/{{CONTENT}}/g, `<p>${clContent}</p>`);

  const cvPath = join(outputDir, `cv-${slug}.pdf`);
  const clPath = join(outputDir, `cl-${slug}.pdf`);

  // Write temporary HTMLs
  const cvHtmlPath = join(outputDir, `cv-${slug}.html`);
  const clHtmlPath = join(outputDir, `cl-${slug}.html`);
  writeFileSync(cvHtmlPath, cvHtml);
  writeFileSync(clHtmlPath, clHtml);

  // Generate PDFs. execFileSync (array form) does NOT spawn a shell, so
  // any unusual characters in paths cannot be interpreted as shell metachars.
  try {
    execFileSync('node', [PDF_GENERATOR, cvHtmlPath, cvPath], { stdio: 'inherit' });
    execFileSync('node', [PDF_GENERATOR, clHtmlPath, clPath], { stdio: 'inherit' });
    return { cvPath, clPath };
  } catch (e) {
    console.error('PDF Generation Failed', e);
    return null;
  }
}

// Helpers would be more robust in final version
function formatSkills(skills) { return `<div class="skill-list">${skills.join(', ')}</div>`; }
function formatExperience(exp) { return exp.map(e => `<div class="entry"><b>${e.company}</b> - ${e.role}</div>`).join(''); }
function formatProjects(projs) { return projs.map(p => `<div class="entry"><b>${p.title}</b><br>${p.description}</div>`).join(''); }
function formatEducation(edu) { return edu.map(e => `<div class="entry">${e.school} - ${e.degree}</div>`).join(''); }
function formatCerts(certs) { return certs.map(c => `<div class="cert-item">${c}</div>`).join(''); }
