#!/usr/bin/env python3
"""Build an auditable SQLite database from downloaded Eater map pages."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import html
import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote_plus, urlparse

from lxml import html as lxml_html


DEFAULT_INPUT_DIR = Path("eater_downloads_batched/01_maps")
DEFAULT_DB_PATH = DEFAULT_INPUT_DIR / "eater_maps.sqlite"
DEFAULT_REVIEW_DIR = DEFAULT_INPUT_DIR / "review"


PAGE_COLUMNS = [
    "page_id",
    "page_global_id",
    "page_wp_id",
    "page_chorus_id",
    "page_chorus_uuid",
    "page_title",
    "page_headline",
    "page_social_headline",
    "page_url",
    "page_canonical_url",
    "page_input_url",
    "page_final_url",
    "page_slug",
    "page_description",
    "page_dek_text",
    "page_overview_text",
    "page_overview_html",
    "author_names_json",
    "author_urls_json",
    "primary_category_title",
    "primary_category_id",
    "category_titles_json",
    "category_slugs_json",
    "super_category_titles_json",
    "original_published_at",
    "published_at",
    "created_at",
    "updated_at",
    "modified_at_meta",
    "fetched_at",
    "word_count",
    "status",
    "resource_type",
    "lede_image_horizontal_url",
    "lede_image_square_url",
    "promo_image_horizontal_url",
    "promo_image_square_url",
    "og_image_url",
    "map_point_count",
    "rendered_map_card_count",
    "jsonld_item_count",
    "source_html_path",
    "source_meta_path",
    "status_code",
    "content_type",
    "content_length",
    "sha256",
    "raw_page_json",
    "raw_meta_json",
    "raw_jsonld_json",
]


ENTRY_COLUMNS = [
    "entry_id",
    "page_id",
    "entry_position",
    "entry_anchor_url",
    "entry_fragment",
    "restaurant_name",
    "entry_subtitle",
    "description_text",
    "description_html",
    "address",
    "venue_address",
    "latitude",
    "longitude",
    "google_maps_search_url",
    "google_maps_query",
    "google_maps_link_source",
    "source_google_maps_url",
    "website_url",
    "phone_number",
    "price_range",
    "open_for",
    "best_for",
    "must_try_dish",
    "know_before_you_go",
    "outdoor_seating",
    "additional_location_notes",
    "structured_notes_json",
    "booking_url",
    "booking_provider",
    "sevenrooms_reservation_url",
    "sevenrooms_url_key",
    "sevenrooms_venue_string_id",
    "opentable_reservation_url",
    "safegraph_booking_url",
    "campaign_custom_link_url",
    "venue_id",
    "venue_global_id",
    "venue_slug",
    "venue_title",
    "eater_venue_url",
    "point_image_horizontal_url",
    "point_image_square_url",
    "venue_image_horizontal_url",
    "venue_image_square_url",
    "venue_related_posts_count",
    "venue_related_post_urls_json",
    "venue_related_post_titles_json",
    "rendered_card_json",
    "raw_point_json",
    "raw_venue_json",
    "validation_status",
    "validation_issue_count",
    "validation_flags_json",
    "source_html_path",
]


class HeadMetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta_by_name: dict[str, str] = {}
        self.meta_by_property: dict[str, str] = {}
        self.links: list[dict[str, str]] = []
        self.title_parts: list[str] = []
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {k.lower(): v or "" for k, v in attrs}
        if tag.lower() == "title":
            self._in_title = True
        elif tag.lower() == "meta":
            content = attrs_dict.get("content", "")
            if "name" in attrs_dict:
                self.meta_by_name[attrs_dict["name"]] = content
            if "property" in attrs_dict:
                self.meta_by_property[attrs_dict["property"]] = content
        elif tag.lower() == "link":
            if attrs_dict.get("href"):
                self.links.append(attrs_dict)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title_parts.append(data)

    @property
    def title(self) -> str:
        return normalize_space(" ".join(self.title_parts))

    def canonical_url(self) -> str | None:
        for link in self.links:
            rel = link.get("rel", "")
            if "canonical" in rel.split():
                return link.get("href") or None
        return None


class TextAndLinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text_parts: list[str] = []
        self.links: list[dict[str, str]] = []
        self._link_stack: list[dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attrs_dict = {k.lower(): v or "" for k, v in attrs}
        if tag in {"br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4"}:
            self.text_parts.append(" ")
        if tag == "a":
            self._link_stack.append(
                {
                    "url": attrs_dict.get("href", ""),
                    "text_parts": [],
                    "target": attrs_dict.get("target", ""),
                }
            )

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "a" and self._link_stack:
            link = self._link_stack.pop()
            url = link.get("url")
            if url:
                self.links.append(
                    {
                        "url": url,
                        "text": normalize_space(" ".join(link["text_parts"])),
                        "target": link.get("target") or "",
                    }
                )
        if tag in {"p", "div", "li", "tr", "h1", "h2", "h3", "h4"}:
            self.text_parts.append(" ")

    def handle_data(self, data: str) -> None:
        self.text_parts.append(data)
        if self._link_stack:
            self._link_stack[-1]["text_parts"].append(data)

    def text(self) -> str:
        return normalize_space(" ".join(self.text_parts))


def normalize_space(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def html_to_text_and_links(fragment: str) -> tuple[str, list[dict[str, str]]]:
    parser = TextAndLinkExtractor()
    try:
        parser.feed(fragment or "")
        parser.close()
    except Exception:
        return normalize_space(re.sub(r"<[^>]+>", " ", html.unescape(fragment or ""))), []
    return parser.text(), parser.links


def first_existing(*values: Any) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


def maybe_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def maybe_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def get_nested(value: Any, *keys: str) -> Any:
    current = value
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def thumbnail_url(media: Any, shape: str) -> str | None:
    image = get_nested(media, "image") or media
    url = get_nested(image, "thumbnails", shape, "url")
    return url if isinstance(url, str) and url else None


def extract_next_data(html_text: str) -> dict[str, Any]:
    match = re.search(
        r"<script[^>]+id=[\"']__NEXT_DATA__[\"'][^>]*>(.*?)</script>",
        html_text,
        flags=re.I | re.S,
    )
    if not match:
        raise ValueError("missing __NEXT_DATA__ script")
    return json.loads(match.group(1))


def extract_jsonld(html_text: str) -> list[Any]:
    out = []
    for match in re.finditer(
        r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
        html_text,
        flags=re.I | re.S,
    ):
        raw = html.unescape(match.group(1)).strip()
        try:
            out.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return out


def jsonld_items(jsonld_values: list[Any]) -> list[dict[str, Any]]:
    for item in jsonld_values:
        candidates = item if isinstance(item, list) else [item]
        for candidate in candidates:
            if isinstance(candidate, dict) and candidate.get("@type") == "ItemList":
                elements = candidate.get("itemListElement")
                if isinstance(elements, list):
                    return [x for x in elements if isinstance(x, dict)]
    return []


def walk_map_resources(value: Any, path: str = "root") -> list[tuple[str, dict[str, Any]]]:
    found: list[tuple[str, dict[str, Any]]] = []
    if isinstance(value, dict):
        if isinstance(value.get("mapPoints"), list) and value.get("mapPoints"):
            found.append((path, value))
        for key, child in value.items():
            found.extend(walk_map_resources(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(walk_map_resources(child, f"{path}[{index}]"))
    return found


def current_page_resource(next_data: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    hydration = get_nested(next_data, "props", "pageProps", "hydration")
    preferred: list[tuple[str, dict[str, Any]]] = []
    if isinstance(hydration, dict):
        for index, response in enumerate(maybe_list(hydration.get("responses"))):
            node = get_nested(response, "data", "node")
            if isinstance(node, dict) and isinstance(node.get("mapPoints"), list) and node.get("mapPoints"):
                preferred.append((f"hydration.responses[{index}].data.node", node))
    candidates = preferred or walk_map_resources(next_data)
    if not candidates:
        raise ValueError("no MapResourceType with mapPoints found")
    candidates.sort(
        key=lambda item: (
            0 if item[0] == "hydration.responses[1].data.node" else 1,
            -len(item[1].get("mapPoints") or []),
        )
    )
    return candidates[0][1], [path for path, _ in candidates]


def block_to_html(block: dict[str, Any]) -> str:
    typename = block.get("__typename")
    if typename == "CoreParagraphBlockType":
        parts = [
            content.get("html", "")
            for content in maybe_list(block.get("paragraphContents"))
            if isinstance(content, dict)
        ]
        return "".join(f"<p>{part}</p>" for part in parts if part)
    if typename == "CoreListBlockType":
        tag = "ol" if block.get("ordered") else "ul"
        items = []
        for item in maybe_list(block.get("items")):
            content = get_nested(item, "contents", "html") or ""
            if content:
                items.append(f"<li>{content}</li>")
        return f"<{tag}>{''.join(items)}</{tag}>" if items else ""
    if typename == "CoreHTMLBlockType":
        return block.get("markup") or ""
    return ""


def page_overview(page: dict[str, Any]) -> tuple[str, str, list[dict[str, str]]]:
    html_parts = [block_to_html(block) for block in maybe_list(page.get("blocks")) if isinstance(block, dict)]
    html_text = "\n".join(part for part in html_parts if part)
    text, links = html_to_text_and_links(html_text)
    return text, html_text, links


STRUCTURED_DESCRIPTION_LABELS = {
    "open for": "open_for",
    "best for": "best_for",
    "must-try dish": "must_try_dish",
    "must try dish": "must_try_dish",
    "know before you go": "know_before_you_go",
    "outdoor seating": "outdoor_seating",
    "also at": "additional_location_notes",
    "a second location is at": "additional_location_notes",
    "price": "price_range",
    "price range": "price_range",
}

OTHER_NOTE_LABELS = {
    "chilli oil status",
    "vibe check",
    "pro tip",
    "nb",
}


def extract_price_range(value: str) -> str | None:
    match = re.search(r"\${1,4}", value or "")
    return match.group(0) if match else None


def merge_note(existing: str | None, value: str) -> str:
    value = normalize_space(value)
    if not value:
        return existing or ""
    if not existing:
        return value
    if value in existing:
        return existing
    return f"{existing}; {value}"


def description_values(point: dict[str, Any]) -> dict[str, Any]:
    html_parts = []
    text_parts = []
    links: list[dict[str, str]] = []
    components: dict[str, Any] = {
        "description_text": "",
        "description_html": "",
        "links": links,
        "price_range": None,
        "open_for": None,
        "best_for": None,
        "must_try_dish": None,
        "know_before_you_go": None,
        "outdoor_seating": None,
        "additional_location_notes": None,
        "structured_notes": {},
    }
    for part in maybe_list(point.get("description")):
        if not isinstance(part, dict):
            continue
        part_html = part.get("html") or ""
        part_text = normalize_space(part.get("plaintext") or html_to_text_and_links(part_html)[0])
        label_match = re.match(r"^([^:]{2,48}):\s*(.*)$", part_text)
        if label_match:
            raw_label = normalize_space(label_match.group(1))
            label_key = raw_label.casefold()
            label_value = normalize_space(label_match.group(2))
            component_key = STRUCTURED_DESCRIPTION_LABELS.get(label_key)
            if component_key == "price_range":
                price = extract_price_range(label_value or part_text)
                if price:
                    components["price_range"] = price
                    components["structured_notes"][raw_label] = price
                    continue
            elif component_key and label_value:
                components[component_key] = merge_note(components.get(component_key), label_value)
                components["structured_notes"][raw_label] = label_value
                continue
            elif label_key in OTHER_NOTE_LABELS and label_value:
                components["structured_notes"][raw_label] = label_value

        if part_html:
            html_parts.append(part_html)
            _, part_links = html_to_text_and_links(part_html)
            links.extend(part_links)
        if part_text:
            text_parts.append(part_text)
    components["description_text"] = normalize_space(" ".join(text_parts))
    components["description_html"] = "\n".join(html_parts)
    return components


def rendered_map_cards(html_text: str) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    doc = lxml_html.fromstring(html_text)
    cards_by_slug: dict[str, dict[str, Any]] = {}
    ordered_cards: list[dict[str, Any]] = []
    for card in doc.xpath('//*[@data-slug and @id]'):
        slug = card.get("id") or card.get("data-slug") or ""
        heading = normalize_space(" ".join(card.xpath(".//h2//text()")))
        rendered: dict[str, Any] = {
            "slug": slug,
            "data_slug": card.get("data-slug") or "",
            "heading": heading,
            "google_maps_url": None,
            "phone_number": None,
            "website_url": None,
            "booking_url": None,
            "links": [],
        }
        for anchor in card.xpath(".//a[@href]"):
            href = html.unescape(anchor.get("href") or "")
            titles = [normalize_space(t) for t in anchor.xpath(".//title/text()") if normalize_space(t)]
            text_parts = [
                normalize_space(t)
                for t in anchor.xpath(".//text()")
                if normalize_space(t) and normalize_space(t) not in {"Location", "Phone", "Link", "Booking", "External Link"}
            ]
            link_text = normalize_space(" ".join(text_parts))
            titles_text = " ".join(titles)
            link_kind = "rendered_card_link"
            if "google.com/maps" in href or "maps.google" in href:
                link_kind = "source_google_maps"
                rendered["google_maps_url"] = rendered["google_maps_url"] or href
            elif href.startswith("tel:"):
                link_kind = "source_phone"
                rendered["phone_number"] = rendered["phone_number"] or normalize_space(link_text or href.removeprefix("tel:"))
            elif "Booking" in titles_text or any(host in domain_for(href) for host in ["sevenrooms", "opentable", "resy"]):
                link_kind = "source_booking"
                rendered["booking_url"] = rendered["booking_url"] or href
            elif "Visit website" in link_text or ("Link" in titles_text and is_http_url(href) and "eater.com" not in domain_for(href)):
                link_kind = "source_website"
                rendered["website_url"] = rendered["website_url"] or href
            rendered["links"].append(
                {
                    "url": href,
                    "text": link_text,
                    "titles": titles,
                    "kind": link_kind,
                }
            )
        ordered_cards.append(rendered)
        if slug:
            cards_by_slug[slug] = rendered
        data_slug = rendered["data_slug"]
        if data_slug:
            cards_by_slug.setdefault(data_slug, rendered)
    return cards_by_slug, ordered_cards


def match_rendered_card(
    cards_by_slug: dict[str, dict[str, Any]],
    ordered_cards: list[dict[str, Any]],
    *,
    fragment: str | None,
    venue_slug: str | None,
    position: int,
) -> dict[str, Any]:
    for key in [fragment, venue_slug]:
        if key and key in cards_by_slug:
            return cards_by_slug[key]
    if 1 <= position <= len(ordered_cards):
        return ordered_cards[position - 1]
    return {}


def maps_query_from_url(url: str | None) -> str | None:
    if not url:
        return None
    try:
        return first_existing(*parse_qs(urlparse(url).query).get("query", []))
    except Exception:
        return None


def extract_urls_from_text(value: str) -> list[str]:
    if not value:
        return []
    return [match.group(0).rstrip(").,;\"'") for match in re.finditer(r"https?://[^\s<>()]+", value)]


def domain_for(url: str | None) -> str:
    if not url:
        return ""
    try:
        return urlparse(url).netloc.lower()
    except Exception:
        return ""


def same_url(left: str | None, right: str | None) -> bool:
    def norm(value: str | None) -> str:
        if not value:
            return ""
        parsed = urlparse(value)
        path = parsed.path.rstrip("/")
        return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}{path}"

    return norm(left) == norm(right)


def is_http_url(value: str | None) -> bool:
    if not value:
        return False
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def generated_google_maps_url(lat: Any, lon: Any, address: str | None) -> tuple[str | None, str | None]:
    query = None
    try:
        if lat is not None and lon is not None:
            query = f"{float(lat):.7f},{float(lon):.7f}"
    except (TypeError, ValueError):
        query = None
    if not query and address:
        query = address
    if not query:
        return None, None
    return f"https://www.google.com/maps/search/?api=1&query={quote_plus(query)}", query


def generated_venue_url(page_url: str | None, venue_slug: str | None) -> str | None:
    if not page_url or not venue_slug:
        return None
    parsed = urlparse(page_url)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}/venue/{venue_slug}"


def entry_anchor_url(page_url: str | None, slug: str | None, jsonld_by_position: dict[int, dict[str, Any]], position: int) -> str | None:
    item = maybe_dict(jsonld_by_position.get(position)).get("item")
    if isinstance(item, dict) and item.get("url"):
        return item["url"]
    if page_url and slug:
        return f"{page_url}#{slug}"
    return page_url


def choose_booking(venue: dict[str, Any], campaign_custom_link: Any) -> tuple[str | None, str | None, dict[str, Any]]:
    sevenrooms = maybe_dict(venue.get("sevenrooms"))
    opentable = maybe_dict(venue.get("opentable"))
    safegraph = maybe_dict(venue.get("safegraph"))
    campaign_url = None
    if isinstance(campaign_custom_link, dict):
        campaign_url = campaign_custom_link.get("url") or campaign_custom_link.get("href")
    elif isinstance(campaign_custom_link, str):
        campaign_url = campaign_custom_link

    candidates = [
        ("sevenrooms", sevenrooms.get("reservationWidgetUrl")),
        ("opentable", opentable.get("naturalReservationUrl")),
        ("safegraph", safegraph.get("bookingLink")),
        ("campaign_custom_link", campaign_url),
    ]
    for provider, url in candidates:
        if url:
            return provider, url, {
                "sevenrooms": sevenrooms,
                "opentable": opentable,
                "safegraph": safegraph,
                "campaign_custom_link_url": campaign_url,
            }
    return None, None, {
        "sevenrooms": sevenrooms,
        "opentable": opentable,
        "safegraph": safegraph,
        "campaign_custom_link_url": campaign_url,
    }


def related_posts(venue: dict[str, Any]) -> tuple[list[str], list[str]]:
    urls = []
    titles = []
    for post in maybe_list(get_nested(venue, "posts", "nodes")):
        if not isinstance(post, dict):
            continue
        if post.get("permalink"):
            urls.append(post["permalink"])
        if post.get("title"):
            titles.append(post["title"])
    return urls, titles


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA foreign_keys = ON;

        CREATE TABLE scrape_runs (
            run_id TEXT PRIMARY KEY,
            input_dir TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            page_count INTEGER,
            entry_count INTEGER,
            issue_count INTEGER,
            notes TEXT
        );

        CREATE TABLE pages (
            page_id TEXT PRIMARY KEY,
            page_global_id TEXT,
            page_wp_id INTEGER,
            page_chorus_id INTEGER,
            page_chorus_uuid TEXT,
            page_title TEXT,
            page_headline TEXT,
            page_social_headline TEXT,
            page_url TEXT,
            page_canonical_url TEXT,
            page_input_url TEXT,
            page_final_url TEXT,
            page_slug TEXT,
            page_description TEXT,
            page_dek_text TEXT,
            page_overview_text TEXT,
            page_overview_html TEXT,
            author_names_json TEXT,
            author_urls_json TEXT,
            primary_category_title TEXT,
            primary_category_id TEXT,
            category_titles_json TEXT,
            category_slugs_json TEXT,
            super_category_titles_json TEXT,
            original_published_at TEXT,
            published_at TEXT,
            created_at TEXT,
            updated_at TEXT,
            modified_at_meta TEXT,
            fetched_at TEXT,
            word_count INTEGER,
            status TEXT,
            resource_type TEXT,
            lede_image_horizontal_url TEXT,
            lede_image_square_url TEXT,
            promo_image_horizontal_url TEXT,
            promo_image_square_url TEXT,
            og_image_url TEXT,
            map_point_count INTEGER,
            rendered_map_card_count INTEGER,
            jsonld_item_count INTEGER,
            source_html_path TEXT,
            source_meta_path TEXT,
            status_code INTEGER,
            content_type TEXT,
            content_length INTEGER,
            sha256 TEXT,
            raw_page_json TEXT,
            raw_meta_json TEXT,
            raw_jsonld_json TEXT
        );

        CREATE TABLE restaurant_entries (
            entry_id TEXT PRIMARY KEY,
            page_id TEXT NOT NULL REFERENCES pages(page_id),
            entry_position INTEGER NOT NULL,
            entry_anchor_url TEXT,
            entry_fragment TEXT,
            restaurant_name TEXT,
            entry_subtitle TEXT,
            description_text TEXT,
            description_html TEXT,
            address TEXT,
            venue_address TEXT,
            latitude REAL,
            longitude REAL,
            google_maps_search_url TEXT,
            google_maps_query TEXT,
            google_maps_link_source TEXT,
            source_google_maps_url TEXT,
            website_url TEXT,
            phone_number TEXT,
            price_range TEXT,
            open_for TEXT,
            best_for TEXT,
            must_try_dish TEXT,
            know_before_you_go TEXT,
            outdoor_seating TEXT,
            additional_location_notes TEXT,
            structured_notes_json TEXT,
            booking_url TEXT,
            booking_provider TEXT,
            sevenrooms_reservation_url TEXT,
            sevenrooms_url_key TEXT,
            sevenrooms_venue_string_id TEXT,
            opentable_reservation_url TEXT,
            safegraph_booking_url TEXT,
            campaign_custom_link_url TEXT,
            venue_id TEXT,
            venue_global_id TEXT,
            venue_slug TEXT,
            venue_title TEXT,
            eater_venue_url TEXT,
            point_image_horizontal_url TEXT,
            point_image_square_url TEXT,
            venue_image_horizontal_url TEXT,
            venue_image_square_url TEXT,
            venue_related_posts_count INTEGER,
            venue_related_post_urls_json TEXT,
            venue_related_post_titles_json TEXT,
            rendered_card_json TEXT,
            raw_point_json TEXT,
            raw_venue_json TEXT,
            validation_status TEXT,
            validation_issue_count INTEGER,
            validation_flags_json TEXT,
            source_html_path TEXT
        );

        CREATE TABLE entry_links (
            link_id INTEGER PRIMARY KEY AUTOINCREMENT,
            scope TEXT NOT NULL,
            page_id TEXT REFERENCES pages(page_id),
            entry_id TEXT REFERENCES restaurant_entries(entry_id),
            source_field TEXT NOT NULL,
            link_kind TEXT,
            url TEXT NOT NULL,
            link_text TEXT,
            domain TEXT,
            is_external INTEGER
        );

        CREATE TABLE validation_issues (
            issue_id INTEGER PRIMARY KEY AUTOINCREMENT,
            severity TEXT NOT NULL,
            scope TEXT NOT NULL,
            page_id TEXT,
            entry_id TEXT,
            field_name TEXT,
            issue_code TEXT NOT NULL,
            message TEXT NOT NULL,
            source_value TEXT,
            source_html_path TEXT
        );

        CREATE TABLE manual_review_notes (
            review_note_id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_id INTEGER REFERENCES validation_issues(issue_id),
            scope TEXT NOT NULL,
            page_id TEXT,
            entry_id TEXT,
            field_name TEXT,
            issue_code TEXT,
            original_value TEXT,
            corrected_value TEXT,
            review_status TEXT DEFAULT 'pending',
            reviewer TEXT,
            reviewed_at TEXT,
            notes TEXT
        );

        CREATE INDEX idx_entries_page_id ON restaurant_entries(page_id);
        CREATE INDEX idx_entries_venue_id ON restaurant_entries(venue_id);
        CREATE INDEX idx_entries_name ON restaurant_entries(restaurant_name);
        CREATE INDEX idx_links_entry_id ON entry_links(entry_id);
        CREATE INDEX idx_validation_entry_id ON validation_issues(entry_id);
        CREATE INDEX idx_validation_page_id ON validation_issues(page_id);
        CREATE INDEX idx_review_notes_entry_id ON manual_review_notes(entry_id);

        CREATE VIEW entries_needing_review AS
        SELECT
            e.*,
            GROUP_CONCAT(v.issue_code, '; ') AS review_issue_codes,
            GROUP_CONCAT(v.message, ' | ') AS review_messages
        FROM restaurant_entries e
        JOIN validation_issues v ON v.entry_id = e.entry_id
        WHERE v.severity IN ('error', 'warning')
        GROUP BY e.entry_id;

        CREATE VIEW page_validation_summary AS
        SELECT
            p.page_id,
            p.page_title,
            p.page_url,
            p.map_point_count,
            SUM(CASE WHEN v.severity = 'error' THEN 1 ELSE 0 END) AS error_count,
            SUM(CASE WHEN v.severity = 'warning' THEN 1 ELSE 0 END) AS warning_count,
            SUM(CASE WHEN v.severity = 'info' THEN 1 ELSE 0 END) AS info_count
        FROM pages p
        LEFT JOIN validation_issues v ON v.page_id = p.page_id
        GROUP BY p.page_id;
        """
    )


