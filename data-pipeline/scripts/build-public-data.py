#!/usr/bin/env python3
"""Build the minimal public dataset used by the SvelteKit map.

The source scrape database is intentionally rich and audit-friendly, but it is
too large for a small static hosting payload. This script creates a compact
SQLite database with only the fields the website currently reads, then exports
the matching JSON file consumed by the browser.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE_DB = REPO_ROOT / "data-pipeline" / "raw-downloads" / "01_maps" / "eater_maps.sqlite"
DEFAULT_PUBLIC_DB = REPO_ROOT / "data" / "eater-map-public.sqlite"
DEFAULT_PUBLIC_JSON = REPO_ROOT / "static" / "data" / "restaurants.json"


SOURCE_QUERY = """
SELECT
    e.entry_id AS id,
    e.restaurant_name AS name,
    COALESCE(e.entry_anchor_url, p.page_url) AS entry_url,
    p.page_title AS page_title,
    e.description_text AS description,
    COALESCE(e.address, e.venue_address) AS address,
    e.latitude AS lat,
    e.longitude AS lon,
    COALESCE(e.google_maps_search_url, e.source_google_maps_url) AS google_maps_url,
    e.website_url AS website_url,
    e.phone_number AS phone,
    e.price_range AS price_range,
    e.open_for AS open_for,
    e.best_for AS best_for,
    e.must_try_dish AS must_try_dish,
    e.know_before_you_go AS know_before_you_go,
    e.outdoor_seating AS outdoor_seating,
    e.additional_location_notes AS additional_location_notes,
    e.booking_url AS booking_url,
    e.booking_provider AS booking_provider
FROM restaurant_entries e
JOIN pages p ON p.page_id = e.page_id
WHERE e.latitude IS NOT NULL
  AND e.longitude IS NOT NULL
  AND e.restaurant_name IS NOT NULL
ORDER BY e.restaurant_name, p.page_title, e.entry_position
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-db", type=Path, default=DEFAULT_SOURCE_DB, help="Rich scrape SQLite database to read.")
    parser.add_argument("--public-db", type=Path, default=DEFAULT_PUBLIC_DB, help="Minimal SQLite database to write.")
    parser.add_argument("--json", type=Path, default=DEFAULT_PUBLIC_JSON, help="Website JSON payload to write.")
    return parser.parse_args()


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def public_restaurant(row: sqlite3.Row) -> dict[str, Any]:
    restaurant = {
        "id": clean_text(row["id"]),
        "name": clean_text(row["name"]),
        "entryUrl": clean_text(row["entry_url"]),
        "pageTitle": clean_text(row["page_title"]),
        "description": clean_text(row["description"]),
        "address": clean_text(row["address"]),
        "lat": round(float(row["lat"]), 6),
        "lon": round(float(row["lon"]), 6),
        "googleMapsUrl": clean_text(row["google_maps_url"]),
        "websiteUrl": clean_text(row["website_url"]),
        "phone": clean_text(row["phone"]),
        "priceRange": clean_text(row["price_range"]),
        "openFor": clean_text(row["open_for"]),
        "bestFor": clean_text(row["best_for"]),
        "mustTryDish": clean_text(row["must_try_dish"]),
        "knowBeforeYouGo": clean_text(row["know_before_you_go"]),
        "outdoorSeating": clean_text(row["outdoor_seating"]),
        "additionalLocationNotes": clean_text(row["additional_location_notes"]),
        "bookingUrl": clean_text(row["booking_url"]),
        "bookingProvider": clean_text(row["booking_provider"]),
    }
    return {key: value for key, value in restaurant.items() if value is not None}


def snake_restaurant(restaurant: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": restaurant.get("id"),
        "name": restaurant.get("name"),
        "entry_url": restaurant.get("entryUrl"),
        "page_title": restaurant.get("pageTitle"),
        "description": restaurant.get("description"),
        "address": restaurant.get("address"),
        "lat": restaurant.get("lat"),
        "lon": restaurant.get("lon"),
        "google_maps_url": restaurant.get("googleMapsUrl"),
        "website_url": restaurant.get("websiteUrl"),
        "phone": restaurant.get("phone"),
        "price_range": restaurant.get("priceRange"),
        "open_for": restaurant.get("openFor"),
        "best_for": restaurant.get("bestFor"),
        "must_try_dish": restaurant.get("mustTryDish"),
        "know_before_you_go": restaurant.get("knowBeforeYouGo"),
        "outdoor_seating": restaurant.get("outdoorSeating"),
        "additional_location_notes": restaurant.get("additionalLocationNotes"),
        "booking_url": restaurant.get("bookingUrl"),
        "booking_provider": restaurant.get("bookingProvider"),
    }


