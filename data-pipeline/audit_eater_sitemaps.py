import csv
import gzip
import re
import time
from dataclasses import dataclass
from typing import Iterable, Optional
from urllib.parse import urlparse, urlunparse

import requests
from xml.etree import ElementTree as ET


SITEMAP_ROOTS = [
    "https://www.eater.com/sitemaps",
    "https://london.eater.com/sitemaps",
]

HEADERS = {
    "User-Agent": "EaterLondonResearchBot/1.0 contact@example.com"
}

REQUEST_TIMEOUT = 30
REQUEST_DELAY_SECONDS = 0.25
MAX_SITEMAPS = 20_000


@dataclass
class PriorityItem:
    priority: int
    name: str
    kind: str  # "exact", "prefix", or "regex"
    value: str
    expected_in_sitemap: bool
    notes: str = ""


PRIORITY_ITEMS = [
    # Highest-quality exact map pages.
    PriorityItem(1, "Current Eater 38 London", "exact",
                 "https://www.eater.com/maps/best-london-restaurants-eater-38", True),
    PriorityItem(2, "London Eater map articles", "prefix",
                 "https://london.eater.com/maps/", True),
    PriorityItem(3, "Best vegan restaurants London", "exact",
                 "https://www.eater.com/maps/best-vegan-restaurants-london", True),
    PriorityItem(3, "Michelin-starred London restaurants", "exact",
                 "https://www.eater.com/maps/michelin-star-restaurants-london", True),
    PriorityItem(3, "London where-to-eat map", "exact",
                 "https://www.eater.com/maps/london-where-to-eat-map", True),
    PriorityItem(3, "Old London heat map 1", "exact",
                 "https://www.eater.com/maps/the-eater-london-heat-map-where-to-eat-right-now", True),
    PriorityItem(3, "Old London heat map 2", "exact",
                 "https://www.eater.com/maps/the-eater-london-heat-map-where-to-eat-right-now-3", True),

    # Venue pages.
    PriorityItem(4, "London Eater venue pages", "regex",
                 r"^https://london\.eater\.com/venue/\d+/[^/?#]+/?$", True),
    PriorityItem(5, "Main Eater venue pages", "regex",
                 r"^https://www\.eater\.com/venue/\d+/[^/?#]+/?$", True),

    # London Eater category/index seeds.
    # These index pages may or may not be in sitemap; they are crawl seeds, not necessarily content URLs.
    PriorityItem(6, "London restaurant guides index", "exact",
                 "https://london.eater.com/london-restaurant-guides", False),
    PriorityItem(7, "Best food London neighbourhoods index", "exact",
                 "https://london.eater.com/best-food-london-neighbourhoods", False),
    PriorityItem(8, "Dining out London index", "exact",
                 "https://london.eater.com/dining-out-london", False),
    PriorityItem(9, "Where to eat in London index", "exact",
                 "https://london.eater.com/where-to-eat-in-london", False),
    PriorityItem(10, "Coffee shops and cafes London", "exact",
                 "https://london.eater.com/coffee-shops-cafes-london", False),
    PriorityItem(11, "Cocktails beer wine London", "exact",
                 "https://london.eater.com/cocktails-beer-wine", False),
    PriorityItem(12, "Michelin stars London restaurants", "exact",
                 "https://london.eater.com/michelin-stars-london-restaurants", False),
    PriorityItem(13, "Openings", "exact",
                 "https://london.eater.com/openings", False),
    PriorityItem(14, "News", "exact",
                 "https://london.eater.com/news", False),
    PriorityItem(15, "Daily restaurant news London", "exact",
                 "https://london.eater.com/daily-restaurant-news-london", False),
    PriorityItem(16, "Expansions", "exact",
                 "https://london.eater.com/expansions", False),
    PriorityItem(17, "Closings", "exact",
                 "https://london.eater.com/closings", False),
    PriorityItem(18, "London restaurant chains", "exact",
                 "https://london.eater.com/london-restaurant-chains", False),
    PriorityItem(19, "London chefs news", "exact",
                 "https://london.eater.com/london-chefs-news", False),
    PriorityItem(20, "Restaurant reviews news", "exact",
                 "https://london.eater.com/restaurant-reviews-news", False),
    PriorityItem(21, "Pop-ups", "exact",
                 "https://london.eater.com/pop-ups", False),
    PriorityItem(22, "Delivery", "exact",
                 "https://london.eater.com/delivery", False),
    PriorityItem(23, "London nightlife news", "exact",
                 "https://london.eater.com/london-nightlife-news", False),
    PriorityItem(24, "London celebrities spotted restaurants", "exact",
                 "https://london.eater.com/london-celebrities-spotted-restaurants", False),
    PriorityItem(25, "Eater archives category", "exact",
                 "https://london.eater.com/eater-archives", False),
    PriorityItem(26, "Pop culture food", "exact",
                 "https://london.eater.com/pop-culture-food", False),
    PriorityItem(27, "Food TV UK", "exact",
                 "https://london.eater.com/food-tv-uk", False),
    PriorityItem(28, "Cheap eats", "exact",
                 "https://london.eater.com/cheap-eats", False),
    PriorityItem(29, "Cookbooks UK", "exact",
                 "https://london.eater.com/cookbooks-uk", False),
    PriorityItem(30, "UK food policy", "exact",
                 "https://london.eater.com/uk-food-policy", False),
    PriorityItem(31, "London food media", "exact",
                 "https://london.eater.com/london-food-media", False),
    PriorityItem(32, "Novelty food", "exact",
                 "https://london.eater.com/novelty-food", False),

    # Archive/article patterns.
    PriorityItem(33, "London Eater dated article pages", "regex",
                 r"^https://london\.eater\.com/\d{4}/\d{1,2}/\d{1,2}/[^/?#]+/?$", True),
    PriorityItem(34, "London Eater monthly sitemap/archive entries", "regex",
                 r"^https://london\.eater\.com/sitemaps/entries/\d{4}/\d{1,2}/?$", False),
    PriorityItem(35, "London Eater neighbourhood pages", "regex",
                 r"^https://london\.eater\.com/neighborhood/\d+/[^/?#]+/?$", False),

    # Main-domain Eater.
    PriorityItem(36, "Main Eater London hub", "exact",
                 "https://www.eater.com/london", False),
    PriorityItem(37, "Main Eater London archive/article pages", "regex",
                 r"^https://www\.eater\.com/\d{4}/\d{1,2}/\d{1,2}/[^/?#]+/?$", True),
    PriorityItem(38, "Main Eater map pages", "prefix",
                 "https://www.eater.com/maps/", True),
    PriorityItem(39, "Main Eater video pages", "prefix",
                 "https://www.eater.com/video/", True),
    PriorityItem(40, "Main Eater awards pages", "prefix",
                 "https://www.eater.com/eater-awards", True),
    PriorityItem(41, "Main Eater Michelin pages", "prefix",
                 "https://www.eater.com/michelin", True),

    # Sitemaps themselves.
    PriorityItem(42, "Main Eater venue object sitemaps", "prefix",
                 "https://www.eater.com/sitemaps/objects/venue/", False),
    PriorityItem(43, "Main Eater video sitemaps", "prefix",
                 "https://www.eater.com/sitemaps/video/", False),
]


