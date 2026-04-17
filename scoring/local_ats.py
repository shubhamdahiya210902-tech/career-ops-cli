"""
local_ats.py — Local ATS scorer using spaCy keyword overlap.

Computes the percentage of JD-extracted keywords (nouns, proper nouns, tech
terms) that also appear in the CV. Returns a list of missing keywords that
the iterative rewriter can inject.

No personal data. No LLM calls. No network.

Usage:
    python3 local_ats.py <cv_path_or_text> <jd_path_or_text>
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

try:
    import spacy
except ImportError:
    print(json.dumps({"error": "spaCy not installed. Run: pip install spacy && python -m spacy download en_core_web_sm"}))
    sys.exit(2)

# Common tech vocabulary — supplements the NOUN/PROPN extraction. Expanded
# from the typical ATS keyword corpus (no personal data).
_TECH_STACK = {
    # Languages
    "python", "java", "javascript", "typescript", "go", "rust", "c", "c++", "c#",
    "sql", "ruby", "php", "kotlin", "swift", "scala", "r", "bash", "shell",
    # Frameworks / libs
    "react", "angular", "vue", "svelte", "nextjs", "nuxt", "express", "nestjs",
    "spring", "boot", "django", "flask", "fastapi", "rails", "laravel",
    "tensorflow", "pytorch", "keras", "scikit", "pandas", "numpy", "scipy",
    "playwright", "selenium", "cypress", "jest", "pytest", "mocha",
    # Cloud / infra
    "aws", "gcp", "azure", "kubernetes", "docker", "terraform", "ansible",
    "helm", "istio", "serverless", "lambda", "ec2", "s3", "rds", "gke", "eks",
    # Databases
    "postgres", "postgresql", "mysql", "mariadb", "mongodb", "redis", "elastic",
    "elasticsearch", "cassandra", "dynamodb", "snowflake", "bigquery",
    # AI / ML
    "llm", "transformer", "bert", "gpt", "rag", "embedding", "vector",
    "langchain", "huggingface", "ollama", "gemini", "anthropic", "openai",
    # DevOps
    "ci", "cd", "cicd", "github", "gitlab", "jenkins", "circleci", "argo",
    # Security
    "oauth", "saml", "jwt", "tls", "mtls", "owasp", "penetration", "iso",
    "nist", "siem", "soc", "vulnerability", "mitm", "xss", "csrf",
    # Methodologies
    "agile", "scrum", "kanban", "tdd", "bdd", "devops", "devsecops",
}


def _load_nlp():
    try:
        return spacy.load("en_core_web_sm")
    except OSError:
        # First-time auto-download — keeps the scorer self-bootstrapping.
        os.system(f'"{sys.executable}" -m spacy download en_core_web_sm')
        return spacy.load("en_core_web_sm")


def _read_maybe_file(arg: str) -> str:
    p = Path(arg)
    if not p.exists():
        return arg
    if p.suffix.lower() == ".pdf":
        try:
            from pdfminer.high_level import extract_text
            return extract_text(str(p)) or ""
        except Exception:
            return ""
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


def extract_keywords(nlp, text: str) -> set:
    doc = nlp(text.lower())
    found = set()
    for token in doc:
        lemma = token.lemma_
        if lemma in _TECH_STACK or token.text in _TECH_STACK:
            found.add(lemma)
        elif token.pos_ in ("NOUN", "PROPN") and not token.is_stop and len(token.text) > 2:
            found.add(lemma)
    return found


def score(cv_text: str, jd_text: str) -> dict:
    nlp = _load_nlp()
    cv_kw = extract_keywords(nlp, cv_text)
    jd_kw = extract_keywords(nlp, jd_text)
    if not jd_kw:
        return {"match_score": 0.0, "total_jd_keywords": 0, "matches_found": 0, "missing_keywords": []}
    intersection = cv_kw & jd_kw
    missing = sorted(jd_kw - cv_kw)
    pct = round(100.0 * len(intersection) / len(jd_kw), 2)
    return {
        "match_score": pct,
        "total_jd_keywords": len(jd_kw),
        "matches_found": len(intersection),
        "missing_keywords": missing[:15],
    }


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python3 local_ats.py <cv_path_or_text> <jd_path_or_text>"}))
        return 1
    cv = _read_maybe_file(sys.argv[1])
    jd = _read_maybe_file(sys.argv[2])
    print(json.dumps(score(cv, jd), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