def insert_dict(conn: sqlite3.Connection, table: str, columns: list[str], row: dict[str, Any]) -> None:
    placeholders = ",".join("?" for _ in columns)
    column_sql = ",".join(columns)
    conn.execute(
        f"INSERT INTO {table} ({column_sql}) VALUES ({placeholders})",
        [row.get(column) for column in columns],
    )


def add_link(
    links: list[dict[str, Any]],
    *,
    scope: str,
    page_id: str | None,
    entry_id: str | None,
    source_field: str,
    link_kind: str,
    url: str | None,
    link_text: str | None = None,
    page_domain: str | None = None,
) -> None:
    if not url:
        return
    links.append(
        {
            "scope": scope,
            "page_id": page_id,
            "entry_id": entry_id,
            "source_field": source_field,
            "link_kind": link_kind,
            "url": url,
            "link_text": link_text or "",
            "domain": domain_for(url),
            "is_external": 0 if page_domain and domain_for(url) == page_domain else 1,
        }
    )


def add_issue(
    issues: list[dict[str, Any]],
    *,
    severity: str,
    scope: str,
    page_id: str | None,
    entry_id: str | None,
    field_name: str | None,
    issue_code: str,
    message: str,
    source_value: Any = None,
    source_html_path: str | None = None,
) -> None:
    issues.append(
        {
            "severity": severity,
            "scope": scope,
            "page_id": page_id,
            "entry_id": entry_id,
            "field_name": field_name,
            "issue_code": issue_code,
            "message": message,
            "source_value": source_value if isinstance(source_value, str) else json_dumps(source_value),
            "source_html_path": source_html_path,
        }
    )


