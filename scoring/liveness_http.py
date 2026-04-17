"""
liveness_http.py — Lightweight HTTP-only liveness check (no browser).

Fallback used when Playwright isn't available. Uses urllib, no external
dependencies. Accurate for server-rendered job boards; JS-heavy SPAs
(Ashby, Workday, Lever dashboards) should use src/liveness.mjs instead.

Usage:
    python3 liveness_http.py <url> [url ...]
"""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

EXPIRED = [
    re.compile(p, re.I) for p in [
        r"job (is )?no longer available",
        r"no longer open", r"position has been filled",
        r"this job has expired", r"job posting has expired",
        r"no longer accepting applications",
        r"this (position|role|job) (is )?no longer",
        r"this job (listing )?is closed", r"job (listing )?not found",
        r"page you are looking for doesn.?t exist",
        r"\d+\s+jobs?\s+found",
        r"diese stelle (ist )?(nicht mehr|bereits) besetzt",
        r"offre (expir\u00e9e|n.est plus disponible)",
    ]
]
APPLY = [re.compile(p, re.I) for p in [r"\bapply\b", r"\bbewerben\b", r"\bsolicitar\b",
                                       r"\bpostuler\b", r"submit application", r"start application"]]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"


def check(url: str, timeout: float = 15.0) -> dict:
    if url.startswith("mailto:"):
        return {"url": url, "status": "ALIVE", "reason": "mailto (manual)"}
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Accept": "text/html,*/*;q=0.8",
                                               "Accept-Language": "en-US,en;q=0.9"})
    jar = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    try:
        with opener.open(req, timeout=timeout) as resp:
            http_status = resp.status
            final_url = resp.geturl()
            body_bytes = resp.read(500_000)
            charset = resp.headers.get_content_charset() or "utf-8"
            body = body_bytes.decode(charset, errors="replace")
    except urllib.error.HTTPError as e:
        return {"url": url, "status": "ERROR", "reason": f"HTTP {e.code}", "http_status": e.code}
    except Exception as e:
        return {"url": url, "status": "ERROR", "reason": f"{type(e).__name__}: {str(e)[:120]}"}

    if "errorpage" in (final_url or "").lower():
        return {"url": url, "status": "EXPIRED", "reason": "redirect to errorpage",
                "http_status": http_status, "final_url": final_url}
    for p in EXPIRED:
        if p.search(body):
            return {"url": url, "status": "EXPIRED", "reason": f"matched: {p.pattern}",
                    "http_status": http_status, "final_url": final_url}
    has_apply = any(p.search(body) for p in APPLY)
    if http_status == 200 and has_apply and len(body) > 2000:
        return {"url": url, "status": "ALIVE", "reason": "200 + apply text",
                "http_status": http_status, "final_url": final_url}
    if http_status == 200:
        return {"url": url, "status": "UNCERTAIN", "reason": "200 but no apply signal",
                "http_status": http_status, "final_url": final_url}
    return {"url": url, "status": "UNCERTAIN", "reason": f"HTTP {http_status}",
            "http_status": http_status, "final_url": final_url}


def main() -> int:
    urls = sys.argv[1:]
    if not urls:
        print("Usage: python3 liveness_http.py <url> [url ...]", file=sys.stderr)
        return 1
    print(json.dumps([check(u) for u in urls], indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
