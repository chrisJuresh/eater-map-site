// Central app state (Svelte 5 runes class). One instance, created by the page,
// passed to components as a prop; components read/mutate it directly.

import { SEARCH_LIMIT } from './constants.js';
import { filterRestaurants } from './data.js';

export class AppState {
  // Data
  restaurants = $state([]);
  byId = new Map();
  stats = $state(null);
  loading = $state(true);
  loadError = $state('');

  // Filters / selection
  query = $state('');
  priceFilter = $state('all');
  selected = $state(null);

  // Connectivity / environment
  online = $state(true);
  isAndroid = false;
  isIos = false;
  isStandalone = $state(false);

  // Geolocation
  userLocation = $state(null);
  locationStatus = $state('');

  // Offline download / install
  offlineState = $state('unknown'); // 'downloading' | 'ready' | 'idle' | 'unknown'
  downloadLoaded = $state(0);
  downloadTotal = $state(0);
  canInstall = $state(false);
  showInstallHelp = $state(false);

  // Map-derived UI state
  visibleMarkerCount = $state(0);
  inView = $state([]); // settled list of restaurants in the current viewport
  hoverLines = $state(null); // { x, y, w, h, flipX, flipY, items:[{name,color}] }
  linesPopup = $state(null);
  topbarHeight = $state(56);

  // Derived
  searchText = $derived(this.query.trim().toLowerCase());
  filtered = $derived(filterRestaurants(this.restaurants, this.searchText, this.priceFilter));
  searchResults = $derived(this.searchText ? this.filtered.slice(0, SEARCH_LIMIT) : []);
  totalCount = $derived(this.stats?.restaurantCount || this.restaurants.length);
  downloadPercent = $derived(
    this.downloadTotal ? Math.min(100, Math.round((this.downloadLoaded / this.downloadTotal) * 100)) : 0
  );
  activeLines = $derived(this.hoverLines || this.linesPopup);

  setRestaurants(restaurants, stats) {
    this.restaurants = restaurants;
    this.byId = new Map(restaurants.map((r) => [r.id, r]));
    this.stats = stats;
  }

  select(restaurant) {
    this.selected = restaurant;
  }

  closeDetails() {
    this.selected = null;
  }
}