def validate_page(
    issues: list[dict[str, Any]],
    *,
    page_row: dict[str, Any],
    candidate_paths: list[str],
    jsonld_count: int,
    rendered_card_count: int,
) -> None:
    page_id = page_row["page_id"]
    source = page_row["source_html_path"]
    if len(candidate_paths) != 1:
        add_issue(
            issues,
            severity="warning",
            scope="page",
            page_id=page_id,
            entry_id=None,
            field_name="map_resource_candidates",
            issue_code="multiple_map_resource_candidates",
            message=f"Found {len(candidate_paths)} non-empty map resources; selected the preferred current page resource.",
            source_value=candidate_paths,
            source_html_path=source,
        )
    if page_row["page_final_url"] and page_row["page_url"] and not same_url(page_row["page_final_url"], page_row["page_url"]):
        add_issue(
            issues,
            severity="warning",
            scope="page",
            page_id=page_id,
            entry_id=None,
            field_name="page_url",
            issue_code="final_url_mismatch",
            message="Downloaded final URL differs from the page permalink.",
            source_value={"final_url": page_row["page_final_url"], "page_url": page_row["page_url"]},
            source_html_path=source,
        )
    if page_row["page_canonical_url"] and page_row["page_url"] and not same_url(page_row["page_canonical_url"], page_row["page_url"]):
        add_issue(
            issues,
            severity="warning",
            scope="page",
            page_id=page_id,
            entry_id=None,
            field_name="page_canonical_url",
            issue_code="canonical_url_mismatch",
            message="Canonical URL differs from the page permalink.",
            source_value={"canonical_url": page_row["page_canonical_url"], "page_url": page_row["page_url"]},
            source_html_path=source,
        )
    if jsonld_count and jsonld_count != page_row["map_point_count"]:
        add_issue(
            issues,
            severity="warning",
            scope="page",
            page_id=page_id,
            entry_id=None,
            field_name="jsonld_item_count",
            issue_code="jsonld_map_point_count_mismatch",
            message="JSON-LD item count differs from mapPoints count.",
            source_value={"jsonld_item_count": jsonld_count, "map_point_count": page_row["map_point_count"]},
            source_html_path=source,
        )
    if rendered_card_count and rendered_card_count != page_row["map_point_count"]:
        add_issue(
            issues,
            severity="warning",
            scope="page",
            page_id=page_id,
            entry_id=None,
            field_name="rendered_map_card_count",
            issue_code="rendered_card_count_mismatch",
            message="Rendered map-card count differs from mapPoints count.",
            source_value={"rendered_map_card_count": rendered_card_count, "map_point_count": page_row["map_point_count"]},
            source_html_path=source,
        )
    if not page_row["page_overview_text"]:
        add_issue(
            issues,
            severity="info",
            scope="page",
            page_id=page_id,
            entry_id=None,
            field_name="page_overview_text",
            issue_code="missing_page_overview_text",
            message="No visible overview/body blocks were found before the map entries.",
            source_html_path=source,
        )
    if not page_row["modified_at_meta"]:
        add_issue(
            issues,
            severity="info",
            scope="page",
            page_id=page_id,
            entry_id=None,
            field_name="modified_at_meta",
            issue_code="missing_modified_time_meta",
            message="No article:modified_time meta tag was found.",
            source_html_path=source,
        )


