# Eater Maps Database

This folder has been scraped into an auditable SQLite database:

- `eater_maps.sqlite`
- `review/pages.csv`
- `review/restaurant_entries.csv`
- `review/validation_issues.csv`
- `review/entries_needing_review.csv`
- `review/manual_review_template.csv`
- `review/page_validation_summary.csv`

## Source

The scraper reads every `raw/**/*.html.gz` file and its matching `.meta.json`.
Restaurant data comes from each page's embedded `__NEXT_DATA__` payload, specifically the current `MapResourceType.mapPoints` object. It also parses the rendered map cards in the HTML for source Google Maps links and contact links. Page metadata is cross-checked against HTML meta tags and JSON-LD.

## Main Tables

- `pages`: one row per Eater map page, including page URL, title/headlines, overview text/html, dates, authors, categories, images, rendered card count, download metadata, raw page JSON, and raw metadata JSON.
- `restaurant_entries`: one row per map point, including restaurant name, description text/html, address, venue address, coordinates, source Google Maps URL, website, phone, price range, open-for/best-for/must-try/know-before-you-go/outdoor-seating notes, booking fields, Eater venue URL, related post URLs, images, rendered card JSON, raw point JSON, raw venue JSON, and validation status.
- `entry_links`: extracted page and entry links, including body links, restaurant websites, booking URLs, source Google Maps links, images, venue links, author links, and related posts.
- `validation_issues`: one row per validation finding, with severity, field, issue code, message, source value, and source HTML path.
- `manual_review_notes`: empty table for recording manual corrections or decisions against validation issues.

## Validation

The scraper validates every page and entry for:

- parse failures
- missing or invalid coordinates
- missing names or addresses
- JSON-LD count/name mismatches
- final URL/canonical URL mismatches
- invalid website URLs
- missing source website URLs, phone numbers, or descriptions, as informational source gaps only
- duplicate same-name/address entries on a page
- duplicate venue IDs on a page
- restaurant name and venue title mismatches

Current run summary:

- Pages: 296
- Restaurant entries: 4,043
- Links captured: 29,992
- Entries validated without warning/error: 4,043
- Entries needing manual review: 0
- Parse failures: 0
- Invalid or missing coordinates: 0
- Source Google Maps links captured: 4,043
- Price ranges captured: 38

The rendered pages include Google Maps search URLs for every entry, and those are stored in `restaurant_entries.source_google_maps_url` and `restaurant_entries.google_maps_search_url` with `google_maps_link_source = 'source_html'`. If a future page lacks that source link, the scraper will generate a fallback from coordinates and mark the source accordingly.

Some pages store price labels as separate description fragments such as `Price range: $$`. Those are now extracted into `restaurant_entries.price_range` and removed from `description_text`.

## Manual Review

Start with:

```sql
SELECT * FROM entries_needing_review
ORDER BY page_title, entry_position;
```

Or use `review/manual_review_template.csv`, which has one row per warning/error issue plus blank `corrected_value`, `review_status`, and `reviewer_notes` columns. In the current run there are no warning/error issues, so this file only has a header.

To record decisions inside SQLite:

```sql
INSERT INTO manual_review_notes (
  issue_id, scope, page_id, entry_id, field_name, issue_code,
  original_value, corrected_value, review_status, reviewer, reviewed_at, notes
)
SELECT
  issue_id, scope, page_id, entry_id, field_name, issue_code,
  source_value, '', 'pending', '', datetime('now'), ''
FROM validation_issues
WHERE severity IN ('error', 'warning');
```

## Rebuild

From the workspace root:

```powershell
python scrape_eater_maps_to_db.py
```

If `python` is not on PATH in this Codex environment, use the bundled runtime:

```powershell
& "C:\Users\Chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scrape_eater_maps_to_db.py
```
