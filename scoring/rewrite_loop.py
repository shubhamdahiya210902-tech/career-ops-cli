"""
rewrite_loop.py — Iterative ATS-driven CV keyword injection.

For each (cv_html, jd_text) pair:
  1. Score via local_ats + tfidf_matcher.
  2. If either score is below THRESHOLD, inject the top missing keywords
     into the "Targeted Tools" row inside the CV's skills-grid.
  3. Re-score. Repeat up to MAX_ITER.

Format-preserving: only the text inside the <div class="skill-list"> of the
"Targeted Tools" skill-cat is edited. The template from templates/cv-template.html
provides this row as a stable anchor so no other content is moved or rewritten.

No personal data. No LLM calls. No network.

Usage:
    python3 rewrite_loop.py <cv_html> <jd_text_or_path> [--threshold=60] [--max-iter=6] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import local_ats         # noqa: E402
import tfidf_matcher     # noqa: E402


TARGETED_TOOLS_RE = re.compile(
    r'(<div class="skill-cat">\s*<div class="skill-cat-title">Targeted Tools:?</div>\s*<div class="skill-list">)([^<]*)(</div>)',
    re.IGNORECASE,
)
SKILLS_GRID_END_RE = re.compile(
    r'(</div>\s*<div class="section-title">(?:Work Experience|Experience))',
    re.IGNORECASE,
)


def _html_to_text(html: str) -> str:
    html = re.sub(r"<style[\s\S]*?</style>", " ", html, flags=re.I)
    html = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    html = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", html).strip()


def _clean(keywords):
    out, seen = [], set()
    for raw in keywords:
        k = (raw or "").strip().strip(".,;:()")
        if not k or len(k) > 40 or k.lower() in seen:
            continue
        seen.add(k.lower())
        pretty = k if " " in k else (k.title() if k.isalpha() else k)
        out.append(pretty)
    return out


def inject_keywords(html: str, keywords) -> str:
    """Append missing keywords to the 'Targeted Tools' skill-list row."""
    clean = _clean(keywords)
    if not clean:
        return html

    m = TARGETED_TOOLS_RE.search(html)
    if m:
        prefix, existing, suffix = m.group(1), m.group(2), m.group(3)
        tokens = [t.strip() for t in existing.split(",") if t.strip()]
        lowset = {t.lower() for t in tokens}
        for kw in clean:
            if kw.lower() not in lowset:
                tokens.append(kw)
                lowset.add(kw.lower())
        new = ", ".join(tokens)
        return html[:m.start()] + prefix + new + suffix + html[m.end():]

    # No Targeted Tools anchor found — insert a new skill-cat before the
    # Work Experience section so the template still renders correctly.
    block = (
        '<div class="skill-cat"><div class="skill-cat-title">Targeted Tools:</div>'
        f'<div class="skill-list">{", ".join(clean)}</div></div>'
    )
    out, n = SKILLS_GRID_END_RE.subn(block + r"\1", html, count=1)
    return out if n else html + block


def run(cv_path: Path, jd_text: str, threshold: float, max_iter: int, dry_run: bool) -> dict:
    html = cv_path.read_text(encoding="utf-8", errors="ignore")
    original = html
    iterations = []

    for i in range(max_iter):
        cv_text = _html_to_text(html)
        local = local_ats.score(cv_text, jd_text)
        matcher = tfidf_matcher.score(cv_text, jd_text)
        local_s = float(local.get("match_score", 0) or 0)
        match_s = float(matcher.get("matcher_score", 0) or 0)
        missing = matcher.get("missing_keywords") or local.get("missing_keywords") or []

        iterations.append({
            "i": i, "local_score": local_s, "matcher_score": match_s,
            "missing_top": missing[:8],
        })

        if local_s >= threshold and match_s >= threshold:
            break
        if not missing:
            break

        inject_n = 8 if i < 2 else 12
        new_html = inject_keywords(html, missing[:inject_n])
        if new_html == html:
            break
        html = new_html

    wrote = False
    if not dry_run and html != original:
        cv_path.write_text(html, encoding="utf-8")
        wrote = True

    return {
        "cv": str(cv_path), "threshold": threshold, "iterations": iterations,
        "final_local": iterations[-1]["local_score"] if iterations else 0.0,
        "final_matcher": iterations[-1]["matcher_score"] if iterations else 0.0,
        "updated_file": wrote,
    }


def _read_jd(arg: str) -> str:
    p = Path(arg)
    if p.exists():
        return p.read_text(encoding="utf-8", errors="ignore")
    return arg


def main() -> int:
    ap = argparse.ArgumentParser(description="Iterative ATS rewrite loop.")
    ap.add_argument("cv_html", help="Path to the CV HTML file to rewrite.")
    ap.add_argument("jd", help="JD text or path to a JD text file.")
    ap.add_argument("--threshold", type=float, default=60.0)
    ap.add_argument("--max-iter", type=int, default=6)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cv_path = Path(args.cv_html)
    if not cv_path.exists():
        print(json.dumps({"error": f"CV file not found: {cv_path}"}))
        return 1

    result = run(cv_path, _read_jd(args.jd), args.threshold, args.max_iter, args.dry_run)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