def validate_entry(
    issues: list[dict[str, Any]],
    *,
    entry: dict[str, Any],
    page_row: dict[str, Any],
    jsonld_by_position: dict[int, dict[str, Any]],
) -> None:
    page_id = entry["page_id"]
    entry_id = entry["entry_id"]
    source = entry["source_html_path"]
    required = [
        ("restaurant_name", "missing_restaurant_name", "Restaurant name is missing."),
        ("address", "missing_address", "Display address is missing."),
    ]
    for field, code, message in required:
        if not entry.get(field):
            add_issue(
                issues,
                severity="error",
                scope="entry",
                page_id=page_id,
                entry_id=entry_id,
                field_name=field,
                issue_code=code,
                message=message,
                source_html_path=source,
            )
    lat = entry.get("latitude")
    lon = entry.get("longitude")
    if lat is None or lon is None:
        add_issue(
            issues,
            severity="error",
            scope="entry",
            page_id=page_id,
            entry_id=entry_id,
            field_name="latitude,longitude",
            issue_code="missing_coordinates",
            message="Latitude or longitude is missing.",
            source_value={"latitude": lat, "longitude": lon},
            source_html_path=source,
        )
    else:
        try:
            lat_f = float(lat)
            lon_f = float(lon)
            if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
                raise ValueError("coordinate out of range")
        except (TypeError, ValueError):
            add_issue(
                issues,
                severity="error",
                scope="entry",
                page_id=page_id,
                entry_id=entry_id,
                field_name="latitude,longitude",
                issue_code="invalid_coordinates",
                message="Latitude or longitude is not a valid coordinate.",
                source_value={"latitude": lat, "longitude": lon},
                source_html_path=source,
            )
    if not entry.get("description_text"):
        add_issue(
            issues,
            severity="info",
            scope="entry",
            page_id=page_id,
            entry_id=entry_id,
            field_name="description_text",
            issue_code="missing_description",
            message="Entry description/body is missing in the source payload; core venue fields are still kept.",
            source_html_path=source,
        )
    elif len(entry["description_text"]) < 40:
        add_issue(
            issues,
            severity="info",
            scope="entry",
            page_id=page_id,
            entry_id=entry_id,
            field_name="description_text",
            issue_code="very_short_description",
            message="Entry description/body is unusually short but present in the source payload.",
            source_value=entry["description_text"],
            source_html_path=source,
        )
    if not entry.get("website_url"):
        add_issue(
            issues,
            severity="info",
            scope="entry",
            page_id=page_id,
            entry_id=entry_id,
            field_name="website_url",
            issue_code="missing_website_url",
            message="Restaurant website URL is missing in both the structured payload and rendered map card.",
            source_html_path=source,
        )
    elif not is_http_url(entry["website_url"]):
        add_issue(
            issues,
            severity="error",
            scope="entry",
            page_id=page_id,
            entry_id=entry_id,
            field_name="website_url",
            issue_code="invalid_website_url",
            message="Restaurant website URL is not a valid HTTP(S) URL.",
            source_value=entry["website_url"],
            source_html_path=source,
        )
    if not entry.get("phone_number"):
        add_issue(
            issues,
            severity="info",
            scope="entry",
            page_id=page_id,
            entry_id=entry_id,
            field_name="phone_number",
            issue_code="missing_phone_number",
            message="Restaurant phone number is missing in both the structured payload and rendered map card.",
            source_html_path=source,
        )
    if entry.get("booking_url") and not is_http_url(entry["booking_url"]):
        add_issue(
            issues,
            severity="error",
            scope="entry",
            page_id=page_id,
            entry_id=entry_id,
            field_name="booking_url",
            issue_code="invalid_booking_url",
            message="Booking URL is not a valid HTTP(S) URL.",
            source_value=entry["booking_url"],
            source_html_path=source,
        )
    if entry.get("restaurant_name") and entry.get("venue_title"):
        left = normalize_space(entry["restaurant_name"]).casefold()
        right = normalize_space(entry["venue_title"]).casefold()
        if left != right and "@" not in left and left not in right and right not in left:
            add_issue(
                issues,
                severity="info",
                scope="entry",
                page_id=page_id,
                entry_id=entry_id,
                field_name="restaurant_name,venue_title",
                issue_code="restaurant_name_venue_title_mismatch",
                message="Restaurant name differs from the nested venue title; this can be legitimate for dish-specific map entries.",
                source_value={"restaurant_name": entry["restaurant_name"], "venue_title": entry["venue_title"]},
                source_html_path=source,
            )
    jsonld_item = maybe_dict(jsonld_by_position.get(entry["entry_position"])).get("item")
    if isinstance(jsonld_item, dict):
        jsonld_name = jsonld_item.get("name")
        if jsonld_name and entry.get("restaurant_name") and normalize_space(jsonld_name) != normalize_space(entry["restaurant_name"]):
            add_issue(
                issues,
                severity="warning",
                scope="entry",
                page_id=page_id,
                entry_id=entry_id,
                field_name="restaurant_name",
                issue_code="jsonld_name_mismatch",
                message="JSON-LD item name differs from mapPoints restaurant name.",
                source_value={"jsonld_name": jsonld_name, "restaurant_name": entry["restaurant_name"]},
                source_html_path=source,
            )


