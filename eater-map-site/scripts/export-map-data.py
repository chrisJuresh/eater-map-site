#!/usr/bin/env python3
"""Export compact map data from the SQLite database for the SvelteKit app."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "eater_downloads_batched" / "01_maps" / "eater_maps.sqlite"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "static" / "data" / "restaurants.json"


def json_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def main() -> int:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT
            e.entry_id,
            e.entry_position,
            e.entry_anchor_url,
            e.restaurant_name,
            e.description_text,
            e.address,
            e.venue_address,
            e.latitude,
            e.longitude,
            e.google_maps_search_url,
            e.google_maps_link_source,
            e.source_google_maps_url,
            e.website_url,
            e.phone_number,
            e.price_range,
            e.open_for,
            e.best_for,
            e.must_try_dish,
            e.know_before_you_go,
            e.outdoor_seating,
            e.additional_location_notes,
            e.booking_url,
            e.booking_provider,
            e.eater_venue_url,
            e.venue_slug,
            e.venue_title,
            e.venue_related_post_urls_json,
            e.venue_related_post_titles_json,
            p.page_id,
            p.page_title,
            p.page_url,
            p.page_description,
            p.published_at,
            p.modified_at_meta,
            p.category_titles_json
        FROM restaurant_entries e
        JOIN pages p ON p.page_id = e.page_id
        WHERE e.latitude IS NOT NULL
          AND e.longitude IS NOT NULL
        ORDER BY e.restaurant_name, p.page_title, e.entry_position
        """
    ).fetchall()

    restaurants = []
    min_lat = min_lon = float("inf")
    max_lat = max_lon = float("-inf")

    for row in rows:
        lat = float(row["latitude"])
        lon = float(row["longitude"])
        min_lat = min(min_lat, lat)
        max_lat = max(max_lat, lat)
        min_lon = min(min_lon, lon)
        max_lon = max(max_lon, lon)
        restaurants.append(
            {
                "id": row["entry_id"],
                "name": row["restaurant_name"],
                "position": row["entry_position"],
                "entryUrl": row["entry_anchor_url"],
                "pageId": row["page_id"],
                "pageTitle": row["page_title"],
                "pageUrl": row["page_url"],
                "pageDescription": row["page_description"],
                "publishedAt": row["published_at"],
                "modifiedAt": row["modified_at_meta"],
                "categories": json_list(row["category_titles_json"]),
                "description": row["description_text"] or "",
                "address": row["address"],
                "venueAddress": row["venue_address"],
                "lat": lat,
                "lon": lon,
                "googleMapsUrl": row["google_maps_search_url"],
                "googleMapsSource": row["google_maps_link_source"],
                "sourceGoogleMapsUrl": row["source_google_maps_url"],
                "websiteUrl": row["website_url"],
                "phone": row["phone_number"],
                "priceRange": row["price_range"],
                "openFor": row["open_for"],
                "bestFor": row["best_for"],
                "mustTryDish": row["must_try_dish"],
                "knowBeforeYouGo": row["know_before_you_go"],
                "outdoorSeating": row["outdoor_seating"],
                "additionalLocationNotes": row["additional_location_notes"],
                "bookingUrl": row["booking_url"],
                "bookingProvider": row["booking_provider"],
                "eaterVenueUrl": row["eater_venue_url"],
                "venueSlug": row["venue_slug"],
                "venueTitle": row["venue_title"],
                "relatedPostUrls": json_list(row["venue_related_post_urls_json"]),
                "relatedPostTitles": json_list(row["venue_related_post_titles_json"]),
            }
        )

    price_counts = dict(
        conn.execute(
            """
            SELECT COALESCE(price_range, 'none') AS price_range, COUNT(*) AS count
            FROM restaurant_entries
            GROUP BY COALESCE(price_range, 'none')
            """
        ).fetchall()
    )
    page_count = conn.execute("SELECT COUNT(*) FROM pages").fetchone()[0]

    payload = {
        "stats": {
            "pageCount": page_count,
            "entryCount": len(restaurants),
            "priceCounts": price_counts,
            "bounds": {
                "minLat": min_lat,
                "maxLat": max_lat,
                "minLon": min_lon,
                "maxLon": max_lon,
            },
        },
        "bounds": {
            "minLat": min_lat,
            "maxLat": max_lat,
            "minLon": min_lon,
            "maxLon": max_lon,
        },
        "restaurants": restaurants,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(restaurants):,} restaurants to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
