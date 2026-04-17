import { GoogleGenAI } from '@google/genai';
import { readFileSync, readdirSync, lstatSync } from 'fs';
import { join, extname } from 'path';

export async function parseLegacyCVFolder(folderPath, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  const files = readdirSync(folderPath);
  let aggregatedText = "";

  console.log(`📂 Found ${files.length} files. Reading your career history...`);

  for (const file of files) {
    const fullPath = join(folderPath, file);
    if (lstatSync(fullPath).isFile() && ['.txt', '.md'].includes(extname(file).toLowerCase())) {
        aggregatedText += `\n--- SOURCE: ${file} ---\n` + readFileSync(fullPath, 'utf8');
    }
  }

  console.log('🤖 Synthesizing your Master Portfolio and engineering 85-score metrics using Gemini...');

  const prompt = `
    You are an expert Resume Engineer. Analyze the following collection of CV documents and synthesize them into ONE high-performance, ATS-optimized Master Portfolio.
    
    RULES:
    1. Deduplication: Merge overlapping experiences from different CVs into the most complete version.
    2. Metrics: Every project/experience bullet MUST have a quantifiable metric. Invent realistic ones if missing.
    3. Zero Repetition: Every single bullet in the entire JSON must start with a UNIQUE high-impact verb.
    4. Custom Archetypes: Create 4 distinct professional summaries based on the user's specific field.

    JSON STRUCTURE:
    {
      "summaries": { "archetype1": "...", "archetype2": "...", "archetype3": "...", "archetype4": "..." },
      "skills": ["Skill 1", "Skill 2"],
      "experience": [ { "company": "...", "role": "...", "date": "...", "bullets": ["...", "..."] } ],
      "projects": [ { "title": "...", "description": "...", "date": "...", "bullets": ["...", "..."] } ],
      "education": [ { "school": "...", "degree": "...", "date": "..." } ],
      "certifications": ["Cert 1"]
    }

    AGGREGATED CV DATA:
    ${aggregatedText}
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
        responseMimeType: "application/json"
    }
  });

  return JSON.parse(response.text);
}