def make_page_row(
    *,
    page: dict[str, Any],
    metadata: dict[str, Any],
    head: HeadMetadataParser,
    overview_text: str,
    overview_html: str,
    html_path: Path,
    meta_path: Path | None,
    jsonld_values: list[Any],
    jsonld_count: int,
    rendered_map_card_count: int,
) -> dict[str, Any]:
    page_url = page.get("permalink") or metadata.get("final_url") or metadata.get("url")
    page_id = page.get("globalId") or page.get("id") or hashlib.sha1(str(page_url).encode("utf-8")).hexdigest()
    authors = [a for a in maybe_list(page.get("authors")) if isinstance(a, dict)]
    categories = [c for c in maybe_list(page.get("categories")) if isinstance(c, dict)]
    super_cats = [c for c in maybe_list(page.get("superCats")) if isinstance(c, dict)]
    promo = maybe_dict(page.get("promo"))
    page_dek_html = first_existing(get_nested(page, "dek", "html"), get_nested(promo, "description", "html"))
    page_dek_text = html_to_text_and_links(page_dek_html or "")[0] if page_dek_html else ""
    parsed = urlparse(page_url or "")
    page_slug = parsed.path.strip("/").split("/")[-1] if parsed.path else ""

    return {
        "page_id": page_id,
        "page_global_id": page.get("globalId"),
        "page_wp_id": page.get("wpId"),
        "page_chorus_id": page.get("chorusId"),
        "page_chorus_uuid": page.get("chorusUuid"),
        "page_title": page.get("title"),
        "page_headline": first_existing(get_nested(page, "seo", "headline"), promo.get("headline"), head.meta_by_property.get("og:title"), head.title),
        "page_social_headline": first_existing(get_nested(page, "social", "headline"), head.meta_by_property.get("og:title")),
        "page_url": page_url,
        "page_canonical_url": first_existing(head.canonical_url(), metadata.get("canonical_url"), page.get("canonicalUrlOverride")),
        "page_input_url": get_nested(metadata, "input_data", "url") or metadata.get("url"),
        "page_final_url": metadata.get("final_url"),
        "page_slug": page_slug,
        "page_description": first_existing(get_nested(page, "seo", "description"), get_nested(page, "social", "description"), head.meta_by_name.get("description")),
        "page_dek_text": page_dek_text,
        "page_overview_text": overview_text,
        "page_overview_html": overview_html,
        "author_names_json": json_dumps([a.get("name") for a in authors if a.get("name")]),
        "author_urls_json": json_dumps([a.get("permalink") for a in authors if a.get("permalink")]),
        "primary_category_title": get_nested(page, "primaryCategory", "title"),
        "primary_category_id": get_nested(page, "primaryCategory", "id"),
        "category_titles_json": json_dumps([c.get("title") for c in categories if c.get("title")]),
        "category_slugs_json": json_dumps([c.get("slug") for c in categories if c.get("slug")]),
        "super_category_titles_json": json_dumps([c.get("title") for c in super_cats if c.get("title")]),
        "original_published_at": page.get("originalPublishedAt"),
        "published_at": page.get("publishedAt"),
        "created_at": page.get("createdAt"),
        "updated_at": page.get("updatedAt"),
        "modified_at_meta": head.meta_by_property.get("article:modified_time"),
        "fetched_at": metadata.get("fetched_at"),
        "word_count": page.get("wordCount"),
        "status": page.get("status"),
        "resource_type": page.get("resourceType"),
        "lede_image_horizontal_url": thumbnail_url(page.get("ledeMedia"), "horizontal"),
        "lede_image_square_url": thumbnail_url(page.get("ledeMedia"), "square"),
        "promo_image_horizontal_url": thumbnail_url(promo.get("image"), "horizontal"),
        "promo_image_square_url": thumbnail_url(promo.get("image"), "square"),
        "og_image_url": head.meta_by_property.get("og:image"),
        "map_point_count": len(page.get("mapPoints") or []),
        "rendered_map_card_count": rendered_map_card_count,
        "jsonld_item_count": jsonld_count,
        "source_html_path": str(html_path),
        "source_meta_path": str(meta_path) if meta_path else "",
        "status_code": metadata.get("status_code"),
        "content_type": metadata.get("content_type"),
        "content_length": metadata.get("content_length"),
        "sha256": metadata.get("sha256"),
        "raw_page_json": json_dumps(page),
        "raw_meta_json": json_dumps(metadata),
        "raw_jsonld_json": json_dumps(jsonld_values),
    }


