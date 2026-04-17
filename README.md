# Career-Ops CLI

An open-source, terminal-first job-application factory. It scans for fresh
roles, generates tailored CVs and cover letters, ATS-optimizes them against
each job description, checks posting liveness, and keeps a local application
tracker — all from your terminal, with no cloud service beyond the Gemini
calls you authorize.

## Features

- **Autonomous scan** — uses Google Gemini with live Google Search grounding to find 15 recent roles in your target region, mapped to your specific job titles.
- **Archetype-aware tailoring** — a Gemini-synthesized portfolio gives each archetype (e.g., "Data Scientist", "Backend Engineer") its own summary; projects are ranked against the JD and the top four are inserted.
- **Dual ATS scoring** — `scoring/local_ats.py` does spaCy keyword-overlap scoring against a curated tech stack; `scoring/tfidf_matcher.py` does TF-IDF cosine similarity over unigrams and bigrams.
- **Iterative rewrite loop** — `scoring/rewrite_loop.py` injects the top missing keywords into a dedicated *Targeted Tools* row in the CV template (format-preserving) and re-scores, up to a configurable threshold.
- **Posting liveness checker** — `src/liveness.mjs` uses Playwright for JS-heavy boards (Ashby, Workday, Lever dashboards); `scoring/liveness_http.py` is a zero-dependency urllib fallback for server-rendered pages.
- **Application history + dedup** — `src/history.mjs` records every generated package in `storage/application_history.json` and automatically skips postings that have already been produced.
- **Excel tracker** — `scoring/build_excel.py` exports the history to `output/applications.xlsx` with hyperlinks and a status dropdown.

All personal data lives locally in `storage/` and `output/`. Nothing leaves
the machine except the Gemini calls you authorize.

## Install

```bash
git clone https://github.com/shubhamdahiya210902-tech/career-ops-cli.git
cd career-ops-cli
npm install
pip install -r scoring/requirements.txt   # spaCy, scikit-learn, openpyxl, pdfminer.six
python -m playwright install chromium      # only if you want browser-based liveness
```

## Setup

```bash
node career-ops.js init
```

The wizard opens Google AI Studio so you can create a free Gemini API key,
then parses a folder of old CVs into a synthesized career portfolio.

## Daily run

```bash
node career-ops.js daily
```

The daily pipeline:

1. **Scan** — find 15 fresh roles in your target region.
2. **Dedup** — skip postings already in `storage/application_history.json`.
3. **Generate** — render a Bosch-style HTML CV + cover letter per role, then PDF.
4. **Score + rewrite** — run the dual-ATS loop and inject missing keywords into the *Targeted Tools* row; re-render the PDF.
5. **Tracker** — refresh `output/applications.xlsx` with the updated history.

Useful flags:

```bash
node career-ops.js daily --threshold 65       # raise the ATS bar
node career-ops.js daily --skip-score         # generate only, no rewrite loop
node career-ops.js daily --skip-tracker       # don't touch the xlsx
```

## One-off commands

```bash
# Score + rewrite a specific CV against a JD (text or a path to a .txt/.md file)
node career-ops.js score output/cv-acme-backend.html path/to/jd.txt --threshold 60

# Check whether a posting is still open (Playwright; pass --http for urllib)
node career-ops.js liveness https://jobs.lever.co/acme/1234
node career-ops.js liveness --file urls.txt
node career-ops.js liveness --json jobs.json       # annotates the file in place
node career-ops.js liveness --http https://example.com/job/1

# Rebuild the Excel tracker on demand
node career-ops.js tracker
node career-ops.js tracker --out ~/Desktop/applications.xlsx
```

## Repository layout

```
career-ops-cli/
├── career-ops.js                 # CLI entrypoint (commander)
├── generate-pdf.mjs              # Puppeteer HTML → PDF
├── src/
│   ├── onboarding.mjs            # Legacy-CV folder → synthesized portfolio
│   ├── scanner.mjs               # Gemini + Google Search job scanner
│   ├── factory.mjs               # Tailored CV + cover-letter generator
│   ├── history.mjs               # Application history / dedup ledger
│   └── liveness.mjs              # Playwright liveness checker
├── scoring/
│   ├── local_ats.py              # spaCy keyword-overlap scorer
│   ├── tfidf_matcher.py          # TF-IDF cosine similarity matcher
│   ├── rewrite_loop.py           # Iterative keyword-injection loop
│   ├── liveness_http.py          # urllib HTTP-only liveness fallback
│   ├── build_excel.py            # Tracker xlsx builder
│   └── requirements.txt
├── templates/
│   ├── cv-template.html          # Bosch-style CV (has the {{TARGETED_TOOLS}} anchor)
│   └── cl-template.html          # Cover letter
├── storage/                      # profile, portfolio, application_history.json
└── output/                       # generated HTML, PDF, applications.xlsx
```

## Privacy

- No telemetry, no analytics, no background network calls.
- The only outbound traffic is the Gemini API calls you authorize via `init` and `daily`.
- Your API key is stored in a `.env` file with mode `0600` and in the local `conf` store.
- `storage/` and `output/` stay on your machine; both are gitignored.

## License

MIT — see [LICENSE](./LICENSE).
