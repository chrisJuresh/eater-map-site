// Restaurant data loading, annotation, and filtering. Pure where possible.

/**
 * Spread markers that share the exact same coordinate into small rings so they
 * remain individually clickable.
 */
export function markerOffset(index, count) {
  if (count <= 1) return { x: 0, y: 0 };
  const ring = Math.floor(index / 8) + 1;
  const angle = ((index % 8) / 8) * Math.PI * 2;
  const radius = Math.min(24, 6 + ring * 5);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/** Annotate raw entries with numeric coords, ring offsets, and search text. */
export function annotateRestaurants(items) {
  const duplicateCounts = new Map();
  const duplicateSeen = new Map();
  for (const item of items) {
    const key = `${Number(item.lat).toFixed(6)},${Number(item.lon).toFixed(6)}`;
    duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
  }
  return items.map((item) => {
    const key = `${Number(item.lat).toFixed(6)},${Number(item.lon).toFixed(6)}`;
    const duplicateIndex = duplicateSeen.get(key) || 0;
    duplicateSeen.set(key, duplicateIndex + 1);
    const offset = markerOffset(duplicateIndex, duplicateCounts.get(key) || 1);
    return {
      ...item,
      lat: Number(item.lat),
      lon: Number(item.lon),
      offsetX: offset.x,
      offsetY: offset.y,
      searchText: [item.name, item.address, item.pageTitle, item.description, item.priceRange, item.openFor, item.bestFor]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    };
  });
}

/** The text+price filter used by search, markers, and the in-view list. */
export function filterRestaurants(restaurants, searchText, priceFilter) {
  return restaurants.filter((restaurant) => {
    if (priceFilter !== 'all' && restaurant.priceRange !== priceFilter) return false;
    if (!searchText) return true;
    return restaurant.searchText.includes(searchText);
  });
}

/** Great-circle distance in metres (for the in-view list's distance sort). */
export function distanceMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '';
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 9500 ? 1 : 0)} km`;
}

export async function loadRestaurants(fetchFn = fetch) {
  const response = await fetchFn('/data/restaurants.json');
  if (!response.ok) throw new Error(`Data request failed with ${response.status}`);
  const payload = await response.json();
  return {
    restaurants: annotateRestaurants(payload.restaurants || []),
    stats: payload.stats || null
  };
}
