<script>
  import { onMount, tick } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { Protocol } from 'pmtiles';
  import { layers, namedFlavor } from '@protomaps/basemaps';

  const MAX_ZOOM = 18;
  const MIN_ZOOM_ONLINE = 3;
  const MIN_ZOOM_OFFLINE = 5;
  const LOCATION_ZOOM = 14;
  const SEARCH_ZOOM = 15;
  // Zoom where coarse GB tiles hand off to the detailed restaurant-area tiles.
  const BASEMAP_HANDOFF_ZOOM = 9;
  const SEARCH_LIMIT = 80;
  const HOME_VIEW_PADDING = 32;
  const DESCRIPTION_VISIBLE_LINES = 4;
  const MOBILE_SEARCH_VISIBLE_RESULTS = 4;
  const CITYMAPPER_ANDROID_PACKAGE = 'com.citymapper.app.release';
  const CITYMAPPER_ANDROID_STORE_URL = `https://play.google.com/store/apps/details?id=${CITYMAPPER_ANDROID_PACKAGE}`;

  // Online: full global vector coverage (keyless). Offline: local tiles only.
  const ONLINE_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

  // The data (and offline basemap) cover Great Britain; keep the offline view here.
  const COVERAGE_BOUNDS = [
    [-5.9, 49.8],
    [1.9, 56.2]
  ];
  const LONDON_BOUNDS = {
    minLat: 51.2868,
    maxLat: 51.6919,
    minLon: -0.5103,
    maxLon: 0.334
  };

  // Canvas marker rendering constants (kept from the original renderer).
  const MARKER_PADDING = 48;
  const MARKER_SPRITE_PADDING = 10;
  const MARKER_LAYER_OPACITY = 0.42;
  const PRICED_MARKER_LAYER_OPACITY = 1 - (1 - MARKER_LAYER_OPACITY) / 2;
  const FULL_MARKER_ZOOM = 14;
  const MID_MARKER_ZOOM = 12;

  let mapEl;
  let markerCanvas;
  let topbarEl;
  let map;
  let mapReady = false;
  let online = true;

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
  let markerDrawFrame = 0;
  let markerSpriteCache = new Map();
  let markerLayerCanvas;

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

  // Offline download / install state.
  let offlineState = 'unknown'; // 'downloading' | 'ready' | 'idle' | 'unknown'
  let downloadLoaded = 0;
  let downloadTotal = 0;
  let deferredInstallPrompt = null;
  let canInstall = false;
  let isIosDevice = false;
  let isStandalone = false;
  let showInstallHelp = false;

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
    isIosDevice = /iPad|iPhone|iPod/i.test(navigator.userAgent || '') && !window.MSStream;
    isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
    online = navigator.onLine;

    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    map = new maplibregl.Map({
      container: mapEl,
      style: online ? ONLINE_STYLE_URL : buildLocalStyle(),
      center: [(LONDON_BOUNDS.minLon + LONDON_BOUNDS.maxLon) / 2, (LONDON_BOUNDS.minLat + LONDON_BOUNDS.maxLat) / 2],
      zoom: 10,
      minZoom: online ? MIN_ZOOM_ONLINE : MIN_ZOOM_OFFLINE,
      maxZoom: MAX_ZOOM,
      maxBounds: online ? undefined : COVERAGE_BOUNDS,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: false
    });
    map.touchZoomRotate.disableRotation();

    map.on('error', (event) => console.error('MapLibre error:', event.error?.message || event.error));
    map.on('load', () => {
      mapReady = true;
      applyFallbackHomeView();
      scheduleMarkerDraw();
    });
    map.on('styledata', scheduleMarkerDraw);
    map.on('move', scheduleMarkerDraw);
    map.on('moveend', scheduleMarkerDraw);
    map.on('movestart', (event) => {
      if (event.originalEvent) mapWasInteractedWith = true;
    });
    map.on('click', (event) => {
      const picked = pickMarker(event.point);
      if (picked) selectRestaurant(picked);
    });

    window.addEventListener('online', onConnectivityChange);
    window.addEventListener('offline', onConnectivityChange);
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', () => {
      canInstall = false;
      isStandalone = true;
    });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage);
      navigator.serviceWorker.ready
        .then(() => navigator.serviceWorker.controller?.postMessage({ type: 'get-status' }))
        .catch(() => {});
    }

    resizeObserver = new ResizeObserver(() => {
      map?.resize();
      if (topbarEl) topbarHeight = Math.ceil(topbarEl.getBoundingClientRect().height);
      updateSearchResultsScrollState();
      scheduleMarkerDraw();
    });
    if (mapEl) resizeObserver.observe(mapEl);
    if (topbarEl) resizeObserver.observe(topbarEl);
    if (topbarEl) topbarHeight = Math.ceil(topbarEl.getBoundingClientRect().height);

    loadRestaurants();
    startLocationTracking();

    return () => {
      resizeObserver?.disconnect();
      stopLocationTracking();
      window.removeEventListener('online', onConnectivityChange);
      window.removeEventListener('offline', onConnectivityChange);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage);
      map?.remove();
      maplibregl.removeProtocol('pmtiles');
    };
  });

  function assetUrl(path) {
    const origin = typeof location !== 'undefined' ? location.origin : '';
    return `${origin}${path}`;
  }

  function buildLocalStyle() {
    const flavor = namedFlavor('light');
    // Coarse whole-country tiles below the handoff zoom; detailed restaurant-area
    // tiles at/above it. Namespacing keeps the two layer sets' ids unique.
    const gbLayers = layers('gb', flavor, { lang: 'en' }).map((layer) => ({
      ...layer,
      maxzoom: BASEMAP_HANDOFF_ZOOM
    }));
    const detailLayers = layers('detail', flavor, { lang: 'en' }).map((layer) => ({
      ...layer,
      id: `detail_${layer.id}`,
      minzoom: Math.max(layer.minzoom ?? 0, BASEMAP_HANDOFF_ZOOM)
    }));

    // Emphasise railway/tube lines and stations to make navigation easier.
    const transitLayers = [
      {
        id: 'detail_rail_emphasis',
        type: 'line',
        source: 'detail',
        'source-layer': 'roads',
        minzoom: 10,
        filter: ['==', ['get', 'kind'], 'rail'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#6f6a86',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 2.2, 16, 3.2],
          'line-dasharray': [3, 1.5],
          'line-opacity': 0.75
        }
      },
      {
        id: 'detail_stations',
        type: 'circle',
        source: 'detail',
        'source-layer': 'pois',
        minzoom: 12,
        filter: ['==', ['get', 'kind'], 'station'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 15, 4.5],
          'circle-color': '#3b3663',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.4
        }
      },
      {
        id: 'detail_station_labels',
        type: 'symbol',
        source: 'detail',
        'source-layer': 'pois',
        minzoom: 13.5,
        filter: ['==', ['get', 'kind'], 'station'],
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'text-offset': [0, 0.9],
          'text-anchor': 'top',
          'text-optional': true
        },
        paint: {
          'text-color': '#3b3663',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2
        }
      }
    ];

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
        detail: {
          type: 'vector',
          url: `pmtiles://${assetUrl('/basemap/detail.pmtiles')}`
        }
      },
      layers: [...gbLayers, ...detailLayers, ...transitLayers]
    };
  }

  function onConnectivityChange() {
    const next = navigator.onLine;
    if (next === online) return;
    online = next;
    if (!map) return;
    map.setMaxBounds(online ? null : COVERAGE_BOUNDS);
    map.setMinZoom(online ? MIN_ZOOM_ONLINE : MIN_ZOOM_OFFLINE);
    map.setStyle(online ? ONLINE_STYLE_URL : buildLocalStyle());
    scheduleMarkerDraw();
  }

  async function loadRestaurants() {
    try {
      const response = await fetch('/data/restaurants.json');
      if (!response.ok) throw new Error(`Data request failed with ${response.status}`);
      const payload = await response.json();
      restaurants = annotateMarkers(payload.restaurants || []);
      restaurantById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
      stats = payload.stats || null;
      applyFallbackHomeView();
      scheduleMarkerDraw();
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  function annotateMarkers(items) {
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

  function markerOffset(index, count) {
    if (count <= 1) return { x: 0, y: 0 };
    const ring = Math.floor(index / 8) + 1;
    const angle = ((index % 8) / 8) * Math.PI * 2;
    const radius = Math.min(24, 6 + ring * 5);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
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
  $: downloadPercent = downloadTotal ? Math.min(100, Math.round((downloadLoaded / downloadTotal) * 100)) : 0;
  $: {
    filteredRestaurants;
    selected;
    userLocation;
    if (mapReady) scheduleMarkerDraw();
  }
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

  // ---- Canvas marker overlay -------------------------------------------------

  function scheduleMarkerDraw() {
    if (!markerCanvas || !map) return;
    if (markerDrawFrame) return;
    markerDrawFrame = requestAnimationFrame(() => {
      markerDrawFrame = 0;
      drawMarkers();
    });
  }

  function drawMarkers() {
    if (!map || !markerCanvas || !mapEl) return;
    const width = mapEl.clientWidth;
    const height = mapEl.clientHeight;
    if (!width || !height) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);
    if (markerCanvas.width !== targetWidth) markerCanvas.width = targetWidth;
    if (markerCanvas.height !== targetHeight) markerCanvas.height = targetHeight;
    markerCanvas.style.width = `${width}px`;
    markerCanvas.style.height = `${height}px`;

    const ctx = markerCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const z = map.getZoom();
    const selectedId = selected?.id;
    const markers = [];
    for (const restaurant of filteredRestaurants) {
      const point = map.project([restaurant.lon, restaurant.lat]);
      const x = point.x + restaurant.offsetX;
      const y = point.y + restaurant.offsetY;
      if (x < -MARKER_PADDING || x > width + MARKER_PADDING || y < -MARKER_PADDING || y > height + MARKER_PADDING) continue;
      markers.push({ restaurant, x, y });
    }
    if (visibleMarkerCount !== markers.length) visibleMarkerCount = markers.length;

    if (!markerLayerCanvas) markerLayerCanvas = document.createElement('canvas');
    if (markerLayerCanvas.width !== targetWidth) markerLayerCanvas.width = targetWidth;
    if (markerLayerCanvas.height !== targetHeight) markerLayerCanvas.height = targetHeight;
    const layerCtx = markerLayerCanvas.getContext('2d');
    if (!layerCtx) return;
    layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const regularMarkers = [];
    const pricedMarkers = [];
    let selectedMarker = null;
    for (const marker of markers) {
      if (marker.restaurant.id === selectedId) {
        selectedMarker = marker;
        continue;
      }
      if (marker.restaurant.priceRange) pricedMarkers.push(marker);
      else regularMarkers.push(marker);
    }

    // Composite each group at a flat opacity so overlapping markers do not darken.
    layerCtx.clearRect(0, 0, width, height);
    for (const marker of regularMarkers) drawMarker(layerCtx, marker, false, z);
    ctx.save();
    ctx.globalAlpha = MARKER_LAYER_OPACITY;
    ctx.drawImage(markerLayerCanvas, 0, 0, width, height);
    ctx.restore();

    layerCtx.clearRect(0, 0, width, height);
    for (const marker of pricedMarkers) drawMarker(layerCtx, marker, false, z);
    ctx.save();
    ctx.globalAlpha = PRICED_MARKER_LAYER_OPACITY;
    ctx.drawImage(markerLayerCanvas, 0, 0, width, height);
    ctx.restore();

    if (selectedMarker) drawMarker(ctx, selectedMarker, true, z);
    drawUserLocation(ctx, userLocation, z);
  }

  function markerColor(priceRange) {
    if (priceRange === '$') return '#2d8a5f';
    if (priceRange === '$$') return '#2770a7';
    if (priceRange === '$$$') return '#7f52a1';
    if (priceRange === '$$$$') return '#252a31';
    return '#d43d2f';
  }

  function markerPriority(restaurant) {
    return restaurant?.priceRange ? 1 : 0;
  }

  function markerDetail(z, active) {
    if (active || z >= FULL_MARKER_ZOOM) {
      return { key: 'full', radius: active ? 17 : 12, strokeWidth: active ? 3 : 2, shadowBlur: active ? 14 : 8, shadowOffsetY: active ? 4 : 3, showPrice: true };
    }
    if (z >= MID_MARKER_ZOOM) {
      return { key: 'mid', radius: 7, strokeWidth: 1.5, shadowBlur: 4, shadowOffsetY: 2, showPrice: false };
    }
    return { key: 'small', radius: 4.5, strokeWidth: 1, shadowBlur: 2, shadowOffsetY: 1, showPrice: false };
  }

  function drawMarker(ctx, marker, active, z) {
    const sprite = getMarkerSprite(marker.restaurant.priceRange, active, z);
    ctx.drawImage(sprite.canvas, marker.x - sprite.size / 2, marker.y - sprite.size / 2, sprite.size, sprite.size);
  }

  function getMarkerSprite(priceRange, active, z) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const normalizedPrice = priceRange || 'none';
    const detail = markerDetail(z, active);
    const key = `${normalizedPrice}-${active ? 'active' : detail.key}-${dpr}`;
    const cached = markerSpriteCache.get(key);
    if (cached) return cached;

    const radius = detail.radius;
    const size = (radius + MARKER_SPRITE_PADDING) * 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(size * dpr);
    canvas.height = Math.ceil(size * dpr);
    const ctx = canvas.getContext('2d');
    const center = size / 2;

    ctx.scale(dpr, dpr);
    ctx.shadowColor = active ? 'rgba(27, 31, 28, 0.42)' : 'rgba(27, 31, 28, 0.26)';
    ctx.shadowBlur = detail.shadowBlur;
    ctx.shadowOffsetY = detail.shadowOffsetY;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = markerColor(priceRange);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = detail.strokeWidth;
    ctx.strokeStyle = active ? 'rgba(255, 255, 255, 0.86)' : '#ffffff';
    ctx.stroke();

    if (priceRange && detail.showPrice) {
      ctx.fillStyle = active ? 'rgba(255, 255, 255, 0.95)' : '#ffffff';
      ctx.font = `800 ${priceRange.length >= 4 ? 7 : 8}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(priceRange, center, center + 0.5);
    }

    const sprite = { canvas, size };
    markerSpriteCache.set(key, sprite);
    return sprite;
  }

  function drawUserLocation(ctx, location, z) {
    if (!location || !hasCoordinates(location)) return;
    const point = map.project([location.lon, location.lat]);
    const x = point.x;
    const y = point.y;

    const accuracyRadius = location.accuracy ? clamp(location.accuracy / metersPerPixel(location.lat, z), 10, 90) : 0;

    ctx.save();
    if (accuracyRadius) {
      ctx.beginPath();
      ctx.arc(x, y, accuracyRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(37, 99, 235, 0.16)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.28)';
      ctx.stroke();
    }
    ctx.shadowColor = 'rgba(27, 31, 28, 0.28)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#2563eb';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }

  function metersPerPixel(lat, z) {
    return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
  }

  function pickMarker(point) {
    if (!map) return null;
    const selectedId = selected?.id;
    const candidates = [];
    for (const restaurant of filteredRestaurants) {
      const projected = map.project([restaurant.lon, restaurant.lat]);
      const x = projected.x + restaurant.offsetX;
      const y = projected.y + restaurant.offsetY;
      const distance = Math.hypot(point.x - x, point.y - y);
      const radius = restaurant.id === selectedId ? 17 : 13;
      if (distance <= radius + 8) candidates.push({ restaurant, distance });
    }
    if (!candidates.length) {
      lastMarkerPick = null;
      return null;
    }
    candidates.sort((a, b) => {
      const distanceDifference = a.distance - b.distance;
      if (Math.abs(distanceDifference) > 4) return distanceDifference;
      return (
        markerPriority(b.restaurant) - markerPriority(a.restaurant) ||
        distanceDifference ||
        String(a.restaurant.id).localeCompare(String(b.restaurant.id))
      );
    });
    const key = candidates.map((candidate) => candidate.restaurant.id).join('|');
    const repeatedPick =
      lastMarkerPick && lastMarkerPick.key === key && Math.abs(lastMarkerPick.x - point.x) <= 18 && Math.abs(lastMarkerPick.y - point.y) <= 18;
    const index = repeatedPick ? (lastMarkerPick.index + 1) % candidates.length : 0;
    lastMarkerPick = { key, index, x: point.x, y: point.y };
    return candidates[index].restaurant;
  }

  // ---- Details / search panels (unchanged behaviour) -------------------------

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

  // ---- View helpers ----------------------------------------------------------

  function applyFallbackHomeView() {
    if (!mapReady || homeViewApplied || userLocation) return;
    map.fitBounds(
      [
        [LONDON_BOUNDS.minLon, LONDON_BOUNDS.minLat],
        [LONDON_BOUNDS.maxLon, LONDON_BOUNDS.maxLat]
      ],
      { padding: HOME_VIEW_PADDING, maxZoom: 11, animate: false }
    );
    homeViewApplied = true;
  }

  function setLocationView(location) {
    if (!location || !mapReady) return;
    map.flyTo({ center: [location.lon, location.lat], zoom: clamp(LOCATION_ZOOM, map.getMinZoom(), MAX_ZOOM) });
    homeViewApplied = true;
  }

  function zoomButton(delta) {
    if (!map) return;
    map.easeTo({ zoom: clamp(map.getZoom() + delta, map.getMinZoom(), MAX_ZOOM), duration: 200 });
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

  function startLocationTracking(options = {}) {
    if (!navigator.geolocation) {
      locationStatus = 'Location unavailable';
      return;
    }
    if (userLocation) setLocationView(userLocation);
    if (options.restart && locationWatchId !== null) stopLocationTracking();
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
        if (firstLocation && (!mapWasInteractedWith || options.restart)) setLocationView(userLocation);
        scheduleMarkerDraw();
      },
      (error) => {
        locationStatus = error.message || 'Location unavailable';
        stopLocationTracking();
        applyFallbackHomeView();
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
  }

  function stopLocationTracking() {
    if (locationWatchId === null || !navigator.geolocation) return;
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }

  // ---- Offline download / install -------------------------------------------

  function onBeforeInstallPrompt(event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    canInstall = true;
  }

  function onServiceWorkerMessage(event) {
    const data = event.data || {};
    if (data.type === 'precache-progress') {
      offlineState = data.loaded >= data.total && data.total > 0 ? 'ready' : 'downloading';
      downloadLoaded = data.loaded || 0;
      downloadTotal = data.total || 0;
    } else if (data.type === 'precache-done') {
      offlineState = 'ready';
      if (data.total) {
        downloadLoaded = data.total;
        downloadTotal = data.total;
      }
    } else if (data.type === 'precache-idle') {
      if (offlineState === 'unknown') offlineState = 'idle';
    }
  }

  async function onOfflineButton() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      canInstall = false;
      return;
    }
    showInstallHelp = true;
  }
</script>

<svelte:head>
  <title>Eater Restaurant Map</title>
  <meta name="description" content="Full map of restaurants featured in Eater map guides. Works offline." />
</svelte:head>

<main class="app-shell">
  <section class="map" style={`--topbar-height: ${topbarHeight}px; --mobile-search-visible-results: ${MOBILE_SEARCH_VISIBLE_RESULTS};`}>
    <div class="map-canvas" bind:this={mapEl} role="application" aria-label="Restaurant map"></div>
    <canvas class="marker-layer" bind:this={markerCanvas} aria-hidden="true"></canvas>

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
            <output class="search-count" aria-live="polite">{filteredRestaurants.length.toLocaleString()}</output>
          {/if}
        </div>
      </label>
      <button class="reset-button" type="button" on:click={resetMap}>Reset</button>
      {#if !isStandalone}
        <button
          class="offline-button"
          class:downloading={offlineState === 'downloading'}
          class:ready={offlineState === 'ready'}
          type="button"
          on:click={onOfflineButton}
          title={offlineState === 'downloading' ? `Saving offline map (${downloadPercent}%)` : 'Available offline — tap to install'}
        >
          <span class="offline-dot" class:online={online}></span>
          {#if offlineState === 'downloading'}
            Saving {downloadPercent}%
          {:else if offlineState === 'ready'}
            Offline ✓
          {:else}
            Install
          {/if}
        </button>
      {/if}
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

    <details class="roadmap-menu">
      <summary>Roadmap</summary>
      <ul>
        {#each roadmapItems as item}
          <li>{item}</li>
        {/each}
      </ul>
    </details>

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
        {#if selected.bestFor}<div><dt>Best For</dt><dd>{selected.bestFor}</dd></div>{/if}
        {#if selected.mustTryDish}<div><dt>Must Try</dt><dd>{selected.mustTryDish}</dd></div>{/if}
        {#if selected.knowBeforeYouGo}<div><dt>Know First</dt><dd>{selected.knowBeforeYouGo}</dd></div>{/if}
        {#if selected.outdoorSeating}<div><dt>Outdoor</dt><dd>{selected.outdoorSeating}</dd></div>{/if}
        {#if selected.additionalLocationNotes}<div><dt>More Locations</dt><dd>{selected.additionalLocationNotes}</dd></div>{/if}
        {#if selected.phone}<div><dt>Phone</dt><dd><a href={`tel:${selected.phone}`}>{selected.phone}</a></dd></div>{/if}
      </dl>

      <div class="actions">
        {#if selectedGoogleMapsUrl}
          <a href={selectedGoogleMapsUrl} target="_blank" rel="noreferrer" aria-label={`Open ${selected.name} in Google Maps`}>
            <span class="action-label-full">Google Maps</span>
            <span class="action-label-short">Google</span>
          </a>
        {/if}
        {#if selectedCitymapperUrl}
          <a class="citymapper-action" href={selectedCitymapperUrl} aria-label={`Open mobile directions to ${selected.name} in Citymapper`}>
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

{#if showInstallHelp}
  <div class="install-help" role="dialog" aria-modal="true" on:click={() => (showInstallHelp = false)}>
    <div class="install-help-card" on:click|stopPropagation>
      <h2>Install for offline use</h2>
      {#if isIosDevice}
        <ol>
          <li>Tap the <strong>Share</strong> button in Safari (square with an up arrow).</li>
          <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
        </ol>
      {:else}
        <ol>
          <li>Open your browser menu (⋮ or ≡).</li>
          <li>Choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</li>
        </ol>
      {/if}
      <p class="install-help-note">The map is already saved on this device{offlineState === 'ready' ? '' : ' (finishing download…)'}, so it works with no internet.</p>
      <button type="button" on:click={() => (showInstallHelp = false)}>Got it</button>
    </div>
  </div>
{/if}

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html),
  :global(body) {
    margin: 0;
    min-height: 100%;
    overflow: hidden;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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

  .marker-layer {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
  }

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
  .offline-button,
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
  .offline-button,
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

  .offline-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 96px;
    height: 48px;
    padding: 0 12px;
    border-radius: 8px;
    font-weight: 800;
    white-space: nowrap;
    justify-content: center;
  }

  .offline-button.ready {
    color: #1f6b45;
  }

  .offline-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #b9b1a3;
    flex: 0 0 auto;
  }

  .offline-dot.online {
    background: #2d8a5f;
  }

  .roadmap-menu {
    position: absolute;
    right: 12px;
    bottom: max(12px, env(safe-area-inset-bottom));
    min-width: 96px;
    z-index: 9;
    color: #17201c;
  }

  .roadmap-menu summary {
    display: grid;
    height: 40px;
    place-items: center;
    padding: 0 12px;
    border: 1px solid rgba(23, 32, 28, 0.14);
    border-radius: 8px;
    background: rgba(255, 252, 244, 0.96);
    box-shadow: 0 8px 22px rgba(27, 31, 28, 0.12);
    cursor: pointer;
    font-weight: 800;
    list-style: none;
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
    right: 0;
    bottom: 48px;
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

  .zoom-controls .location-button {
    font-size: 12px;
    letter-spacing: 0;
  }

  .zoom-controls .location-button.active {
    color: #fff;
    background: #2563eb;
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
    right: 118px;
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

  .install-help {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(23, 32, 28, 0.5);
  }

  .install-help-card {
    width: min(360px, 100%);
    padding: 20px 22px;
    border-radius: 14px;
    background: #fffdf7;
    box-shadow: 0 24px 60px rgba(27, 31, 28, 0.3);
  }

  .install-help-card h2 {
    margin: 0 0 12px;
    font-size: 18px;
  }

  .install-help-card ol {
    margin: 0 0 12px;
    padding-left: 20px;
    display: grid;
    gap: 8px;
    line-height: 1.4;
    font-size: 14px;
  }

  .install-help-note {
    margin: 0 0 14px;
    color: #5f675f;
    font-size: 13px;
    line-height: 1.4;
  }

  .install-help-card button {
    width: 100%;
    min-height: 42px;
    border: 0;
    border-radius: 8px;
    color: #fff;
    background: #17201c;
    font-weight: 800;
    cursor: pointer;
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
      grid-template-columns: minmax(0, 1fr) 58px auto;
    }

    .offline-button {
      min-width: 84px;
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

    .roadmap-menu {
      min-width: 84px;
    }

    .roadmap-menu summary {
      padding: 0 8px;
      font-size: 13px;
    }

    .price-controls {
      overflow-x: auto;
      max-width: calc(100vw - 24px);
      padding-bottom: 2px;
    }
  }
</style>
