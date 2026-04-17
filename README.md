# Career-Ops CLI (Open Source)

The automated job application factory. Find 15 jobs a day, generate 85+ score CVs, and track your progress—all from your terminal. 100% Free powered by Google Gemini.

## Setup

1. Clone this repository.
2. `cd public-cli`
3. `npm install`
4. Run initialization:
   ```bash
   node career-ops.js init
   ```
   The CLI will automatically open Google AI Studio for you to create a free API key.

## Daily Use

Run your daily sprint:
```bash
node career-ops.js daily
```

The system will:
1. Scan for fresh roles in your target region using Google Search via Gemini.
2. Filter duplicates from your history.
3. Automatically generate tailored CVs and Cover Letters mapped to your specific field.
4. Provide a CSV tracker for today's sprint.

## Privacy
All your data (profile, history, and generated files) are stored locally in the `storage/` and `output/` folders. They are never sent to any server except for the official Google Gemini API calls you authorize.
