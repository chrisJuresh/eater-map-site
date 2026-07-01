<script>
  import { onMount, tick } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { Protocol } from 'pmtiles';
  import { layers, namedFlavor } from '@protomaps/basemaps';

  const MAX_ZOOM = 18;
  const MIN_ZOOM = 4;
  const LOCATION_ZOOM = 14;
  const SEARCH_ZOOM = 15;
  // Zoom where the coarse GB basemap hands off to the detailed London basemap.
  const BASEMAP_HANDOFF_ZOOM = 9;
  const SEARCH_LIMIT = 80;
  const HOME_VIEW_PADDING = 32;
  const DESCRIPTION_VISIBLE_LINES = 4;
  const MOBILE_SEARCH_VISIBLE_RESULTS = 4;
  const CITYMAPPER_ANDROID_PACKAGE = 'com.citymapper.app.release';
  const CITYMAPPER_ANDROID_STORE_URL = `https://play.google.com/store/apps/details?id=${CITYMAPPER_ANDROID_PACKAGE}`;

  // ~97% of entries sit inside Greater London; this is the default/home view.
  const LONDON_BOUNDS = {
    minLat: 51.2868,
    maxLat: 51.6919,
    minLon: -0.5103,
    maxLon: 0.334
  };

  // Marker colour by price, matching the previous canvas renderer.
  const PRICE_COLOR_EXPR = [
    'match',
    ['get', 'priceRange'],
    '$', '#2d8a5f',
    '$$', '#2770a7',
    '$$$', '#7f52a1',
    '$$$$', '#252a31',
    '#d43d2f'
  ];

  let mapEl;
  let topbarEl;
  let map;
  let mapReady = false;
  let restaurants = [];
  let restaurantById = new Map();
  let stats = null;
  let loading = true;
  let loadError = '';
  let topbarHeight = 56;
  let selected = null;
  let query = '';
  let priceFilter = 'all';
  let visibleMarkerCount = 0;
  let userLocation = null;
  let locationStatus = '';
  let locationWatchId = null;
  let homeViewApplied = false;
  let mapWasInteractedWith = false;
  let lastMarkerPick = null;
  let resizeObserver;

  let descriptionEl;
  let descriptionHasMore = false;
  let descriptionCanScrollDown = false;
  let descriptionScrollbar = { top: 0, height: 100 };
  let descriptionMeasureToken = 0;
  let measuredDescriptionRestaurantId = '';
  let searchResultsEl;
  let searchResultsHasMore = false;
  let searchResultsScrollbar = { top: 0, height: 100 };
  let searchResultsMeasureToken = 0;
  let measuredSearchText = '';
  let isAndroidDevice = false;

  const prices = ['all', '$', '$$', '$$$', '$$$$'];
  const roadmapItems = [
    'Remove closed restaurants',
    'Add opening times',
    'Add rating information',
    'Add Google Maps cuisine categories',
    'Add Google Maps descriptions',
    'Validate existing data against Google Maps',
    'Use Google Maps price ranges',
    'Add other countries',
    'Expand to a larger database',
    'Deduplicate restaurants'
  ];

  onMount(() => {
    isAndroidDevice = /Android/i.test(navigator.userAgent || '');

    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    map = new maplibregl.Map({
      container: mapEl,
      style: buildStyle(),
      center: [(LONDON_BOUNDS.minLon + LONDON_BOUNDS.maxLon) / 2, (LONDON_BOUNDS.minLat + LONDON_BOUNDS.maxLat) / 2],
      zoom: 10,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: false
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation?.();

    map.on('error', (event) => console.error('MapLibre error:', event.error?.message || event.error, event.error));
    map.on('load', onMapLoad);
    map.on('movestart', (event) => {
      if (event.originalEvent) mapWasInteractedWith = true;
    });
    map.on('moveend', updateVisibleMarkerCount);
    map.on('idle', updateVisibleMarkerCount);

    resizeObserver = new ResizeObserver(() => {
      map?.resize();
      if (topbarEl) topbarHeight = Math.ceil(topbarEl.getBoundingClientRect().height);
      updateSearchResultsScrollState();
    });
    if (mapEl) resizeObserver.observe(mapEl);
    if (topbarEl) resizeObserver.observe(topbarEl);
    if (topbarEl) topbarHeight = Math.ceil(topbarEl.getBoundingClientRect().height);

    loadRestaurants();
    startLocationTracking();

    return () => {
      resizeObserver?.disconnect();
      stopLocationTracking();
      map?.remove();
      maplibregl.removeProtocol('pmtiles');
    };
  });

  function assetUrl(path) {
    const origin = typeof location !== 'undefined' ? location.origin : '';
    return `${origin}${path}`;
  }

  function buildStyle() {
    const flavor = namedFlavor('light');
    // Coarse whole-country tiles render below the handoff zoom; detailed London
    // tiles render at/above it. Splitting by zoom avoids double-drawn labels.
    const gbLayers = layers('gb', flavor, { lang: 'en' }).map((layer) => ({
      ...layer,
      maxzoom: BASEMAP_HANDOFF_ZOOM
    }));
    // The two layer sets share layer ids, so namespace the London ones to keep
    // them unique when both sets live in one style.
    const londonLayers = layers('london', flavor, { lang: 'en' }).map((layer) => ({
      ...layer,
      id: `london_${layer.id}`,
      minzoom: Math.max(layer.minzoom ?? 0, BASEMAP_HANDOFF_ZOOM)
    }));

    return {
      version: 8,
      glyphs: assetUrl('/basemap/fonts/{fontstack}/{range}.pbf'),
      sprite: assetUrl('/basemap/sprites/light'),
      sources: {
        gb: {
          type: 'vector',
          url: `pmtiles://${assetUrl('/basemap/gb.pmtiles')}`,
          attribution:
            '<a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
        },
        london: {
          type: 'vector',
          url: `pmtiles://${assetUrl('/basemap/london.pmtiles')}`
        }
      },
      layers: [...gbLayers, ...londonLayers]
    };
  }

  function onMapLoad() {
    map.addSource('restaurants', { type: 'geojson', data: emptyCollection() });
    map.addSource('user-accuracy', { type: 'geojson', data: emptyCollection() });
    map.addSource('user-point', { type: 'geojson', data: emptyCollection() });

    map.addLayer({
      id: 'restaurants',
      type: 'circle',
      source: 'restaurants',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 12, 5, 14, 6.5, 16, 8],
        'circle-color': PRICE_COLOR_EXPR,
        'circle-opacity': ['case', ['==', ['get', 'priceRange'], ''], 0.62, 0.95],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.85,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 1.2]
      }
    });

    map.addLayer({
      id: 'restaurant-price',
      type: 'symbol',
      source: 'restaurants',
      minzoom: 13,
      filter: ['!=', ['get', 'priceRange'], ''],
      layout: {
        'text-field': ['get', 'priceRange'],
        'text-font': ['Noto Sans Medium'],
        'text-size': 9,
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: {
        'text-color': '#ffffff'
      }
    });

    map.addLayer({
      id: 'user-accuracy',
      type: 'fill',
      source: 'user-accuracy',
      paint: {
        'fill-color': '#2563eb',
        'fill-opacity': 0.16
      }
    });

    map.addLayer({
      id: 'user-point',
      type: 'circle',
      source: 'user-point',
      paint: {
        'circle-radius': 8,
        'circle-color': '#2563eb',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3
      }
    });

    map.addLayer({
      id: 'restaurant-selected',
      type: 'circle',
      source: 'restaurants',
      filter: ['==', ['get', 'id'], '__none__'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 7, 14, 11, 16, 14],
        'circle-color': PRICE_COLOR_EXPR,
        'circle-opacity': 1,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3
      }
    });

    map.on('click', onMapClick);
    for (const layer of ['restaurants', 'restaurant-selected']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }

    mapReady = true;
    updateRestaurantSource(filteredRestaurants);
    updateSelectedFilter(selected);
    updateUserLocationLayers(userLocation);
    applyFallbackHomeView();
    updateVisibleMarkerCount();
  }

  function emptyCollection() {
    return { type: 'FeatureCollection', features: [] };
  }

  function toFeatureCollection(items) {
    return {
      type: 'FeatureCollection',
      features: items
        .filter(hasCoordinates)
        .map((restaurant) => ({
          type: 'Feature',
          id: restaurant.id,
          geometry: { type: 'Point', coordinates: [restaurant.lon, restaurant.lat] },
          properties: { id: restaurant.id, priceRange: restaurant.priceRange || '' }
        }))
    };
  }

  function updateRestaurantSource(items) {
    const source = map?.getSource('restaurants');
    if (source) source.setData(toFeatureCollection(items));
  }

  function updateSelectedFilter(restaurant) {
    if (!mapReady) return;
    map.setFilter('restaurant-selected', ['==', ['get', 'id'], restaurant?.id ?? '__none__']);
  }

  async function loadRestaurants() {
    try {
      const response = await fetch('/data/restaurants.json');
      if (!response.ok) throw new Error(`Data request failed with ${response.status}`);
      const payload = await response.json();
      restaurants = annotateRestaurants(payload.restaurants || []);
      restaurantById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
      stats = payload.stats || null;
      if (mapReady) {
        updateRestaurantSource(filteredRestaurants);
        applyFallbackHomeView();
        updateVisibleMarkerCount();
      }
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  function annotateRestaurants(items) {
    return items.map((item) => ({
      ...item,
      lat: Number(item.lat),
      lon: Number(item.lon),
      searchText: [
        item.name,
        item.address,
        item.pageTitle,
        item.description,
        item.priceRange,
        item.openFor,
        item.bestFor
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    }));
  }

  $: searchText = query.trim().toLowerCase();
  $: filteredRestaurants = restaurants.filter((restaurant) => {
    if (priceFilter !== 'all' && restaurant.priceRange !== priceFilter) return false;
    if (!searchText) return true;
    return restaurant.searchText.includes(searchText);
  });
  $: searchResults = searchText ? filteredRestaurants.slice(0, SEARCH_LIMIT) : [];
  $: selectedGoogleMapsUrl = selected ? getGoogleMapsUrl(selected) : '';
  $: selectedCitymapperUrl = selected ? getCitymapperUrl(selected, userLocation, isAndroidDevice) : '';
  $: totalCount = stats?.entryCount || restaurants.length;
  $: if (mapReady) updateRestaurantSource(filteredRestaurants);
  $: updateSelectedFilter(selected);
  $: if (mapReady) updateUserLocationLayers(userLocation);
  $: {
    searchText;
    searchResults.length;
    scheduleSearchResultsMeasure();
  }
  $: {
    selected?.id;
    selected?.description;
    scheduleDescriptionMeasure();
  }

  function updateVisibleMarkerCount() {
    if (!mapReady) return;
    const features = map.queryRenderedFeatures({ layers: ['restaurants'] });
    const ids = new Set();
    for (const feature of features) ids.add(feature.properties.id);
    if (visibleMarkerCount !== ids.size) visibleMarkerCount = ids.size;
  }

  function onMapClick(event) {
    const pad = 8; // tap tolerance in pixels
    const box = [
      [event.point.x - pad, event.point.y - pad],
      [event.point.x + pad, event.point.y + pad]
    ];
    const features = map.queryRenderedFeatures(box, {
      layers: ['restaurant-selected', 'restaurants']
    });
    if (!features.length) return;

    const seen = new Set();
    const ids = [];
    for (const feature of features) {
      const id = feature.properties.id;
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }

    const key = ids.join('|');
    const repeatedPick =
      lastMarkerPick &&
      lastMarkerPick.key === key &&
      Math.abs(lastMarkerPick.x - event.point.x) <= 18 &&
      Math.abs(lastMarkerPick.y - event.point.y) <= 18;
    const index = repeatedPick ? (lastMarkerPick.index + 1) % ids.length : 0;
    lastMarkerPick = { key, index, x: event.point.x, y: event.point.y };

    const restaurant = restaurantById.get(ids[index]);
    if (restaurant) selectRestaurant(restaurant);
  }

  function scheduleDescriptionMeasure() {
    const selectedRestaurantId = selected?.id || '';
    const token = ++descriptionMeasureToken;
    tick().then(() => {
      if (token !== descriptionMeasureToken) return;
      if (descriptionEl && selectedRestaurantId !== measuredDescriptionRestaurantId) {
        descriptionEl.scrollTop = 0;
        measuredDescriptionRestaurantId = selectedRestaurantId;
      }
      updateDescriptionScrollState();
    });
  }

  function updateDescriptionScrollState() {
    if (!descriptionEl) {
      descriptionHasMore = false;
      descriptionCanScrollDown = false;
      descriptionScrollbar = { top: 0, height: 100 };
      measuredDescriptionRestaurantId = '';
      return;
    }

    const maxScroll = Math.max(0, descriptionEl.scrollHeight - descriptionEl.clientHeight);
    descriptionHasMore = maxScroll > 1;
    descriptionCanScrollDown = maxScroll - descriptionEl.scrollTop > 1;
    const thumbHeight = descriptionHasMore ? clamp((descriptionEl.clientHeight / descriptionEl.scrollHeight) * 100, 18, 100) : 100;
    const thumbTop = descriptionHasMore && maxScroll ? (descriptionEl.scrollTop / maxScroll) * (100 - thumbHeight) : 0;
    descriptionScrollbar = { top: thumbTop, height: thumbHeight };
  }

  function scheduleSearchResultsMeasure() {
    const token = ++searchResultsMeasureToken;
    tick().then(() => {
      if (token !== searchResultsMeasureToken) return;
      if (searchResultsEl && searchText !== measuredSearchText) {
        searchResultsEl.scrollTop = 0;
        measuredSearchText = searchText;
      }
      updateSearchResultsScrollState();
    });
  }

  function updateSearchResultsScrollState() {
    if (!searchResultsEl) {
      searchResultsHasMore = false;
      searchResultsScrollbar = { top: 0, height: 100 };
      measuredSearchText = '';
      return;
    }

    const maxScroll = Math.max(0, searchResultsEl.scrollHeight - searchResultsEl.clientHeight);
    searchResultsHasMore = maxScroll > 1;
    const thumbHeight = searchResultsHasMore ? clamp((searchResultsEl.clientHeight / searchResultsEl.scrollHeight) * 100, 18, 100) : 100;
    const thumbTop = searchResultsHasMore && maxScroll ? (searchResultsEl.scrollTop / maxScroll) * (100 - thumbHeight) : 0;
    searchResultsScrollbar = { top: thumbTop, height: thumbHeight };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hasCoordinates(restaurant) {
    return Number.isFinite(restaurant?.lat) && Number.isFinite(restaurant?.lon);
  }

  function getGoogleMapsUrl(restaurant) {
    if (restaurant?.googleMapsUrl) return restaurant.googleMapsUrl;
    if (!hasCoordinates(restaurant)) return '';
    const query = [restaurant.name, restaurant.address].filter(Boolean).join(', ') || `${restaurant.lat},${restaurant.lon}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function getCitymapperUrl(restaurant, location = null, useAndroidIntent = false) {
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
    return `intent://directions?${query}#Intent;scheme=citymapper;package=${CITYMAPPER_ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(CITYMAPPER_ANDROID_STORE_URL)};end`;
  }

  function boundsAsLngLat(bounds) {
    return [
      [bounds.minLon, bounds.minLat],
      [bounds.maxLon, bounds.maxLat]
    ];
  }

  function applyFallbackHomeView() {
    if (!mapReady || homeViewApplied || userLocation) return;
    map.fitBounds(boundsAsLngLat(LONDON_BOUNDS), { padding: HOME_VIEW_PADDING, maxZoom: 11, animate: false });
    homeViewApplied = true;
  }

  function setLocationView(location) {
    if (!location || !mapReady) return;
    map.flyTo({ center: [location.lon, location.lat], zoom: clamp(LOCATION_ZOOM, MIN_ZOOM, MAX_ZOOM) });
    homeViewApplied = true;
  }

  function zoomButton(delta) {
    if (!map) return;
    map.easeTo({ zoom: clamp(map.getZoom() + delta, MIN_ZOOM, MAX_ZOOM), duration: 200 });
  }

  function selectRestaurant(restaurant) {
    selected = restaurant;
  }

  function selectSearchResult(restaurant) {
    selected = restaurant;
    mapWasInteractedWith = true;
    if (!hasCoordinates(restaurant)) return;
    homeViewApplied = true;
    map?.flyTo({ center: [restaurant.lon, restaurant.lat], zoom: Math.max(map.getZoom(), SEARCH_ZOOM) });
  }

  function closeDetails() {
    selected = null;
  }

  function resetMap() {
    selected = null;
    query = '';
    priceFilter = 'all';
    lastMarkerPick = null;
    if (userLocation) {
      setLocationView(userLocation);
    } else {
      homeViewApplied = false;
      applyFallbackHomeView();
    }
  }

  function geoCircle(lat, lon, radiusMeters, points = 48) {
    const coords = [];
    const earthRadius = 6371000;
    const angular = radiusMeters / earthRadius;
    const latR = (lat * Math.PI) / 180;
    const lonR = (lon * Math.PI) / 180;
    for (let i = 0; i <= points; i += 1) {
      const bearing = (i / points) * 2 * Math.PI;
      const lat2 = Math.asin(Math.sin(latR) * Math.cos(angular) + Math.cos(latR) * Math.sin(angular) * Math.cos(bearing));
      const lon2 =
        lonR + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(latR), Math.cos(angular) - Math.sin(latR) * Math.sin(lat2));
      coords.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
    }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
  }

  function updateUserLocationLayers(location) {
    const pointSource = map?.getSource('user-point');
    const accuracySource = map?.getSource('user-accuracy');
    if (!pointSource || !accuracySource) return;

    if (!location || !hasCoordinates(location)) {
      pointSource.setData(emptyCollection());
      accuracySource.setData(emptyCollection());
      return;
    }

    pointSource.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [location.lon, location.lat] }, properties: {} }]
    });

    if (location.accuracy) {
      accuracySource.setData({
        type: 'FeatureCollection',
        features: [geoCircle(location.lat, location.lon, location.accuracy)]
      });
    } else {
      accuracySource.setData(emptyCollection());
    }
  }

  function startLocationTracking(options = {}) {
    if (!navigator.geolocation) {
      locationStatus = 'Location unavailable';
      return;
    }
    if (userLocation) {
      setLocationView(userLocation);
    }
    if (options.restart && locationWatchId !== null) {
      stopLocationTracking();
    }
    if (locationWatchId !== null) return;

    locationStatus = 'Locating';
    locationWatchId = navigator.geolocation.watchPosition(
      (position) => {
        const firstLocation = !userLocation;
        userLocation = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        locationStatus = 'Live location on';
        if (firstLocation && (!mapWasInteractedWith || options.restart)) {
          setLocationView(userLocation);
        }
      },
      (error) => {
        locationStatus = error.message || 'Location unavailable';
        stopLocationTracking();
        applyFallbackHomeView();
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 15000
      }
    );
  }

  function stopLocationTracking() {
    if (locationWatchId === null || !navigator.geolocation) return;
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
</script>

<svelte:head>
  <title>Eater Restaurant Map</title>
  <meta
    name="description"
    content="Full map of restaurants featured in Eater map guides. Works offline."
  />
</svelte:head>

<main class="app-shell">
  <section class="map" style={`--topbar-height: ${topbarHeight}px; --mobile-search-visible-results: ${MOBILE_SEARCH_VISIBLE_RESULTS};`}>
    <div class="map-canvas" bind:this={mapEl} role="application" aria-label="Restaurant map"></div>

    {#if loading}
      <div class="state-pill">Loading</div>
    {:else if loadError}
      <div class="state-pill error">{loadError}</div>
    {/if}

    <div class="topbar" bind:this={topbarEl}>
      <label class="search">
        <span>Search</span>
        <div class="search-field">
          <input bind:value={query} type="search" placeholder="Restaurant, area, guide" autocomplete="off" />
          {#if searchText}
            <output class="search-count" aria-live="polite">
              {filteredRestaurants.length.toLocaleString()}
            </output>
          {/if}
        </div>
      </label>
      <button class="reset-button" type="button" on:click={resetMap}>Reset</button>
      <details class="roadmap-menu">
        <summary>Roadmap</summary>
        <ul>
          {#each roadmapItems as item}
            <li>{item}</li>
          {/each}
        </ul>
      </details>
    </div>

    <div class="zoom-controls" aria-label="Zoom controls">
      <button type="button" on:click={() => zoomButton(1)} aria-label="Zoom in">+</button>
      <button type="button" on:click={() => zoomButton(-1)} aria-label="Zoom out">-</button>
      <button
        class="location-button"
        class:active={Boolean(userLocation)}
        type="button"
        on:click={() => startLocationTracking({ restart: true })}
        aria-label="Show current location"
        title={locationStatus || 'Show current location'}
      >
        Loc
      </button>
    </div>

    <div class="price-controls" aria-label="Price filter">
      {#each prices as price}
        <button type="button" class:active={priceFilter === price} on:click={() => (priceFilter = price)}>
          {price === 'all' ? 'All' : price}
        </button>
      {/each}
    </div>

    {#if searchResults.length}
      <div class="results-shell">
        <div class="results-panel" bind:this={searchResultsEl} on:scroll={updateSearchResultsScrollState}>
          {#each searchResults as result (result.id)}
            <button type="button" on:click={() => selectSearchResult(result)}>
              <strong>{result.name}</strong>
              <span>{result.address}</span>
            </button>
          {/each}
        </div>
        {#if searchResultsHasMore}
          <div class="search-results-scrollbar" aria-hidden="true">
            <span style={`top: ${searchResultsScrollbar.top}%; height: ${searchResultsScrollbar.height}%;`}></span>
          </div>
        {/if}
      </div>
    {/if}

    <div class="attribution">
      <a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a>
      <span aria-hidden="true">·</span>
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
    </div>
  </section>

  <aside class:open={selected} class="details-panel">
    {#if selected}
      <button class="close-button" type="button" on:click={closeDetails} aria-label="Close">x</button>
      <p class="eyebrow">{selected.pageTitle}</p>
      <h1>{selected.name}</h1>
      <div class="meta-row">
        {#if selected.priceRange}<span>{selected.priceRange}</span>{/if}
        {#if selected.openFor}<span>{selected.openFor}</span>{/if}
        {#if selected.bookingProvider}<span>{selected.bookingProvider}</span>{/if}
      </div>
      <p class="address">{selected.address}</p>

      {#if selected.description}
        <div
          class:can-scroll-down={descriptionCanScrollDown}
          class:has-more={descriptionHasMore}
          class="description-shell"
          style={`--description-visible-lines: ${DESCRIPTION_VISIBLE_LINES};`}
        >
          <p class="description" bind:this={descriptionEl} on:scroll={updateDescriptionScrollState}>
            {selected.description}
          </p>
          {#if descriptionHasMore}
            <span class="description-scrollbar" aria-hidden="true">
              <span style={`top: ${descriptionScrollbar.top}%; height: ${descriptionScrollbar.height}%;`}></span>
            </span>
          {/if}
        </div>
      {/if}

      <dl class="facts">
        {#if selected.bestFor}
          <div><dt>Best For</dt><dd>{selected.bestFor}</dd></div>
        {/if}
        {#if selected.mustTryDish}
          <div><dt>Must Try</dt><dd>{selected.mustTryDish}</dd></div>
        {/if}
        {#if selected.knowBeforeYouGo}
          <div><dt>Know First</dt><dd>{selected.knowBeforeYouGo}</dd></div>
        {/if}
        {#if selected.outdoorSeating}
          <div><dt>Outdoor</dt><dd>{selected.outdoorSeating}</dd></div>
        {/if}
        {#if selected.additionalLocationNotes}
          <div><dt>More Locations</dt><dd>{selected.additionalLocationNotes}</dd></div>
        {/if}
        {#if selected.phone}
          <div><dt>Phone</dt><dd><a href={`tel:${selected.phone}`}>{selected.phone}</a></dd></div>
        {/if}
      </dl>

      <div class="actions">
        {#if selectedGoogleMapsUrl}
          <a href={selectedGoogleMapsUrl} target="_blank" rel="noreferrer" aria-label={`Open ${selected.name} in Google Maps`}>
            <span class="action-label-full">Google Maps</span>
            <span class="action-label-short">Google</span>
          </a>
        {/if}
        {#if selectedCitymapperUrl}
          <a
            class="citymapper-action"
            href={selectedCitymapperUrl}
            aria-label={`Open mobile directions to ${selected.name} in Citymapper`}
          >
            Citymapper
          </a>
        {/if}
        {#if selected.websiteUrl}<a href={selected.websiteUrl} target="_blank" rel="noreferrer">Website</a>{/if}
        {#if selected.bookingUrl}<a href={selected.bookingUrl} target="_blank" rel="noreferrer">Book</a>{/if}
        {#if selected.entryUrl}<a href={selected.entryUrl} target="_blank" rel="noreferrer">Eater</a>{/if}
      </div>
    {:else}
      <div class="empty-panel">
        <p class="eyebrow">Eater Maps</p>
        <h1>{totalCount.toLocaleString()} entries</h1>
        <p>{visibleMarkerCount.toLocaleString()} visible on this view</p>
      </div>
    {/if}
  </aside>
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html),
  :global(body) {
    margin: 0;
    min-height: 100%;
    overflow: hidden;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #17201c;
    background: #f5f2ea;
  }

  :global(button),
  :global(input) {
    font: inherit;
  }

  .app-shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) min(400px, 32vw);
    width: 100vw;
    height: 100dvh;
    overflow: hidden;
  }

  .map {
    position: relative;
    min-width: 0;
    height: 100%;
    overflow: hidden;
    background: #d8dfd4;
  }

  .map-canvas {
    position: absolute;
    inset: 0;
  }

  /* MapLibre draws its own controls; we use custom chrome instead. */
  :global(.maplibregl-ctrl-top-right),
  :global(.maplibregl-ctrl-bottom-left),
  :global(.maplibregl-ctrl-bottom-right),
  :global(.maplibregl-ctrl-top-left) {
    display: none;
  }

  .topbar {
    position: absolute;
    top: max(12px, env(safe-area-inset-top));
    left: 12px;
    right: 12px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 8px;
    z-index: 10;
    pointer-events: none;
  }

  .search,
  .reset-button,
  .roadmap-menu,
  .zoom-controls,
  .price-controls,
  .results-shell,
  .results-panel,
  .state-pill {
    pointer-events: auto;
  }

  .search {
    display: grid;
    gap: 3px;
    max-width: 560px;
    padding: 8px 10px;
    border: 1px solid rgba(23, 32, 28, 0.14);
    border-radius: 8px;
    background: rgba(255, 252, 244, 0.96);
    box-shadow: 0 8px 22px rgba(27, 31, 28, 0.12);
  }

  .search span {
    font-size: 10px;
    line-height: 1;
    color: #6a5f55;
    text-transform: uppercase;
    font-weight: 700;
  }

  .search-field {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .search input {
    width: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: #17201c;
    font-size: 16px;
    min-width: 0;
  }

  .search-count {
    min-width: 30px;
    padding: 3px 6px;
    border-radius: 999px;
    color: #fff;
    background: #17201c;
    text-align: center;
    font-size: 12px;
    font-weight: 800;
    line-height: 1.2;
  }

  .reset-button,
  .zoom-controls button,
  .price-controls button {
    border: 1px solid rgba(23, 32, 28, 0.14);
    color: #17201c;
    background: rgba(255, 252, 244, 0.96);
    box-shadow: 0 8px 22px rgba(27, 31, 28, 0.12);
    cursor: pointer;
  }

  .reset-button {
    min-width: 62px;
    height: 48px;
    border-radius: 8px;
    font-weight: 700;
  }

  .roadmap-menu {
    position: relative;
    min-width: 96px;
    color: #17201c;
  }

  .roadmap-menu summary {
    display: grid;
    height: 48px;
    place-items: center;
    padding: 0 12px;
    border: 1px solid rgba(23, 32, 28, 0.14);
    border-radius: 8px;
    background: rgba(255, 252, 244, 0.96);
    box-shadow: 0 8px 22px rgba(27, 31, 28, 0.12);
    cursor: pointer;
    font-weight: 800;
    list-style: none;
    pointer-events: auto;
  }

  .roadmap-menu summary::-webkit-details-marker {
    display: none;
  }

  .roadmap-menu[open] summary {
    color: #fff;
    background: #17201c;
  }

  .roadmap-menu ul {
    position: absolute;
    top: 56px;
    right: 0;
    display: grid;
    gap: 7px;
    width: min(320px, calc(100vw - 24px));
    max-height: min(55vh, 430px);
    margin: 0;
    padding: 12px 14px 12px 26px;
    overflow: auto;
    border: 1px solid rgba(23, 32, 28, 0.12);
    border-radius: 8px;
    background: rgba(255, 252, 244, 0.98);
    box-shadow: 0 18px 40px rgba(27, 31, 28, 0.18);
    pointer-events: auto;
  }

  .roadmap-menu li {
    font-size: 13px;
    line-height: 1.25;
  }

  .zoom-controls {
    position: absolute;
    right: 12px;
    top: 84px;
    display: grid;
    gap: 6px;
    z-index: 9;
  }

  .zoom-controls button {
    width: 44px;
    height: 44px;
    border-radius: 8px;
    font-size: 24px;
    font-weight: 800;
  }

  .zoom-controls button.active {
    color: #fff;
    background: #2563eb;
  }

  .zoom-controls .location-button {
    font-size: 12px;
    letter-spacing: 0;
  }

  .price-controls {
    position: absolute;
    left: 12px;
    bottom: max(12px, env(safe-area-inset-bottom));
    display: flex;
    gap: 6px;
    z-index: 9;
  }

  .price-controls button {
    min-width: 40px;
    height: 36px;
    border-radius: 8px;
    padding: 0 10px;
    font-size: 12px;
    font-weight: 800;
  }

  .price-controls button.active {
    color: #fff;
    background: #17201c;
  }

  .results-shell {
    position: absolute;
    top: calc(max(12px, env(safe-area-inset-top)) + var(--topbar-height, 56px) + 8px);
    left: 12px;
    bottom: calc(max(12px, env(safe-area-inset-bottom)) + 50px);
    width: min(420px, calc(100vw - 24px));
    z-index: 12;
  }

  .results-panel {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: auto;
    border: 1px solid rgba(23, 32, 28, 0.12);
    border-radius: 8px;
    background: rgba(255, 252, 244, 0.98);
    box-shadow: 0 18px 40px rgba(27, 31, 28, 0.18);
  }

  .search-results-scrollbar {
    display: none;
  }

  .results-panel button {
    display: grid;
    gap: 3px;
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-bottom: 1px solid rgba(23, 32, 28, 0.08);
    text-align: left;
    color: #17201c;
    background: transparent;
    cursor: pointer;
  }

  .results-panel button:last-child {
    border-bottom: 0;
  }

  .results-panel span {
    color: #6a5f55;
    font-size: 12px;
  }

  .state-pill {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 20;
    padding: 10px 14px;
    border-radius: 8px;
    color: #17201c;
    background: rgba(255, 252, 244, 0.96);
    box-shadow: 0 14px 34px rgba(27, 31, 28, 0.18);
    font-weight: 800;
  }

  .state-pill.error {
    color: #9f241d;
  }

  .attribution {
    position: absolute;
    right: 10px;
    bottom: 8px;
    z-index: 8;
    display: flex;
    gap: 5px;
    padding: 3px 6px;
    border-radius: 5px;
    background: rgba(255, 252, 244, 0.82);
    font-size: 11px;
  }

  .attribution a {
    color: #38433e;
  }

  .details-panel {
    position: relative;
    min-width: 0;
    height: 100%;
    overflow: auto;
    padding: 22px 22px 28px;
    border-left: 1px solid rgba(23, 32, 28, 0.14);
    background: #fffdf7;
    box-shadow: -14px 0 32px rgba(27, 31, 28, 0.08);
  }

  .close-button {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 36px;
    height: 36px;
    border: 1px solid rgba(23, 32, 28, 0.12);
    border-radius: 8px;
    color: #17201c;
    background: #f7f2e8;
    cursor: pointer;
    font-weight: 800;
  }

  .eyebrow {
    margin: 0 44px 9px 0;
    color: #8b4a37;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    max-width: 100%;
    font-size: clamp(24px, 4vw, 34px);
    line-height: 1.04;
    letter-spacing: 0;
  }

  .meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 14px 0 12px;
  }

  .meta-row span {
    padding: 5px 8px;
    border-radius: 8px;
    color: #38433e;
    background: #ece6da;
    font-size: 12px;
    font-weight: 800;
  }

  .address {
    margin: 0 0 16px;
    color: #5f675f;
    line-height: 1.35;
  }

  .description {
    margin: 0 0 18px;
    line-height: 1.5;
  }

  .description-shell {
    position: relative;
  }

  .description-scrollbar {
    display: none;
  }

  .facts {
    display: grid;
    gap: 10px;
    margin: 0;
  }

  .facts div {
    padding-top: 10px;
    border-top: 1px solid #e3ded4;
  }

  .facts dt {
    margin-bottom: 4px;
    color: #8b4a37;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .facts dd {
    margin: 0;
    line-height: 1.4;
  }

  .facts a {
    color: #275f78;
  }

  .actions {
    position: sticky;
    bottom: -28px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin: 20px -22px -28px;
    padding: 12px 22px max(18px, env(safe-area-inset-bottom));
    background: linear-gradient(180deg, rgba(255, 253, 247, 0), #fffdf7 18%);
  }

  .actions a {
    display: grid;
    min-height: 42px;
    place-items: center;
    border-radius: 8px;
    color: #fff;
    background: #17201c;
    text-decoration: none;
    font-weight: 800;
  }

  .actions .citymapper-action {
    display: none;
  }

  .action-label-short {
    display: none;
  }

  .empty-panel {
    display: grid;
    align-content: center;
    min-height: 100%;
  }

  .empty-panel p:last-child {
    color: #5f675f;
  }

  @media (max-width: 820px) {
    .app-shell {
      display: block;
    }

    .map {
      height: 100dvh;
    }

    .details-panel {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 30;
      display: flex;
      flex-direction: column;
      height: auto;
      max-height: min(56dvh, 470px);
      padding: 14px 14px max(8px, env(safe-area-inset-bottom));
      border-top: 1px solid rgba(23, 32, 28, 0.16);
      border-left: 0;
      border-radius: 12px 12px 0 0;
      transform: translateY(calc(100% - 0px));
      transition: transform 180ms ease;
      box-shadow: 0 -18px 38px rgba(27, 31, 28, 0.2);
    }

    .details-panel.open {
      transform: translateY(0);
    }

    .details-panel:not(.open) {
      display: none;
    }

    .details-panel h1 {
      padding-right: 34px;
      font-size: 22px;
      line-height: 1.06;
    }

    .details-panel .eyebrow {
      margin: 0 42px 6px 0;
      font-size: 10px;
    }

    .details-panel .meta-row {
      gap: 5px;
      margin: 9px 0 8px;
    }

    .details-panel .meta-row span {
      padding: 4px 7px;
      font-size: 11px;
    }

    .details-panel .address {
      margin-bottom: 9px;
      font-size: 13px;
    }

    .details-panel .description-shell {
      order: 7;
      margin: 0 0 8px;
    }

    .details-panel .description-shell.can-scroll-down::after {
      content: "";
      position: absolute;
      left: 0;
      right: 9px;
      bottom: 0;
      height: 1.7em;
      pointer-events: none;
      background: linear-gradient(180deg, rgba(255, 253, 247, 0), #fffdf7 82%);
    }

    .details-panel .description {
      max-height: calc(1.42em * var(--description-visible-lines, 6));
      margin: 0;
      padding-right: 12px;
      overflow-y: auto;
      scrollbar-width: none;
      line-height: 1.42;
      font-size: 14px;
      -webkit-overflow-scrolling: touch;
    }

    .details-panel .description::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }

    .description-scrollbar {
      display: block;
      position: absolute;
      top: 2px;
      right: 1px;
      bottom: 2px;
      width: 3px;
      border-radius: 999px;
      background: rgba(23, 32, 28, 0.08);
      pointer-events: none;
    }

    .description-scrollbar span {
      position: absolute;
      left: 0;
      right: 0;
      min-height: 18%;
      border-radius: 999px;
      background: rgba(23, 32, 28, 0.46);
    }

    .details-panel .facts {
      order: 8;
      gap: 8px;
      font-size: 13px;
    }

    .details-panel .facts div {
      padding-top: 8px;
    }

    .actions {
      position: static;
      order: 6;
      display: flex;
      overflow-x: auto;
      gap: 6px;
      margin: 2px 0 10px;
      padding: 0 2px 2px;
      background: transparent;
      overscroll-behavior-x: contain;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }

    .actions::-webkit-scrollbar {
      display: none;
    }

    .actions a {
      flex: 0 0 auto;
      min-width: 82px;
      min-height: 38px;
      padding: 0 10px;
      font-size: 12px;
      white-space: nowrap;
    }

    .actions .citymapper-action {
      display: grid;
    }

    .action-label-full {
      display: none;
    }

    .action-label-short {
      display: inline;
    }

    .topbar {
      grid-template-columns: minmax(0, 1fr) 58px 88px;
    }

    .roadmap-menu {
      min-width: 88px;
    }

    .roadmap-menu summary {
      padding: 0 8px;
      font-size: 13px;
    }

    .results-shell {
      bottom: auto;
      max-height: calc(var(--mobile-search-visible-results, 4) * 56px);
    }

    .results-panel {
      height: auto;
      max-height: inherit;
      overscroll-behavior: contain;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }

    .results-panel::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }

    .results-panel button {
      height: 56px;
      padding: 8px 12px;
      overflow: hidden;
    }

    .results-panel strong,
    .results-panel span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .search-results-scrollbar {
      display: block;
      position: absolute;
      top: 3px;
      right: 3px;
      bottom: 3px;
      width: 3px;
      border-radius: 999px;
      background: rgba(23, 32, 28, 0.08);
      pointer-events: none;
    }

    .search-results-scrollbar span {
      position: absolute;
      left: 0;
      right: 0;
      min-height: 18%;
      border-radius: 999px;
      background: rgba(23, 32, 28, 0.46);
    }

    .zoom-controls {
      top: 98px;
    }

    .price-controls {
      right: 12px;
      overflow-x: auto;
      padding-bottom: 2px;
    }
  }
</style>