def compute_stats(source: sqlite3.Connection, restaurants: list[dict[str, Any]]) -> dict[str, Any]:
    lats = [restaurant["lat"] for restaurant in restaurants]
    lons = [restaurant["lon"] for restaurant in restaurants]
    price_counts: dict[str, int] = {}
    for restaurant in restaurants:
        key = restaurant.get("priceRange") or "none"
        price_counts[key] = price_counts.get(key, 0) + 1
    page_count = source.execute("SELECT COUNT(*) FROM pages").fetchone()[0]
    bounds = {
        "minLat": min(lats),
        "maxLat": max(lats),
        "minLon": min(lons),
        "maxLon": max(lons),
    }
    return {
        "pageCount": page_count,
        "entryCount": len(restaurants),
        "priceCounts": price_counts,
        "bounds": bounds,
    }


def create_public_db(path: Path, stats: dict[str, Any], restaurants: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()

    conn = sqlite3.connect(path)
    try:
        conn.executescript(
            """
            PRAGMA journal_mode = OFF;
            PRAGMA synchronous = OFF;

            CREATE TABLE metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE restaurants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                entry_url TEXT,
                page_title TEXT,
                description TEXT,
                address TEXT,
                lat REAL NOT NULL,
                lon REAL NOT NULL,
                google_maps_url TEXT,
                website_url TEXT,
                phone TEXT,
                price_range TEXT,
                open_for TEXT,
                best_for TEXT,
                must_try_dish TEXT,
                know_before_you_go TEXT,
                outdoor_seating TEXT,
                additional_location_notes TEXT,
                booking_url TEXT,
                booking_provider TEXT
            );

            CREATE INDEX idx_restaurants_lat_lon ON restaurants(lat, lon);
            CREATE INDEX idx_restaurants_price_range ON restaurants(price_range);
            """
        )
        conn.executemany(
            """
            INSERT INTO restaurants (
                id, name, entry_url, page_title, description, address, lat, lon,
                google_maps_url, website_url, phone, price_range, open_for, best_for,
                must_try_dish, know_before_you_go, outdoor_seating,
                additional_location_notes, booking_url, booking_provider
            )
            VALUES (
                :id, :name, :entry_url, :page_title, :description, :address, :lat, :lon,
                :google_maps_url, :website_url, :phone, :price_range, :open_for, :best_for,
                :must_try_dish, :know_before_you_go, :outdoor_seating,
                :additional_location_notes, :booking_url, :booking_provider
            )
            """,
            [snake_restaurant(restaurant) for restaurant in restaurants],
        )
        conn.executemany(
            "INSERT INTO metadata (key, value) VALUES (?, ?)",
            [
                ("generated_at", datetime.now(timezone.utc).isoformat()),
                ("entry_count", str(stats["entryCount"])),
                ("page_count", str(stats["pageCount"])),
                ("bounds_json", json.dumps(stats["bounds"], separators=(",", ":"))),
                ("price_counts_json", json.dumps(stats["priceCounts"], separators=(",", ":"))),
            ],
        )
        conn.commit()
        conn.execute("VACUUM")
    finally:
        conn.close()


def write_public_json(path: Path, stats: dict[str, Any], restaurants: list[dict[str, Any]]) -> None:
    payload = {
        "stats": stats,
        "bounds": stats["bounds"],
        "restaurants": restaurants,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> int:
    args = parse_args()
    if not args.source_db.exists():
        raise SystemExit(f"Source database not found: {args.source_db}")

    source = sqlite3.connect(args.source_db)
    source.row_factory = sqlite3.Row
    try:
        restaurants = [public_restaurant(row) for row in source.execute(SOURCE_QUERY)]
        stats = compute_stats(source, restaurants)
    finally:
        source.close()

    create_public_db(args.public_db, stats, restaurants)
    write_public_json(args.json, stats, restaurants)

    source_size = args.source_db.stat().st_size
    db_size = args.public_db.stat().st_size
    json_size = args.json.stat().st_size
    print(f"Source DB: {source_size:,} bytes")
    print(f"Public DB: {db_size:,} bytes -> {args.public_db}")
    print(f"Public JSON: {json_size:,} bytes -> {args.json}")
    print(f"Entries: {stats['entryCount']:,}; pages: {stats['pageCount']:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
