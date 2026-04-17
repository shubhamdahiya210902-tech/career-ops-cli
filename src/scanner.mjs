import { GoogleGenAI } from '@google/genai';

export async function autonomousScan(userProfile, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  
  console.log(`🔍 Market scan: Searching for ${userProfile.targetField} roles in ${userProfile.location || 'Germany'} using Gemini Search...`);

  const prompt = `
    You are a specialized Job Discovery Agent with Google Search access. Find 15 high-match job opportunities for the following profile:
    Location: ${userProfile.location || 'Germany'}
    Main Field: ${userProfile.targetField}
    Target Roles: ${userProfile.specificRoles.join(', ')}
    
    Portals: site:jobs.lever.co, site:boards.greenhouse.io, site:jobs.ashbyhq.com, site:personio.de, site:workday.com
    
    Scan for positions posted in the last 48 hours. 
    Map each job to one of the user's defined roles.
    
    Return ONLY a valid JSON list of objects.
    
    JSON FORMAT:
    [
      {
        "company": "...",
        "role": "...",
        "link": "...",
        "desc": "1-sentence mission",
        "archetype": "one of the user's specific roles"
      }
    ]
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
        responseMimeType: "application/json",
        tools: [{ googleSearch: {} }] // Utilize Google Search grounding
    }
  });

  const rawData = JSON.parse(response.text);
  return Array.isArray(rawData) ? rawData : rawData.jobs || [];
}
