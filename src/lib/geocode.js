// Place/address geocoding via Nominatim (OpenStreetMap). Online only.

/** Exact query shape is tuned: GB-limited, London-biased viewbox. */
export function buildNominatimUrl(q) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'gb',
    'accept-language': 'en',
    viewbox: '-0.62,51.75,0.35,51.25', // bias toward London
    q
  });
  return `https://nominatim.openstreetmap.org/search?${params}`;
}

export async function geocodePlace(q, fetchFn = fetch) {
  const response = await fetchFn(buildNominatimUrl(q), { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Geocode failed with ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) && data.length ? data[0] : null;
}