def make_entry_row(
    *,
    page_row: dict[str, Any],
    point: dict[str, Any],
    position: int,
    jsonld_by_position: dict[int, dict[str, Any]],
    rendered_cards_by_slug: dict[str, dict[str, Any]],
    rendered_cards_order: list[dict[str, Any]],
    html_path: Path,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    venue = maybe_dict(point.get("venue"))
    location = maybe_dict(point.get("location"))
    related_urls, related_titles = related_posts(venue)
    venue_slug = venue.get("slug")
    anchor = entry_anchor_url(page_row.get("page_url"), venue_slug, jsonld_by_position, position)
    fragment = urlparse(anchor or "").fragment or venue_slug
    rendered_card = match_rendered_card(
        rendered_cards_by_slug,
        rendered_cards_order,
        fragment=fragment,
        venue_slug=venue_slug,
        position=position,
    )
    desc = description_values(point)
    lat = location.get("latitude")
    lon = location.get("longitude")
    generated_maps_url, generated_maps_query = generated_google_maps_url(lat, lon, point.get("address"))
    source_google_maps_url = rendered_card.get("google_maps_url")
    maps_url = source_google_maps_url or generated_maps_url
    maps_query = maps_query_from_url(source_google_maps_url) or generated_maps_query
    maps_source = "source_html" if source_google_maps_url else ("generated_coordinates" if lat is not None and lon is not None else "generated_address")
    booking_provider, booking_url, booking_data = choose_booking(venue, point.get("campaignCustomLink"))
    if not booking_url and rendered_card.get("booking_url"):
        booking_provider = "rendered_map_card"
        booking_url = rendered_card.get("booking_url")
    entry_id = f"{page_row['page_id']}:{position:03d}"

    row = {
        "entry_id": entry_id,
        "page_id": page_row["page_id"],
        "entry_position": position,
        "entry_anchor_url": anchor,
        "entry_fragment": fragment,
        "restaurant_name": point.get("name"),
        "entry_subtitle": None,
        "description_text": desc["description_text"],
        "description_html": desc["description_html"],
        "address": point.get("address"),
        "venue_address": venue.get("address"),
        "latitude": lat,
        "longitude": lon,
        "google_maps_search_url": maps_url,
        "google_maps_query": maps_query,
        "google_maps_link_source": maps_source,
        "source_google_maps_url": source_google_maps_url,
        "website_url": point.get("url") or rendered_card.get("website_url"),
        "phone_number": point.get("phone") or rendered_card.get("phone_number"),
        "price_range": desc["price_range"],
        "open_for": desc["open_for"],
        "best_for": desc["best_for"],
        "must_try_dish": desc["must_try_dish"],
        "know_before_you_go": desc["know_before_you_go"],
        "outdoor_seating": desc["outdoor_seating"],
        "additional_location_notes": desc["additional_location_notes"],
        "structured_notes_json": json_dumps(desc["structured_notes"]),
        "booking_url": booking_url,
        "booking_provider": booking_provider,
        "sevenrooms_reservation_url": booking_data["sevenrooms"].get("reservationWidgetUrl"),
        "sevenrooms_url_key": booking_data["sevenrooms"].get("urlKey"),
        "sevenrooms_venue_string_id": booking_data["sevenrooms"].get("venueStringId"),
        "opentable_reservation_url": booking_data["opentable"].get("naturalReservationUrl"),
        "safegraph_booking_url": booking_data["safegraph"].get("bookingLink"),
        "campaign_custom_link_url": booking_data["campaign_custom_link_url"],
        "venue_id": venue.get("id"),
        "venue_global_id": venue.get("globalId"),
        "venue_slug": venue_slug,
        "venue_title": venue.get("title"),
        "eater_venue_url": generated_venue_url(page_row.get("page_url"), venue_slug),
        "point_image_horizontal_url": thumbnail_url(point.get("ledeMedia"), "horizontal"),
        "point_image_square_url": thumbnail_url(point.get("ledeMedia"), "square"),
        "venue_image_horizontal_url": thumbnail_url(venue.get("ledeMedia"), "horizontal"),
        "venue_image_square_url": thumbnail_url(venue.get("ledeMedia"), "square"),
        "venue_related_posts_count": len(related_urls),
        "venue_related_post_urls_json": json_dumps(related_urls),
        "venue_related_post_titles_json": json_dumps(related_titles),
        "rendered_card_json": json_dumps(rendered_card),
        "raw_point_json": json_dumps(point),
        "raw_venue_json": json_dumps(venue),
        "validation_status": "pending",
        "validation_issue_count": 0,
        "validation_flags_json": "[]",
        "source_html_path": str(html_path),
    }
    return row, desc["links"]


def process_page(html_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    meta_path = Path(str(html_path) + ".meta.json")
    metadata: dict[str, Any] = {}
    if meta_path.exists():
        metadata = json.loads(meta_path.read_text(encoding="utf-8"))

    html_text = gzip.open(html_path, "rt", encoding="utf-8", errors="replace").read()
    head = HeadMetadataParser()
    head.feed(html_text)
    head.close()
    rendered_cards_by_slug, rendered_cards_order = rendered_map_cards(html_text)

    next_data = extract_next_data(html_text)
    page, candidate_paths = current_page_resource(next_data)
    jsonld_values = extract_jsonld(html_text)
    jsonld_elements = jsonld_items(jsonld_values)
    jsonld_by_position = {
        int(item.get("position")): item
        for item in jsonld_elements
        if isinstance(item.get("position"), int) or str(item.get("position", "")).isdigit()
    }
    overview_text, overview_html, overview_links = page_overview(page)
    page_row = make_page_row(
        page=page,
        metadata=metadata,
        head=head,
        overview_text=overview_text,
        overview_html=overview_html,
        html_path=html_path,
        meta_path=meta_path if meta_path.exists() else None,
        jsonld_values=jsonld_values,
        jsonld_count=len(jsonld_elements),
        rendered_map_card_count=len(rendered_cards_order),
    )
    page_domain = domain_for(page_row["page_url"])

    issues: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    validate_page(
        issues,
        page_row=page_row,
        candidate_paths=candidate_paths,
        jsonld_count=len(jsonld_elements),
        rendered_card_count=len(rendered_cards_order),
    )

    for link in overview_links:
        add_link(
            links,
            scope="page",
            page_id=page_row["page_id"],
            entry_id=None,
            source_field="page_overview_html",
            link_kind="body_link",
            url=link.get("url"),
            link_text=link.get("text"),
            page_domain=page_domain,
        )
    for source_field, url in [
        ("page_url", page_row["page_url"]),
        ("page_canonical_url", page_row["page_canonical_url"]),
        ("lede_image_horizontal_url", page_row["lede_image_horizontal_url"]),
        ("lede_image_square_url", page_row["lede_image_square_url"]),
        ("promo_image_horizontal_url", page_row["promo_image_horizontal_url"]),
        ("promo_image_square_url", page_row["promo_image_square_url"]),
        ("og_image_url", page_row["og_image_url"]),
    ]:
        add_link(
            links,
            scope="page",
            page_id=page_row["page_id"],
            entry_id=None,
            source_field=source_field,
            link_kind="page_asset" if "image" in source_field else "page_url",
            url=url,
            page_domain=page_domain,
        )
    for url in json.loads(page_row["author_urls_json"]):
        add_link(
            links,
            scope="page",
            page_id=page_row["page_id"],
            entry_id=None,
            source_field="author_urls_json",
            link_kind="author",
            url=url,
            page_domain=page_domain,
        )

    entries: list[dict[str, Any]] = []
    seen_venue_ids = Counter()
    seen_name_address = Counter()
    for position, point in enumerate(maybe_list(page.get("mapPoints")), start=1):
        if not isinstance(point, dict):
            continue
        entry, desc_links = make_entry_row(
            page_row=page_row,
            point=point,
            position=position,
            jsonld_by_position=jsonld_by_position,
            rendered_cards_by_slug=rendered_cards_by_slug,
            rendered_cards_order=rendered_cards_order,
            html_path=html_path,
        )
        entries.append(entry)
        validate_entry(issues, entry=entry, page_row=page_row, jsonld_by_position=jsonld_by_position)
        seen_venue_ids.update([entry.get("venue_id") or ""])
        seen_name_address.update([f"{entry.get('restaurant_name') or ''}|{entry.get('address') or ''}".casefold()])

        for link in desc_links:
            add_link(
                links,
                scope="entry",
                page_id=page_row["page_id"],
                entry_id=entry["entry_id"],
                source_field="description_html",
                link_kind="body_link",
                url=link.get("url"),
                link_text=link.get("text"),
                page_domain=page_domain,
            )
        for source_field, link_kind, url in [
            ("entry_anchor_url", "entry_anchor", entry["entry_anchor_url"]),
            ("website_url", "restaurant_website", entry["website_url"]),
            (
                "google_maps_search_url",
                "source_google_maps" if entry.get("google_maps_link_source") == "source_html" else "generated_google_maps_search",
                entry["google_maps_search_url"],
            ),
            ("booking_url", "booking", entry["booking_url"]),
            ("eater_venue_url", "generated_eater_venue", entry["eater_venue_url"]),
            ("point_image_horizontal_url", "entry_image", entry["point_image_horizontal_url"]),
            ("point_image_square_url", "entry_image", entry["point_image_square_url"]),
            ("venue_image_horizontal_url", "venue_image", entry["venue_image_horizontal_url"]),
            ("venue_image_square_url", "venue_image", entry["venue_image_square_url"]),
        ]:
            add_link(
                links,
                scope="entry",
                page_id=page_row["page_id"],
                entry_id=entry["entry_id"],
                source_field=source_field,
                link_kind=link_kind,
                url=url,
                page_domain=page_domain,
            )
        for url in json.loads(entry["venue_related_post_urls_json"]):
            add_link(
                links,
                scope="entry",
                page_id=page_row["page_id"],
                entry_id=entry["entry_id"],
                source_field="venue_related_post_urls_json",
                link_kind="venue_related_post",
                url=url,
                page_domain=page_domain,
            )
        for source_field in ["description_text", "address", "venue_address"]:
            for url in extract_urls_from_text(entry.get(source_field) or ""):
                add_link(
                    links,
                    scope="entry",
                    page_id=page_row["page_id"],
                    entry_id=entry["entry_id"],
                    source_field=source_field,
                    link_kind="inline_url",
                    url=url,
                    page_domain=page_domain,
                )

    for entry in entries:
        if entry.get("venue_id") and seen_venue_ids[entry["venue_id"]] > 1:
            add_issue(
                issues,
                severity="info",
                scope="entry",
                page_id=entry["page_id"],
                entry_id=entry["entry_id"],
                field_name="venue_id",
                issue_code="duplicate_venue_on_page",
                message="The same venue appears more than once on this page.",
                source_value=entry["venue_id"],
                source_html_path=entry["source_html_path"],
            )
        name_address = f"{entry.get('restaurant_name') or ''}|{entry.get('address') or ''}".casefold()
        if name_address.strip("|") and seen_name_address[name_address] > 1:
            add_issue(
                issues,
                severity="warning",
                scope="entry",
                page_id=entry["page_id"],
                entry_id=entry["entry_id"],
                field_name="restaurant_name,address",
                issue_code="duplicate_name_address_on_page",
                message="The same restaurant name and address appear more than once on this page.",
                source_value={"restaurant_name": entry.get("restaurant_name"), "address": entry.get("address")},
                source_html_path=entry["source_html_path"],
            )

    issue_codes_by_entry: dict[str, list[str]] = defaultdict(list)
    for issue in issues:
        if issue.get("entry_id"):
            issue_codes_by_entry[issue["entry_id"]].append(issue["issue_code"])
    for entry in entries:
        codes = issue_codes_by_entry.get(entry["entry_id"], [])
        entry["validation_issue_count"] = len(codes)
        entry["validation_flags_json"] = json_dumps(codes)
        entry["validation_status"] = "needs_review" if any(
            issue["entry_id"] == entry["entry_id"] and issue["severity"] in {"error", "warning"}
            for issue in issues
        ) else "validated"

    return page_row, entries, links, issues


def export_query(conn: sqlite3.Connection, output_path: Path, sql: str) -> int:
    cursor = conn.execute(sql)
    rows = cursor.fetchall()
    fieldnames = [description[0] for description in cursor.description or []]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as fh:
        if fieldnames:
            writer = csv.DictWriter(fh, fieldnames=fieldnames)
            writer.writeheader()
            if rows:
                writer.writerows(dict(row) for row in rows)
    return len(rows)


def build_database(input_dir: Path, db_path: Path, review_dir: Path) -> dict[str, Any]:
    raw_dir = input_dir / "raw"
    html_paths = sorted(raw_dir.rglob("*.html.gz"))
    if not html_paths:
        raise FileNotFoundError(f"No .html.gz files found under {raw_dir}")

    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    create_schema(conn)
    conn.execute(
        "INSERT INTO scrape_runs (run_id, input_dir, started_at, notes) VALUES (?, ?, ?, ?)",
        (run_id, str(input_dir), datetime.now(timezone.utc).isoformat(), "local Eater map scrape from __NEXT_DATA__"),
    )

    all_issues: list[dict[str, Any]] = []
    page_count = 0
    entry_count = 0
    for html_path in html_paths:
        try:
            page_row, entries, links, issues = process_page(html_path)
        except Exception as exc:
            fallback_page_id = hashlib.sha1(str(html_path).encode("utf-8")).hexdigest()
            page_row = {
                column: None for column in PAGE_COLUMNS
            }
            page_row.update(
                {
                    "page_id": fallback_page_id,
                    "source_html_path": str(html_path),
                    "source_meta_path": str(Path(str(html_path) + ".meta.json")),
                    "map_point_count": 0,
                    "rendered_map_card_count": 0,
                    "jsonld_item_count": 0,
                    "raw_page_json": "{}",
                    "raw_meta_json": "{}",
                    "raw_jsonld_json": "[]",
                }
            )
            insert_dict(conn, "pages", PAGE_COLUMNS, page_row)
            add_issue(
                all_issues,
                severity="error",
                scope="page",
                page_id=fallback_page_id,
                entry_id=None,
                field_name="source_html_path",
                issue_code="page_parse_failed",
                message=f"Failed to parse page: {exc}",
                source_value=str(html_path),
                source_html_path=str(html_path),
            )
            page_count += 1
            continue

        insert_dict(conn, "pages", PAGE_COLUMNS, page_row)
        for entry in entries:
            insert_dict(conn, "restaurant_entries", ENTRY_COLUMNS, entry)
        for link in links:
            insert_dict(
                conn,
                "entry_links",
                ["scope", "page_id", "entry_id", "source_field", "link_kind", "url", "link_text", "domain", "is_external"],
                link,
            )
        all_issues.extend(issues)
        page_count += 1
        entry_count += len(entries)

    for issue in all_issues:
        insert_dict(
            conn,
            "validation_issues",
            [
                "severity",
                "scope",
                "page_id",
                "entry_id",
                "field_name",
                "issue_code",
                "message",
                "source_value",
                "source_html_path",
            ],
            issue,
        )

    conn.execute(
        """
        UPDATE scrape_runs
        SET completed_at = ?, page_count = ?, entry_count = ?, issue_count = ?
        WHERE run_id = ?
        """,
        (datetime.now(timezone.utc).isoformat(), page_count, entry_count, len(all_issues), run_id),
    )
    conn.commit()

    review_dir.mkdir(parents=True, exist_ok=True)
    exports = {
        "pages_csv_rows": export_query(conn, review_dir / "pages.csv", "SELECT * FROM pages ORDER BY page_title"),
        "entries_csv_rows": export_query(
            conn,
            review_dir / "restaurant_entries.csv",
            "SELECT * FROM restaurant_entries ORDER BY page_id, entry_position",
        ),
        "issues_csv_rows": export_query(
            conn,
            review_dir / "validation_issues.csv",
            "SELECT * FROM validation_issues ORDER BY severity, page_id, entry_id, issue_id",
        ),
        "review_csv_rows": export_query(
            conn,
            review_dir / "entries_needing_review.csv",
            "SELECT * FROM entries_needing_review ORDER BY page_id, entry_position",
        ),
        "page_summary_csv_rows": export_query(
            conn,
            review_dir / "page_validation_summary.csv",
            "SELECT * FROM page_validation_summary ORDER BY error_count DESC, warning_count DESC, page_title",
        ),
        "manual_review_template_rows": export_query(
            conn,
            review_dir / "manual_review_template.csv",
            """
            SELECT
                v.issue_id,
                v.severity,
                v.scope,
                v.issue_code,
                v.field_name,
                p.page_title,
                p.page_url,
                e.entry_position,
                e.restaurant_name,
                e.address,
                e.website_url,
                e.phone_number,
                e.price_range,
                e.booking_url,
                e.source_google_maps_url,
                e.google_maps_search_url,
                e.google_maps_link_source,
                v.message,
                v.source_value,
                v.source_html_path,
                '' AS corrected_value,
                'pending' AS review_status,
                '' AS reviewer_notes
            FROM validation_issues v
            LEFT JOIN pages p ON p.page_id = v.page_id
            LEFT JOIN restaurant_entries e ON e.entry_id = v.entry_id
            WHERE v.severity IN ('error', 'warning')
            ORDER BY p.page_title, e.entry_position, v.issue_id
            """,
        ),
    }

    summary = {
        "db_path": str(db_path),
        "review_dir": str(review_dir),
        "page_count": page_count,
        "entry_count": entry_count,
        "issue_count": len(all_issues),
        "issue_counts_by_severity": dict(conn.execute(
            "SELECT severity, COUNT(*) AS count FROM validation_issues GROUP BY severity"
        ).fetchall()),
        "entries_needing_review": conn.execute("SELECT COUNT(*) FROM entries_needing_review").fetchone()[0],
        "exports": exports,
    }
    conn.close()
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR)
    parser.add_argument("--db-path", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--review-dir", type=Path, default=DEFAULT_REVIEW_DIR)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    summary = build_database(args.input_dir, args.db_path, args.review_dir)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