def normalize_url(url: str) -> str:
    """
    Normalise for comparison:
    - remove fragments
    - remove query params
    - lowercase scheme/host
    - remove trailing slash except root
    """
    parsed = urlparse(url.strip())
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()

    path = parsed.path or "/"
    if path != "/":
        path = path.rstrip("/")

    return urlunparse((scheme, netloc, path, "", "", ""))


def fetch_bytes(url: str) -> bytes:
    response = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()

    data = response.content

    # Handle .gz sitemap files or gzip-encoded XML.
    if url.endswith(".gz") or data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)

    return data


def xml_local_name(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def extract_locs_from_sitemap_xml(xml_bytes: bytes) -> tuple[str, list[str]]:
    """
    Returns:
      sitemap_type: "sitemapindex", "urlset", or "unknown"
      locs: list of loc URLs
    """
    root = ET.fromstring(xml_bytes)
    root_type = xml_local_name(root.tag)

    locs = []
    for elem in root.iter():
        if xml_local_name(elem.tag) == "loc" and elem.text:
            locs.append(elem.text.strip())

    return root_type, locs


def crawl_sitemaps(root_sitemaps: Iterable[str]) -> tuple[set[str], set[str]]:
    """
    Recursively crawl sitemap indexes.
    Returns:
      all_urls: content URLs found in urlsets
      all_sitemaps: sitemap URLs visited
    """
    to_visit = [normalize_url(u) for u in root_sitemaps]
    visited_sitemaps = set()
    content_urls = set()

    while to_visit:
        sitemap_url = to_visit.pop(0)
        if sitemap_url in visited_sitemaps:
            continue
        if len(visited_sitemaps) >= MAX_SITEMAPS:
            raise RuntimeError(f"Exceeded MAX_SITEMAPS={MAX_SITEMAPS}")

        print(f"Fetching sitemap: {sitemap_url}")
        visited_sitemaps.add(sitemap_url)

        try:
            xml_bytes = fetch_bytes(sitemap_url)
            sitemap_type, locs = extract_locs_from_sitemap_xml(xml_bytes)
        except Exception as exc:
            print(f"  ERROR: failed to parse {sitemap_url}: {exc}")
            continue

        if sitemap_type == "sitemapindex":
            for loc in locs:
                norm = normalize_url(loc)
                if norm not in visited_sitemaps:
                    to_visit.append(norm)

        elif sitemap_type == "urlset":
            for loc in locs:
                content_urls.add(normalize_url(loc))

        else:
            print(f"  WARNING: unknown sitemap root type {sitemap_type!r} at {sitemap_url}")

        time.sleep(REQUEST_DELAY_SECONDS)

    return content_urls, visited_sitemaps


def item_matches_url(item: PriorityItem, url: str) -> bool:
    norm = normalize_url(url)

    if item.kind == "exact":
        return norm == normalize_url(item.value)

    if item.kind == "prefix":
        return norm.startswith(normalize_url(item.value))

    if item.kind == "regex":
        return re.search(item.value, norm) is not None

    raise ValueError(f"Unknown item kind: {item.kind}")


def audit_priority_items(
    sitemap_urls: set[str],
    sitemap_urls_plus_sitemaps: set[str],
    priority_items: list[PriorityItem],
):
    audit_rows = []
    match_rows = []

    for item in priority_items:
        search_space = sitemap_urls_plus_sitemaps if item.value.startswith("https://") and "/sitemaps/" in item.value else sitemap_urls

        matches = sorted(
            url for url in search_space
            if item_matches_url(item, url)
        )

        status = "present" if matches else "missing"

        # For index/category seed pages, missing from sitemap may be expected.
        if status == "missing" and not item.expected_in_sitemap:
            severity = "info_seed_not_in_sitemap"
        elif status == "missing" and item.expected_in_sitemap:
            severity = "warning_missing_expected_content"
        else:
            severity = "ok"

        audit_rows.append({
            "priority": item.priority,
            "name": item.name,
            "kind": item.kind,
            "value": item.value,
            "expected_in_sitemap": item.expected_in_sitemap,
            "match_count": len(matches),
            "status": status,
            "severity": severity,
            "sample_match_1": matches[0] if len(matches) > 0 else "",
            "sample_match_2": matches[1] if len(matches) > 1 else "",
            "sample_match_3": matches[2] if len(matches) > 2 else "",
            "notes": item.notes,
        })

        for matched_url in matches:
            match_rows.append({
                "priority": item.priority,
                "name": item.name,
                "matched_url": matched_url,
            })

    return audit_rows, match_rows


def write_csv(path: str, rows: list[dict]):
    if not rows:
        return

    fieldnames = list(rows[0].keys())

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    sitemap_urls, visited_sitemaps = crawl_sitemaps(SITEMAP_ROOTS)

    print()
    print(f"Visited sitemaps: {len(visited_sitemaps):,}")
    print(f"Content URLs found: {len(sitemap_urls):,}")

    # For checking sitemap paths themselves, include visited sitemap URLs too.
    sitemap_urls_plus_sitemaps = set(sitemap_urls) | set(visited_sitemaps)

    sitemap_rows = [{"url": url} for url in sorted(sitemap_urls)]
    write_csv("eater_sitemap_urls.csv", sitemap_rows)

    audit_rows, match_rows = audit_priority_items(
        sitemap_urls=sitemap_urls,
        sitemap_urls_plus_sitemaps=sitemap_urls_plus_sitemaps,
        priority_items=PRIORITY_ITEMS,
    )

    write_csv("priority_sitemap_audit.csv", audit_rows)
    write_csv("priority_sitemap_matches.csv", match_rows)

    print()
    print("Missing expected content:")
    for row in audit_rows:
        if row["severity"] == "warning_missing_expected_content":
            print(f"  P{row['priority']} {row['name']} | {row['kind']} | {row['value']}")

    print()
    print("Seed/index URLs not present in sitemap, probably OK:")
    for row in audit_rows:
        if row["severity"] == "info_seed_not_in_sitemap":
            print(f"  P{row['priority']} {row['name']} | {row['value']}")

    print()
    print("Wrote:")
    print("  eater_sitemap_urls.csv")
    print("  priority_sitemap_audit.csv")
    print("  priority_sitemap_matches.csv")


if __name__ == "__main__":
    main()