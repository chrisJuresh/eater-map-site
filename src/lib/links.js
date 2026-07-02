// External link builders (Google Maps, Citymapper, share). Pure + unit-tested.

import { CITYMAPPER_ANDROID_PACKAGE, CITYMAPPER_ANDROID_STORE_URL, hasCoordinates } from './constants.js';

export function getGoogleMapsUrl(restaurant) {
  if (restaurant?.googleMapsUrl) return restaurant.googleMapsUrl;
  if (!hasCoordinates(restaurant)) return '';
  const query = [restaurant.name, restaurant.address].filter(Boolean).join(', ') || `${restaurant.lat},${restaurant.lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function getCitymapperUrl(restaurant, location = null, useAndroidIntent = false) {
  if (!hasCoordinates(restaurant)) return '';
  const params = new URLSearchParams({
    endcoord: `${restaurant.lat},${restaurant.lon}`,
    endname: restaurant.name || restaurant.address || 'Restaurant'
  });
  if (hasCoordinates(location)) {
    params.set('startcoord', `${location.lat},${location.lon}`);
    params.set('startname', 'Current Location');
  }
  const query = params.toString();
  if (!useAndroidIntent) return `https://citymapper.com/directions?${query}`;
  // Android intent: open the app directly, fall back to the Play Store listing.
  return `intent://directions?${query}#Intent;scheme=citymapper;package=${CITYMAPPER_ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(CITYMAPPER_ANDROID_STORE_URL)};end`;
}

/** Deep link to a restaurant on whatever origin the app is running on. */
export function buildShareUrl(origin, restaurant) {
  if (!restaurant?.id) return origin || '';
  return `${origin}/?r=${encodeURIComponent(restaurant.id)}`;
}
