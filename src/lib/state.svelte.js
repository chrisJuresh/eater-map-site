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
  // Stations-within-a-walk popup, in the order they win: the cursor's, the last
  // tap's, then the selected restaurant's. Payload:
  // { lng, lat, title?, x, y, w, h, flipX, flipY, stations:[{name,minutes,lines}] }
  hoverLines = $state(null);
  linesPopup = $state(null);
  selectionLines = $state(null);
  /** Turning the popup off is for the map you are looking at now, not a setting:
   *  it lives in memory only, so every load starts with the stations shown. */
  stationsPopupEnabled = $state(true);
  topbarHeight = $state(56);
  // Chrome that covers the map, measured by the components that draw it. Map
  // container px (the map fills the viewport's top-left corner in both layouts).
  // 0 = not on screen.
  topbarBottom = $state(0);
  searchPanelBottom = $state(0);
  detailsSheetTop = $state(0);
  /** Below the 820px breakpoint the chrome floats OVER the map. */
  mobileLayout = $state(false);

  // Derived
  searchText = $derived(this.query.trim().toLowerCase());
  filtered = $derived(filterRestaurants(this.restaurants, this.searchText, this.priceFilter));
  searchResults = $derived(this.searchText ? this.filtered.slice(0, SEARCH_LIMIT) : []);
  totalCount = $derived(this.stats?.restaurantCount || this.restaurants.length);
  downloadPercent = $derived(
    this.downloadTotal ? Math.min(100, Math.round((this.downloadLoaded / this.downloadTotal) * 100)) : 0
  );
  // Switched off, the roots stay where they are and simply stop being drawn — so
  // switching back on shows the stations for whatever is still selected.
  activeLines = $derived(
    this.stationsPopupEnabled ? this.hoverLines || this.linesPopup || this.selectionLines : null
  );
  // The strip of map no chrome is covering — where a jumped-to restaurant and
  // its stations popup have to fit. Desktop's chrome sits beside the map (or in
  // a narrow gutter), so the whole container is free; mobile's is stacked over
  // it. A 0 bottom means nothing covers it: callers substitute the container.
  mapBandTop = $derived(this.mobileLayout ? this.searchPanelBottom || this.topbarBottom : 0);
  mapBandBottom = $derived(this.mobileLayout ? this.detailsSheetTop : 0);

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
