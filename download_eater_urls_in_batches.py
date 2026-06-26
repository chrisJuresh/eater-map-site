#!/usr/bin/env python3
"""
Safely download Eater URLs from a CSV in organised batches:

  01_maps/                  all /maps and /maps/... URLs on eater hosts
  02_london_eater_rest/      non-map london.eater.com URLs
  03_www_eater_rest/         non-map www.eater.com URLs
  99_other/                  any other hosts, optional but enabled by default

Features:
  - Resumable SQLite manifest
  - Batch plan CSV before downloading
  - One request at a time by default
  - Per-host politeness delay with jitter
  - robots.txt checks by default
  - Retry-After support
  - Exponential backoff on 429/5xx/temporary errors
  - Compressed body storage (.html.gz, .json.gz, etc.)
  - Metadata JSON beside each body file
  - Global manifest + per-batch manifests
  - Dry-run, limit, limit-per-batch, and batch selection

Install:
  pip install requests beautifulsoup4

Example:
  python download_eater_urls_in_batches.py sitemap.csv \
    --out-dir eater_downloads_batched \
    --email you@example.com \
    --delay 3 \
    --jitter 1.5 \
    --html-only

Resume by running the same command again. Successful downloads are skipped.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import random
import re
import signal
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse, urlunparse
from urllib.robotparser import RobotFileParser

import requests

try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover
    BeautifulSoup = None


DEFAULT_USER_AGENT_TEMPLATE = "EaterLondonResearchBot/1.0 (+research; contact: {email})"

URL_COLUMN_CANDIDATES = [
    "url", "URL", "loc", "matched_url", "canonical_url", "source_url"
]

HTML_CONTENT_TYPES = ("text/html", "application/xhtml+xml")
TEXT_CONTENT_TYPES = (
    "text/html", "application/xhtml+xml", "text/plain", "application/json",
    "application/ld+json", "application/xml", "text/xml"
)
TRANSIENT_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}

STOP_REQUESTED = False


def _handle_stop(signum, frame):  # type: ignore[no-untyped-def]
    global STOP_REQUESTED
    STOP_REQUESTED = True
    print("\nStop requested. Finishing current request and exiting cleanly...", file=sys.stderr)


signal.signal(signal.SIGINT, _handle_stop)
signal.signal(signal.SIGTERM, _handle_stop)


@dataclass(frozen=True)
class Batch:
    key: str
    order: int
    folder: str
    description: str


BATCHES: Dict[str, Batch] = {
    "maps": Batch(
        key="maps",
        order=1,
        folder="01_maps",
        description="All /maps URLs from london.eater.com and www.eater.com",
    ),
    "london_eater_rest": Batch(
        key="london_eater_rest",
        order=2,
        folder="02_london_eater_rest",
        description="All non-map london.eater.com URLs",
    ),
    "www_eater_rest": Batch(
        key="www_eater_rest",
        order=3,
        folder="03_www_eater_rest",
        description="All non-map www.eater.com URLs",
    ),
    "other": Batch(
        key="other",
        order=99,
        folder="99_other",
        description="Any other host in the CSV",
    ),
}


@dataclass
class UrlRecord:
    url: str
    input_row_number: int
    input_data: Dict[str, str]
    batch_key: str
    batch_order: int
    batch_folder: str


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_url(url: str) -> str:
    url = url.strip()
    parsed = urlparse(url)
    scheme = (parsed.scheme or "https").lower()
    netloc = parsed.netloc.lower()
    path = parsed.path or "/"
    if path != "/":
        path = path.rstrip("/")
    # Keep query params, strip fragments.
    return urlunparse((scheme, netloc, path, "", parsed.query, ""))


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_slug(text: str, max_len: int = 120) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9._-]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-._")
    return text[:max_len] or "root"


def classify_batch(url: str) -> Batch:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    path = parsed.path or "/"
    path_no_slash = path.rstrip("/") or "/"

    is_eater_host = host in {"london.eater.com", "www.eater.com"}
    is_maps = path_no_slash == "/maps" or path.startswith("/maps/")

    if is_eater_host and is_maps:
        return BATCHES["maps"]
    if host == "london.eater.com":
        return BATCHES["london_eater_rest"]
    if host == "www.eater.com":
        return BATCHES["www_eater_rest"]
    return BATCHES["other"]


def content_extension(content_type: str) -> str:
    ct = content_type.lower().split(";", 1)[0].strip()
    if "json" in ct:
        return ".json.gz"
    if "xml" in ct:
        return ".xml.gz"
    if ct.startswith("text/plain"):
        return ".txt.gz"
    return ".html.gz"


def storage_path_for_url(out_dir: Path, record: UrlRecord, content_type: str) -> Path:
    parsed = urlparse(record.url)
    host = safe_slug(parsed.netloc)
    digest = sha256_text(record.url)
    prefix = digest[:2]
    parts = [p for p in parsed.path.split("/") if p]
    hint = safe_slug("-".join(parts[-2:]) if parts else "root")
    filename = f"{digest}_{hint}{content_extension(content_type)}"
    return out_dir / record.batch_folder / "raw" / host / prefix / filename


def meta_path_for_body_path(body_path: Path) -> Path:
    return body_path.with_suffix(body_path.suffix + ".meta.json")


def detect_url_column(fieldnames: List[str], requested: Optional[str]) -> str:
    if requested:
        if requested not in fieldnames:
            raise ValueError(f"Requested URL column {requested!r} not found. Columns: {fieldnames}")
        return requested
    for candidate in URL_COLUMN_CANDIDATES:
        if candidate in fieldnames:
            return candidate
    if len(fieldnames) == 1:
        return fieldnames[0]
    raise ValueError(f"Could not detect URL column. Use --url-column. Columns: {fieldnames}")


def read_input_csv(path: Path, url_column: Optional[str], limit: Optional[int]) -> List[UrlRecord]:
    records: List[UrlRecord] = []
    seen: set[str] = set()
    with path.open("r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("CSV has no header row")
        col = detect_url_column(reader.fieldnames, url_column)
        for idx, row in enumerate(reader, start=2):
            raw = (row.get(col) or "").strip()
            if not raw:
                continue
            norm = normalize_url(raw)
            if norm in seen:
                continue
            seen.add(norm)
            batch = classify_batch(norm)
            records.append(
                UrlRecord(
                    url=norm,
                    input_row_number=idx,
                    input_data=dict(row),
                    batch_key=batch.key,
                    batch_order=batch.order,
                    batch_folder=batch.folder,
                )
            )
            if limit and len(records) >= limit:
                break
    records.sort(key=lambda r: (r.batch_order, r.input_row_number, r.url))
    return records


class RobotsCache:
    def __init__(self, user_agent: str, timeout: int = 20, default_allow: bool = False):
        self.user_agent = user_agent
        self.timeout = timeout
        self.default_allow = default_allow
        self.cache: Dict[str, RobotFileParser] = {}
        self.failed_hosts: set[str] = set()

    @staticmethod
    def robots_url_for(url: str) -> str:
        parsed = urlparse(url)
        return f"{parsed.scheme}://{parsed.netloc}/robots.txt"

    def get_parser(self, url: str) -> Optional[RobotFileParser]:
        parsed = urlparse(url)
        host_key = f"{parsed.scheme}://{parsed.netloc}"
        if host_key in self.cache:
            return self.cache[host_key]
        if host_key in self.failed_hosts:
            return None

        robots_url = self.robots_url_for(url)
        rp = RobotFileParser()
        rp.set_url(robots_url)
        try:
            resp = requests.get(robots_url, headers={"User-Agent": self.user_agent}, timeout=self.timeout)
            if resp.status_code >= 400:
                print(f"robots.txt unavailable for {host_key}: HTTP {resp.status_code}", file=sys.stderr)
                self.failed_hosts.add(host_key)
                return None
            rp.parse(resp.text.splitlines())
            self.cache[host_key] = rp
            return rp
        except Exception as exc:
            print(f"robots.txt fetch failed for {host_key}: {exc}", file=sys.stderr)
            self.failed_hosts.add(host_key)
            return None

    def can_fetch(self, url: str) -> bool:
        rp = self.get_parser(url)
        if rp is None:
            return self.default_allow
        return rp.can_fetch(self.user_agent, url)

    def crawl_delay(self, url: str) -> Optional[float]:
        rp = self.get_parser(url)
        if rp is None:
            return None
        try:
            delay = rp.crawl_delay(self.user_agent)
            return float(delay) if delay is not None else None
        except Exception:
            return None


class HostPoliteness:
    def __init__(self, base_delay: float, jitter: float):
        self.base_delay = base_delay
        self.jitter = jitter
        self.last_request_at_by_host: Dict[str, float] = {}

    @staticmethod
    def host_key(url: str) -> str:
        return urlparse(url).netloc.lower()

    def wait(self, url: str, robots_delay: Optional[float]) -> None:
        host = self.host_key(url)
        delay = max(self.base_delay, robots_delay or 0.0)
        delay += random.uniform(0, self.jitter) if self.jitter > 0 else 0.0
        last = self.last_request_at_by_host.get(host)
        if last is not None:
            wait_for = (last + delay) - time.monotonic()
            if wait_for > 0:
                time.sleep(wait_for)

    def mark_request(self, url: str) -> None:
        self.last_request_at_by_host[self.host_key(url)] = time.monotonic()


def init_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS downloads (
            url TEXT PRIMARY KEY,
            batch_key TEXT,
            batch_order INTEGER,
            batch_folder TEXT,
            input_row_number INTEGER,
            input_data_json TEXT,
            status TEXT,
            http_status INTEGER,
            content_type TEXT,
            content_length INTEGER,
            body_sha256 TEXT,
            body_path TEXT,
            meta_path TEXT,
            title TEXT,
            canonical_url TEXT,
            final_url TEXT,
            fetched_at TEXT,
            attempts INTEGER DEFAULT 0,
            error TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_downloads_batch ON downloads(batch_order, batch_key)")
    conn.commit()
    return conn


def existing_success(conn: sqlite3.Connection, url: str) -> bool:
    row = conn.execute("SELECT status, body_path FROM downloads WHERE url = ?", (url,)).fetchone()
    if not row:
        return False
    status, body_path = row
    return status == "downloaded" and body_path and Path(body_path).exists()


def upsert_download(
    conn: sqlite3.Connection,
    record: UrlRecord,
    *,
    status: str,
    http_status: Optional[int] = None,
    content_type: str = "",
    content_length: Optional[int] = None,
    body_sha256: str = "",
    body_path: str = "",
    meta_path: str = "",
    title: str = "",
    canonical_url: str = "",
    final_url: str = "",
    attempts: int = 0,
    error: str = "",
) -> None:
    conn.execute(
        """
        INSERT INTO downloads (
            url, batch_key, batch_order, batch_folder, input_row_number, input_data_json,
            status, http_status, content_type, content_length, body_sha256, body_path,
            meta_path, title, canonical_url, final_url, fetched_at, attempts, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
            batch_key=excluded.batch_key,
            batch_order=excluded.batch_order,
            batch_folder=excluded.batch_folder,
            input_row_number=excluded.input_row_number,
            input_data_json=excluded.input_data_json,
            status=excluded.status,
            http_status=excluded.http_status,
            content_type=excluded.content_type,
            content_length=excluded.content_length,
            body_sha256=excluded.body_sha256,
            body_path=excluded.body_path,
            meta_path=excluded.meta_path,
            title=excluded.title,
            canonical_url=excluded.canonical_url,
            final_url=excluded.final_url,
            fetched_at=excluded.fetched_at,
            attempts=excluded.attempts,
            error=excluded.error
        """,
        (
            record.url, record.batch_key, record.batch_order, record.batch_folder,
            record.input_row_number, json.dumps(record.input_data, ensure_ascii=False, sort_keys=True),
            status, http_status, content_type, content_length, body_sha256, body_path,
            meta_path, title, canonical_url, final_url, utc_now_iso(), attempts,
            error[:4000] if error else "",
        ),
    )
    conn.commit()


def parse_retry_after(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    value = value.strip()
    if value.isdigit():
        return float(value)
    try:
        dt = parsedate_to_datetime(value)
        return max(0.0, (dt - datetime.now(dt.tzinfo)).total_seconds())
    except Exception:
        return None


def should_skip_by_content_type(content_type: str, html_only: bool, text_only: bool) -> bool:
    ct = content_type.lower().split(";", 1)[0].strip()
    if html_only:
        return ct not in HTML_CONTENT_TYPES
    if text_only:
        return ct not in TEXT_CONTENT_TYPES
    return False


def stream_response_body(response: requests.Response, max_bytes: int) -> bytes:
    chunks: List[bytes] = []
    total = 0
    for chunk in response.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        total += len(chunk)
        if total > max_bytes:
            raise ValueError(f"response exceeded --max-bytes={max_bytes}")
        chunks.append(chunk)
    return b"".join(chunks)


def extract_title_and_canonical(content: bytes, content_type: str) -> Tuple[str, str]:
    if BeautifulSoup is None:
        return "", ""
    ct = content_type.lower().split(";", 1)[0].strip()
    if ct not in HTML_CONTENT_TYPES:
        return "", ""
    try:
        soup = BeautifulSoup(content, "html.parser")
        title = soup.title.get_text(" ", strip=True) if soup.title else ""
        canonical_tag = soup.find("link", rel=lambda x: x and "canonical" in x)
        canonical = canonical_tag.get("href", "").strip() if canonical_tag else ""
        return title, canonical
    except Exception:
        return "", ""


def write_body_and_meta(out_dir: Path, record: UrlRecord, response: requests.Response, body: bytes) -> Tuple[str, str, str, str, int, str]:
    content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    body_path = storage_path_for_url(out_dir, record, content_type)
    body_path.parent.mkdir(parents=True, exist_ok=True)

    with gzip.open(body_path, "wb", compresslevel=6) as gz:
        gz.write(body)

    digest = sha256_bytes(body)
    title, canonical = extract_title_and_canonical(body, content_type)
    final_url = normalize_url(response.url)

    meta = {
        "url": record.url,
        "final_url": final_url,
        "batch_key": record.batch_key,
        "batch_order": record.batch_order,
        "batch_folder": record.batch_folder,
        "status_code": response.status_code,
        "headers": dict(response.headers),
        "fetched_at": utc_now_iso(),
        "content_type": content_type,
        "content_length": len(body),
        "sha256": digest,
        "title": title,
        "canonical_url": canonical,
        "input_row_number": record.input_row_number,
        "input_data": record.input_data,
    }

    meta_path = meta_path_for_body_path(body_path)
    with meta_path.open("w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2, sort_keys=True)

    return str(body_path), str(meta_path), digest, title, len(body), canonical


def download_one(
    session: requests.Session,
    conn: sqlite3.Connection,
    record: UrlRecord,
    out_dir: Path,
    args: argparse.Namespace,
    robots: RobotsCache,
    politeness: HostPoliteness,
) -> None:
    if args.respect_robots and not robots.can_fetch(record.url):
        print(f"ROBOTS disallow: {record.url}")
        upsert_download(conn, record, status="robots_disallowed", error="robots.txt disallowed")
        return

    robots_delay = robots.crawl_delay(record.url) if args.respect_robots else None
    last_error = ""

    for attempt in range(1, args.retries + 2):
        if STOP_REQUESTED:
            return
        politeness.wait(record.url, robots_delay=robots_delay)
        politeness.mark_request(record.url)
        try:
            print(f"GET {record.url} attempt={attempt}")
            response = session.get(
                record.url,
                timeout=(args.connect_timeout, args.read_timeout),
                stream=True,
                allow_redirects=True,
            )
            status = response.status_code
            content_type = response.headers.get("Content-Type", "")

            if should_skip_by_content_type(content_type, args.html_only, args.text_only):
                response.close()
                upsert_download(
                    conn, record, status="skipped_content_type", http_status=status,
                    content_type=content_type, attempts=attempt,
                    error=f"Skipped content type: {content_type}", final_url=normalize_url(response.url)
                )
                return

            if status in TRANSIENT_STATUS_CODES:
                retry_after = parse_retry_after(response.headers.get("Retry-After"))
                response.close()
                if attempt <= args.retries + 1:
                    sleep_for = retry_after if retry_after is not None else min(args.max_backoff, args.backoff * (2 ** (attempt - 1)))
                    sleep_for += random.uniform(0, args.jitter)
                    print(f"  transient HTTP {status}; sleeping {sleep_for:.1f}s")
                    time.sleep(sleep_for)
                    continue

            body = stream_response_body(response, args.max_bytes)
            body_path, meta_path, digest, title, content_length, canonical = write_body_and_meta(out_dir, record, response, body)
            final_url = normalize_url(response.url)
            response.close()

            final_status = "downloaded" if 200 <= status < 400 else "http_error"
            upsert_download(
                conn, record, status=final_status, http_status=status, content_type=content_type,
                content_length=content_length, body_sha256=digest, body_path=body_path,
                meta_path=meta_path, title=title, canonical_url=canonical,
                final_url=final_url, attempts=attempt,
                error="" if final_status == "downloaded" else f"HTTP {status}",
            )
            return

        except Exception as exc:
            last_error = repr(exc)
            print(f"  ERROR: {last_error}", file=sys.stderr)
            if attempt <= args.retries:
                sleep_for = min(args.max_backoff, args.backoff * (2 ** (attempt - 1)))
                sleep_for += random.uniform(0, args.jitter)
                time.sleep(sleep_for)
                continue

    upsert_download(conn, record, status="failed", attempts=args.retries + 1, error=last_error)


def write_batch_plan(out_dir: Path, records: List[UrlRecord]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    batch_plan = out_dir / "batch_plan.csv"
    with batch_plan.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "batch_order", "batch_key", "batch_folder", "input_row_number", "url"
        ])
        writer.writeheader()
        for r in records:
            writer.writerow({
                "batch_order": r.batch_order,
                "batch_key": r.batch_key,
                "batch_folder": r.batch_folder,
                "input_row_number": r.input_row_number,
                "url": r.url,
            })

    # Per-batch URL lists.
    for batch_key, batch in sorted(BATCHES.items(), key=lambda kv: kv[1].order):
        batch_records = [r for r in records if r.batch_key == batch_key]
        batch_dir = out_dir / batch.folder
        batch_dir.mkdir(parents=True, exist_ok=True)
        with (batch_dir / "urls.csv").open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["url"])
            for r in batch_records:
                writer.writerow([r.url])


def export_manifest_csv(conn: sqlite3.Connection, out_dir: Path) -> None:
    rows = conn.execute(
        """
        SELECT url, batch_order, batch_key, batch_folder, status, http_status, content_type,
               content_length, body_sha256, body_path, meta_path, title, canonical_url,
               final_url, fetched_at, attempts, error, input_row_number, input_data_json
        FROM downloads
        ORDER BY batch_order, input_row_number, url
        """
    ).fetchall()
    headers = [
        "url", "batch_order", "batch_key", "batch_folder", "status", "http_status",
        "content_type", "content_length", "body_sha256", "body_path", "meta_path",
        "title", "canonical_url", "final_url", "fetched_at", "attempts", "error",
        "input_row_number", "input_data_json",
    ]
    with (out_dir / "manifest.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)

    summary_rows = conn.execute(
        """
        SELECT batch_order, batch_key, status, COUNT(*)
        FROM downloads
        GROUP BY batch_order, batch_key, status
        ORDER BY batch_order, COUNT(*) DESC
        """
    ).fetchall()
    with (out_dir / "summary_by_batch_status.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["batch_order", "batch_key", "status", "count"])
        writer.writerows(summary_rows)

    # Write one manifest per batch to make later processing easy.
    for batch_key, batch in sorted(BATCHES.items(), key=lambda kv: kv[1].order):
        batch_rows = [row for row in rows if row[2] == batch_key]
        if not batch_rows:
            continue
        batch_dir = out_dir / batch.folder
        batch_dir.mkdir(parents=True, exist_ok=True)
        with (batch_dir / "manifest.csv").open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            writer.writerows(batch_rows)


def selected_batches(records: List[UrlRecord], args: argparse.Namespace) -> List[UrlRecord]:
    allowed = set(args.batches or BATCHES.keys())
    if args.skip_other:
        allowed.discard("other")
    filtered = [r for r in records if r.batch_key in allowed]

    if args.limit_per_batch is None:
        return filtered

    counts: Dict[str, int] = {}
    limited: List[UrlRecord] = []
    for r in filtered:
        counts[r.batch_key] = counts.get(r.batch_key, 0) + 1
        if counts[r.batch_key] <= args.limit_per_batch:
            limited.append(r)
    return limited


def print_plan(records: List[UrlRecord]) -> None:
    print("\nBatch plan:")
    for batch_key, batch in sorted(BATCHES.items(), key=lambda kv: kv[1].order):
        count = sum(1 for r in records if r.batch_key == batch_key)
        if count:
            print(f"  {batch.folder:24s} {count:8,}  {batch.description}")


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Safely download Eater URLs in organised batches.")
    parser.add_argument("csv_path", type=Path, help="Input CSV containing a URL column")
    parser.add_argument("--url-column", default=None, help="URL column name. Auto-detected if omitted.")
    parser.add_argument("--out-dir", type=Path, default=Path("eater_downloads_batched"), help="Output directory")
    parser.add_argument("--email", default="you@example.com", help="Contact email for User-Agent")
    parser.add_argument("--user-agent", default=None, help="Override full User-Agent")
    parser.add_argument("--delay", type=float, default=3.0, help="Minimum seconds between requests to same host")
    parser.add_argument("--jitter", type=float, default=1.5, help="Random extra delay/backoff jitter")
    parser.add_argument("--batch-pause", type=float, default=30.0, help="Pause between batches, seconds")
    parser.add_argument("--respect-robots", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--robots-default-allow", action="store_true", help="Allow if robots.txt cannot be fetched. Default is conservative deny.")
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--backoff", type=float, default=10.0)
    parser.add_argument("--max-backoff", type=float, default=300.0)
    parser.add_argument("--connect-timeout", type=float, default=15.0)
    parser.add_argument("--read-timeout", type=float, default=45.0)
    parser.add_argument("--max-bytes", type=int, default=10_000_000)
    parser.add_argument("--html-only", action="store_true", help="Only save HTML/XHTML responses")
    parser.add_argument("--text-only", action="store_true", help="Only save text-like responses")
    parser.add_argument("--limit", type=int, default=None, help="Only consider first N unique URLs before batching")
    parser.add_argument("--limit-per-batch", type=int, default=None, help="Only download first N URLs in each batch")
    parser.add_argument("--batches", nargs="+", choices=sorted(BATCHES.keys()), help="Only run selected batches")
    parser.add_argument("--skip-other", action="store_true", help="Do not download 99_other batch")
    parser.add_argument("--dry-run", action="store_true", help="Write batch plan, but do not download")
    parser.add_argument("--force", action="store_true", help="Re-download URLs even if already successful")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    if args.html_only and args.text_only:
        print("Choose only one of --html-only or --text-only", file=sys.stderr)
        return 2

    user_agent = args.user_agent or DEFAULT_USER_AGENT_TEMPLATE.format(email=args.email)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    all_records = read_input_csv(args.csv_path, args.url_column, args.limit)
    records = selected_batches(all_records, args)
    write_batch_plan(args.out_dir, records)

    print(f"Input: {args.csv_path}")
    print(f"Output directory: {args.out_dir}")
    print(f"User-Agent: {user_agent}")
    print(f"Delay per host: {args.delay}s + jitter up to {args.jitter}s")
    print(f"Pause between batches: {args.batch_pause}s")
    print(f"Respect robots.txt: {args.respect_robots}")
    print(f"Unique URLs in CSV before batch filtering: {len(all_records):,}")
    print(f"Unique URLs selected: {len(records):,}")
    print_plan(records)
    print(f"\nBatch plan written to: {args.out_dir / 'batch_plan.csv'}")

    if args.dry_run:
        print("Dry run complete. No URLs downloaded.")
        return 0

    conn = init_db(args.out_dir / "manifest.sqlite")
    robots = RobotsCache(
        user_agent=user_agent,
        timeout=int(args.connect_timeout + args.read_timeout),
        default_allow=args.robots_default_allow,
    )
    politeness = HostPoliteness(base_delay=args.delay, jitter=args.jitter)

    session = requests.Session()
    session.headers.update({
        "User-Agent": user_agent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "close",
    })

    processed = 0
    skipped_existing = 0

    for batch_key, batch in sorted(BATCHES.items(), key=lambda kv: kv[1].order):
        batch_records = [r for r in records if r.batch_key == batch_key]
        if not batch_records:
            continue
        if STOP_REQUESTED:
            break

        print("\n" + "=" * 80)
        print(f"Starting batch {batch.folder}: {batch.description}")
        print(f"URLs in batch: {len(batch_records):,}")
        print("=" * 80)

        for i, record in enumerate(batch_records, start=1):
            if STOP_REQUESTED:
                break
            if not args.force and existing_success(conn, record.url):
                skipped_existing += 1
                continue
            print(f"\n[{batch.folder} {i:,}/{len(batch_records):,}] {record.url}")
            download_one(session, conn, record, args.out_dir, args, robots, politeness)
            processed += 1

        export_manifest_csv(conn, args.out_dir)

        if STOP_REQUESTED:
            break
        if args.batch_pause > 0 and batch_key != sorted(BATCHES, key=lambda k: BATCHES[k].order)[-1]:
            print(f"Pausing {args.batch_pause:.1f}s before next batch...")
            time.sleep(args.batch_pause)

    export_manifest_csv(conn, args.out_dir)
    conn.close()

    print("\nDone.")
    print(f"Processed this run: {processed:,}")
    print(f"Skipped existing successes: {skipped_existing:,}")
    print(f"Manifest DB: {args.out_dir / 'manifest.sqlite'}")
    print(f"Manifest CSV: {args.out_dir / 'manifest.csv'}")
    print(f"Summary CSV: {args.out_dir / 'summary_by_batch_status.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
