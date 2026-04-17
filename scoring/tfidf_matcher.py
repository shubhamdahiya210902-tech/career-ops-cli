"""
tfidf_matcher.py — TF-IDF cosine similarity + missing-keyword extraction.

Complements local_ats.py. Where local_ats measures keyword intersection,
this measures overall document similarity via TF-IDF vectors (unigrams +
bigrams), then ranks missing JD terms by their TF-IDF weight.

No personal data. No LLM calls. No network.

Usage:
    python3 tfidf_matcher.py <cv_path_or_text> <jd_path_or_text>
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
except ImportError:
    print(json.dumps({"error": "scikit-learn not installed. Run: pip install scikit-learn"}))
    sys.exit(2)

_STOPWORDS = set(
    """a an and are as at be been being but by can could do does did for from had has have
    he her him his how i in into is it its of on or our ours she should so some such than
    that the their them then there these they this those to too us was we were what when
    where which who why will with within would you your yours yourself yourselves also may
    might shall must if else while very more most other both all any each few own same only
    etc e.g. i.e. via using use used new get got make made take took go went come came
    """.split()
)


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


def _normalize(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9+#/\.\s-]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _tokenize(text: str) -> list:
    return [t for t in re.findall(r"[a-z0-9+#/.-]+", text.lower())
            if t not in _STOPWORDS and len(t) > 1]


def score(cv_text: str, jd_text: str) -> dict:
    cv_norm = _normalize(cv_text)
    jd_norm = _normalize(jd_text)

    if not jd_norm.strip():
        return {
            "matcher_score": 0.0, "matches_found": 0, "total_jd_keywords": 0,
            "missing_keywords": [], "top_jd_keywords": [], "error": "Empty JD text",
        }

    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1, stop_words=list(_STOPWORDS))
    tfidf = vec.fit_transform([jd_norm, cv_norm])
    cosine = float(cosine_similarity(tfidf[0], tfidf[1])[0, 0])
    matcher_score = round(cosine * 100.0, 2)

    feature_names = vec.get_feature_names_out()
    jd_weights = tfidf[0].toarray().ravel()
    order = jd_weights.argsort()[::-1]

    cv_tokens = set(_tokenize(cv_norm))
    cv_norm_joined = " " + cv_norm + " "

    top_jd, missing = [], []
    for idx in order:
        if jd_weights[idx] <= 0:
            break
        term = feature_names[idx]
        if term.replace(" ", "").isdigit():
            continue
        top_jd.append(term)
        unigrams = term.split()
        in_cv = all(u in cv_tokens for u in unigrams) or (f" {term} " in cv_norm_joined)
        if not in_cv:
            missing.append(term)
        if len(top_jd) >= 40:
            break

    matches_found = max(0, len(top_jd) - len(missing))
    return {
        "matcher_score": matcher_score,
        "matches_found": matches_found,
        "total_jd_keywords": len(top_jd),
        "missing_keywords": missing[:20],
        "top_jd_keywords": top_jd[:20],
    }


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python3 tfidf_matcher.py <cv_path_or_text> <jd_path_or_text>"}))
        return 1
    cv = _read_maybe_file(sys.argv[1])
    jd = _read_maybe_file(sys.argv[2])
    print(json.dumps(score(cv, jd), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
