<script>
  import { onMount } from 'svelte';

  const TILE_SIZE = 256;
  const MIN_ZOOM = 5;
  const MAX_ZOOM = 19;
  const DEFAULT_CENTER = { lat: 51.5074, lon: -0.1278 };
  const DEFAULT_ZOOM = 11;
  const SEARCH_LIMIT = 80;
  const MARKER_PADDING = 48;
  const MARKER_SPRITE_PADDING = 10;
  const PINCH_ZOOM_THRESHOLD = 1.16;

  let mapEl;
  let markerCanvas;
  let restaurants = [];
  let stats = null;
  let loading = true;
  let loadError = '';
  let width = 0;
  let height = 0;
  let center = DEFAULT_CENTER;
  let zoom = DEFAULT_ZOOM;
  let selected = null;
  let query = '';
  let priceFilter = 'all';
  let activePointers = new Map();
  let activePointer = null;
  let dragStart = null;
  let dragMoved = false;
  let pinchStart = null;
  let resizeObserver;
  let markerHitState = { hits: [] };
  let markerSpriteCache = new Map();
  let visibleMarkerCount = 0;
  let markerDrawFrame = 0;
  let panFrame = 0;
  let pendingCenter = null;
  let lastMarkerPick = null;
  let userLocation = null;
  let locationStatus = '';
  let locationWatchId = null;

  const prices = ['all', '$', '$$', '$$$', '$$$$'];
  const roadmapItems = [
    'Smaller description popup on mobile',
    'Location on by default',
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
    resizeObserver = new ResizeObserver(updateSize);
    if (mapEl) resizeObserver.observe(mapEl);
    updateSize();
    loadRestaurants();
    startLocationTracking();

    return () => {
      resizeObserver?.disconnect();
      stopLocationTracking();
    };
  });

  async function loadRestaurants() {
    try {
      const response = await fetch('/data/restaurants.json');
      if (!response.ok) throw new Error(`Data request failed with ${response.status}`);
      const payload = await response.json();
      restaurants = annotateMarkers(payload.restaurants || []);
      stats = payload.stats || null;
      fitBounds(payload.bounds);
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  $: searchText = query.trim().toLowerCase();
  $: filteredRestaurants = restaurants.filter((restaurant) => {
    if (priceFilter !== 'all' && restaurant.priceRange !== priceFilter) return false;
    if (!searchText) return true;
    return restaurant.searchText.includes(searchText);
  });
  $: projectedCenter = project(center.lat, center.lon, zoom);
  $: topLeft = {
    x: projectedCenter.x - width / 2,
    y: projectedCenter.y - height / 2
  };
  $: visibleTiles = getVisibleTiles(topLeft, width, height, zoom);
  $: searchResults = searchText ? filteredRestaurants.slice(0, SEARCH_LIMIT) : [];
  $: totalCount = stats?.entryCount || restaurants.length;
  $: scheduleMarkerDraw(filteredRestaurants, topLeft, width, height, zoom, selected?.id, userLocation);

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
      const lat = Number(item.lat);
      const lon = Number(item.lon);
      const basePoint = project(lat, lon, 0);
      return {
        ...item,
        lat,
        lon,
        duplicateCount: duplicateCounts.get(key) || 1,
        duplicateIndex,
        offsetX: offset.x,
        offsetY: offset.y,
        mapX: basePoint.x,
        mapY: basePoint.y,
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
      };
    });
  }

  function markerOffset(index, count) {
    if (count <= 1) return { x: 0, y: 0 };
    const ring = Math.floor(index / 8) + 1;
    const angle = ((index % 8) / 8) * Math.PI * 2;
    const radius = Math.min(24, 6 + ring * 5);
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  }

  function updateSize() {
    if (!mapEl) return;
    const rect = mapEl.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function project(lat, lon, z) {
    const sin = Math.sin((clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180);
    const scale = TILE_SIZE * 2 ** z;
    return {
      x: ((lon + 180) / 360) * scale,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
    };
  }

  function unproject(x, y, z) {
    const scale = TILE_SIZE * 2 ** z;
    const lon = (x / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / scale;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return {
      lat: clamp(lat, -85.05112878, 85.05112878),
      lon: clamp(lon, -180, 180)
    };
  }

  function fitBounds(bounds) {
    if (!bounds || !width || !height) return;
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const centerLon = (bounds.minLon + bounds.maxLon) / 2;
    center = { lat: centerLat, lon: centerLon };

    for (let z = MAX_ZOOM; z >= MIN_ZOOM; z -= 1) {
      const northwest = project(bounds.maxLat, bounds.minLon, z);
      const southeast = project(bounds.minLat, bounds.maxLon, z);
      if (Math.abs(southeast.x - northwest.x) <= width * 0.72 && Math.abs(southeast.y - northwest.y) <= height * 0.72) {
        zoom = z;
        return;
      }
    }
    zoom = 6;
  }

  function getVisibleTiles(origin, viewportWidth, viewportHeight, z) {
    if (!viewportWidth || !viewportHeight) return [];
    const scaleTiles = 2 ** z;
    const minX = Math.floor(origin.x / TILE_SIZE) - 1;
    const maxX = Math.floor((origin.x + viewportWidth) / TILE_SIZE) + 1;
    const minY = Math.floor(origin.y / TILE_SIZE) - 1;
    const maxY = Math.floor((origin.y + viewportHeight) / TILE_SIZE) + 1;
    const tiles = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        if (y < 0 || y >= scaleTiles) continue;
        const wrappedX = ((x % scaleTiles) + scaleTiles) % scaleTiles;
        tiles.push({
          key: `${z}-${x}-${y}`,
          url: `https://tile.openstreetmap.org/${z}/${wrappedX}/${y}.png`,
          left: x * TILE_SIZE - origin.x,
          top: y * TILE_SIZE - origin.y
        });
      }
    }
    return tiles;
  }

  function getVisibleMarkerData(items, origin, viewportWidth, viewportHeight, z) {
    if (!viewportWidth || !viewportHeight) return [];
    const scale = 2 ** z;
    const markers = [];
    for (const restaurant of items) {
      const x = restaurant.mapX * scale - origin.x + restaurant.offsetX;
      const y = restaurant.mapY * scale - origin.y + restaurant.offsetY;
      if (
        x >= -MARKER_PADDING &&
        x <= viewportWidth + MARKER_PADDING &&
        y >= -MARKER_PADDING &&
        y <= viewportHeight + MARKER_PADDING
      ) {
        markers.push({ restaurant, x, y });
      }
    }
    return markers;
  }

  function markerColor(priceRange) {
    if (priceRange === '$') return '#2d8a5f';
    if (priceRange === '$$') return '#2770a7';
    if (priceRange === '$$$') return '#7f52a1';
    if (priceRange === '$$$$') return '#252a31';
    return '#d43d2f';
  }

  function scheduleMarkerDraw(items, origin, viewportWidth, viewportHeight, z, selectedId, location) {
    if (!markerCanvas || !viewportWidth || !viewportHeight) return;
    if (markerDrawFrame) cancelAnimationFrame(markerDrawFrame);
    markerDrawFrame = requestAnimationFrame(() => {
      markerDrawFrame = 0;
      drawMarkers(items, origin, viewportWidth, viewportHeight, z, selectedId, location);
    });
  }

  function drawMarkers(items, origin, viewportWidth, viewportHeight, z, selectedId, location) {
    const canvas = markerCanvas;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const targetWidth = Math.max(1, Math.round(viewportWidth * dpr));
    const targetHeight = Math.max(1, Math.round(viewportHeight * dpr));
    if (canvas.width !== targetWidth) canvas.width = targetWidth;
    if (canvas.height !== targetHeight) canvas.height = targetHeight;
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${viewportHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);

    const markers = getVisibleMarkerData(items, origin, viewportWidth, viewportHeight, z);
    if (visibleMarkerCount !== markers.length) visibleMarkerCount = markers.length;
    markerHitState.hits = markers.map((marker) => ({
      id: marker.restaurant.id,
      x: marker.x,
      y: marker.y,
      radius: marker.restaurant.id === selectedId ? 17 : 13,
      restaurant: marker.restaurant
    }));

    const selectedMarker = selectedId ? markers.find((marker) => marker.restaurant.id === selectedId) : null;
    for (const marker of markers) {
      if (marker.restaurant.id === selectedId) continue;
      drawMarker(ctx, marker, false);
    }
    if (selectedMarker) drawMarker(ctx, selectedMarker, true);
    drawUserLocation(ctx, location, origin, viewportWidth, viewportHeight, z);
  }

  function drawMarker(ctx, marker, active) {
    const sprite = getMarkerSprite(marker.restaurant.priceRange, active);
    ctx.drawImage(sprite.canvas, marker.x - sprite.size / 2, marker.y - sprite.size / 2, sprite.size, sprite.size);
  }

  function getMarkerSprite(priceRange, active) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const normalizedPrice = priceRange || 'none';
    const key = `${normalizedPrice}-${active ? 'active' : 'default'}-${dpr}`;
    const cached = markerSpriteCache.get(key);
    if (cached) return cached;

    const radius = active ? 17 : 12;
    const size = (radius + MARKER_SPRITE_PADDING) * 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(size * dpr);
    canvas.height = Math.ceil(size * dpr);
    const ctx = canvas.getContext('2d');
    const center = size / 2;

    ctx.scale(dpr, dpr);
    ctx.shadowColor = active ? 'rgba(27, 31, 28, 0.42)' : 'rgba(27, 31, 28, 0.26)';
    ctx.shadowBlur = active ? 14 : 8;
    ctx.shadowOffsetY = active ? 4 : 3;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = markerColor(priceRange);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = active ? 3 : 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    if (priceRange) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 ${priceRange.length >= 4 ? 7 : 8}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(priceRange, center, center + 0.5);
    }

    const sprite = { canvas, size };
    markerSpriteCache.set(key, sprite);
    return sprite;
  }

  function drawUserLocation(ctx, location, origin, viewportWidth, viewportHeight, z) {
    if (!location) return;
    const point = project(location.lat, location.lon, z);
    const x = point.x - origin.x;
    const y = point.y - origin.y;
    if (x < -100 || x > viewportWidth + 100 || y < -100 || y > viewportHeight + 100) return;

    const accuracyRadius = location.accuracy
      ? clamp(location.accuracy / metersPerPixel(location.lat, z), 10, 90)
      : 0;

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

  function isMapChrome(target) {
    return Boolean(target?.closest?.('.topbar, .zoom-controls, .price-controls, .results-panel, .attribution'));
  }

  function pickMarker(clientX, clientY) {
    if (!mapEl) return null;
    const rect = mapEl.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const candidates = [];
    for (const hit of markerHitState.hits) {
      const dx = x - hit.x;
      const dy = y - hit.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= hit.radius + 10) {
        candidates.push({ ...hit, distance });
      }
    }
    if (!candidates.length) {
      lastMarkerPick = null;
      return null;
    }

    candidates.sort((a, b) => a.distance - b.distance || String(a.id).localeCompare(String(b.id)));
    const key = candidates.map((candidate) => candidate.id).join('|');
    const repeatedPick =
      lastMarkerPick &&
      lastMarkerPick.key === key &&
      Math.abs(lastMarkerPick.x - clientX) <= 18 &&
      Math.abs(lastMarkerPick.y - clientY) <= 18;
    const index = repeatedPick ? (lastMarkerPick.index + 1) % candidates.length : 0;
    lastMarkerPick = { key, index, x: clientX, y: clientY };
    return candidates[index].restaurant;
  }

  function setCenterRaf(nextCenter) {
    pendingCenter = nextCenter;
    if (panFrame) return;
    panFrame = requestAnimationFrame(() => {
      panFrame = 0;
      if (pendingCenter) {
        center = pendingCenter;
        pendingCenter = null;
      }
    });
  }

  function flushPendingCenter() {
    if (!pendingCenter) return;
    if (panFrame) {
      cancelAnimationFrame(panFrame);
      panFrame = 0;
    }
    center = pendingCenter;
    pendingCenter = null;
  }

  function eventPoint(event) {
    return { x: event.clientX, y: event.clientY };
  }

  function pointerDistance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function pointerMidpoint(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2
    };
  }

  function firstTwoPointers() {
    return [...activePointers.values()].slice(0, 2);
  }

  function startPinch() {
    const [first, second] = firstTwoPointers();
    if (!first || !second) return;
    const midpoint = pointerMidpoint(first, second);
    pinchStart = {
      distance: pointerDistance(first, second),
      midpoint,
      centerPx: project(center.lat, center.lon, zoom)
    };
    activePointer = null;
    dragStart = null;
    dragMoved = true;
  }

  function updatePinch() {
    const [first, second] = firstTwoPointers();
    if (!first || !second) return;
    if (!pinchStart) startPinch();
    if (!pinchStart) return;

    const distance = pointerDistance(first, second);
    const midpoint = pointerMidpoint(first, second);
    const dx = midpoint.x - pinchStart.midpoint.x;
    const dy = midpoint.y - pinchStart.midpoint.y;
    setCenterRaf(unproject(pinchStart.centerPx.x - dx, pinchStart.centerPx.y - dy, zoom));

    if (distance > pinchStart.distance * PINCH_ZOOM_THRESHOLD) {
      flushPendingCenter();
      zoomAt(midpoint.x, midpoint.y, 1);
      startPinch();
    } else if (distance < pinchStart.distance / PINCH_ZOOM_THRESHOLD) {
      flushPendingCenter();
      zoomAt(midpoint.x, midpoint.y, -1);
      startPinch();
    }
  }

  function onPointerDown(event) {
    if (isMapChrome(event.target)) return;
    if (event.button !== undefined && event.button !== 0) return;
    activePointers.set(event.pointerId, eventPoint(event));
    mapEl?.setPointerCapture?.(event.pointerId);
    if (activePointers.size >= 2) {
      flushPendingCenter();
      startPinch();
      return;
    }
    activePointer = event.pointerId;
    dragMoved = false;
    dragStart = {
      x: event.clientX,
      y: event.clientY,
      centerPx: project(center.lat, center.lon, zoom)
    };
  }

  function onPointerMove(event) {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, eventPoint(event));
    }
    if (activePointers.size >= 2) {
      updatePinch();
      return;
    }
    if (activePointer !== event.pointerId || !dragStart) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
    setCenterRaf(unproject(dragStart.centerPx.x - dx, dragStart.centerPx.y - dy, zoom));
  }

  function onPointerUp(event) {
    const wasPinching = Boolean(pinchStart) || activePointers.size >= 2;
    activePointers.delete(event.pointerId);
    mapEl?.releasePointerCapture?.(event.pointerId);

    if (wasPinching) {
      flushPendingCenter();
      pinchStart = null;
      const remainingPointer = activePointers.entries().next().value;
      if (remainingPointer) {
        activePointer = remainingPointer[0];
        dragStart = {
          x: remainingPointer[1].x,
          y: remainingPointer[1].y,
          centerPx: project(center.lat, center.lon, zoom)
        };
        dragMoved = true;
      } else {
        activePointer = null;
        dragStart = null;
      }
      return;
    }

    if (activePointer !== event.pointerId) return;
    flushPendingCenter();
    if (!dragMoved && !isMapChrome(event.target)) {
      const picked = pickMarker(event.clientX, event.clientY);
      if (picked) selectRestaurant(picked);
    }
    activePointer = null;
    dragStart = null;
  }

  function onWheel(event) {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    zoomAt(event.clientX, event.clientY, direction);
  }

  function zoomAt(clientX, clientY, delta) {
    const nextZoom = clamp(zoom + delta, MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === zoom || !mapEl) return;
    const rect = mapEl.getBoundingClientRect();
    const before = {
      x: topLeft.x + clientX - rect.left,
      y: topLeft.y + clientY - rect.top
    };
    const beforeGeo = unproject(before.x, before.y, zoom);
    const afterPoint = project(beforeGeo.lat, beforeGeo.lon, nextZoom);
    const nextTopLeft = {
      x: afterPoint.x - (clientX - rect.left),
      y: afterPoint.y - (clientY - rect.top)
    };
    center = unproject(nextTopLeft.x + width / 2, nextTopLeft.y + height / 2, nextZoom);
    zoom = nextZoom;
  }

  function zoomButton(delta) {
    zoomAt(width / 2 + (mapEl?.getBoundingClientRect().left || 0), height / 2 + (mapEl?.getBoundingClientRect().top || 0), delta);
  }

  function selectRestaurant(restaurant) {
    selected = restaurant;
  }

  function closeDetails() {
    selected = null;
  }

  function resetMap() {
    fitBounds(stats?.bounds);
    selected = null;
    query = '';
    priceFilter = 'all';
    lastMarkerPick = null;
  }

  function startLocationTracking() {
    if (!navigator.geolocation) {
      locationStatus = 'Location unavailable';
      return;
    }
    if (userLocation) {
      center = { lat: userLocation.lat, lon: userLocation.lon };
      if (zoom < 15) zoom = 15;
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
        if (firstLocation) {
          center = { lat: userLocation.lat, lon: userLocation.lon };
          if (zoom < 15) zoom = 15;
        }
      },
      (error) => {
        locationStatus = error.message || 'Location unavailable';
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
    content="Full map of restaurants featured in Eater map guides."
  />
</svelte:head>

<main class="app-shell">
  <section
    class="map"
    bind:this={mapEl}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
    on:wheel={onWheel}
    role="application"
    aria-label="Restaurant map"
  >
    <div class="tile-layer" aria-hidden="true">
      {#each visibleTiles as tile (tile.key)}
        <img
          class="tile"
          src={tile.url}
          alt=""
          draggable="false"
          style={`transform: translate3d(${tile.left}px, ${tile.top}px, 0);`}
        />
      {/each}
    </div>

    <canvas class="marker-layer" bind:this={markerCanvas} aria-hidden="true"></canvas>

    {#if loading}
      <div class="state-pill">Loading</div>
    {:else if loadError}
      <div class="state-pill error">{loadError}</div>
    {/if}

    <div class="topbar">
      <label class="search">
        <span>Search</span>
        <input bind:value={query} type="search" placeholder="Restaurant, area, guide" autocomplete="off" />
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
        on:click={startLocationTracking}
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
      <div class="results-panel">
        {#each searchResults as result (result.id)}
          <button type="button" on:click={() => selectRestaurant(result)}>
            <strong>{result.name}</strong>
            <span>{result.address}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="attribution">
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
        <p class="description">{selected.description}</p>
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
        <a href={selected.googleMapsUrl} target="_blank" rel="noreferrer">Map</a>
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
    touch-action: none;
    background: #d8dfd4;
    cursor: grab;
  }

  .map:active {
    cursor: grabbing;
  }

  .tile-layer,
  .marker-layer {
    position: absolute;
    inset: 0;
  }

  .marker-layer {
    z-index: 2;
    pointer-events: none;
  }

  .tile {
    position: absolute;
    width: 256px;
    height: 256px;
    user-select: none;
    will-change: transform;
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

  .search input {
    width: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: #17201c;
    font-size: 16px;
    min-width: 0;
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

  .results-panel {
    position: absolute;
    top: 76px;
    left: 12px;
    width: min(420px, calc(100vw - 24px));
    max-height: min(46vh, 420px);
    overflow: auto;
    border: 1px solid rgba(23, 32, 28, 0.12);
    border-radius: 8px;
    background: rgba(255, 252, 244, 0.98);
    box-shadow: 0 18px 40px rgba(27, 31, 28, 0.18);
    z-index: 12;
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
      padding: 14px 14px max(14px, env(safe-area-inset-bottom));
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

    .details-panel .description {
      order: 7;
      max-height: calc(1.42em * 7);
      margin: 0 0 10px;
      padding-right: 3px;
      overflow-y: auto;
      line-height: 1.42;
      font-size: 14px;
      -webkit-overflow-scrolling: touch;
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
      gap: 6px;
      margin: 2px 0 10px;
      padding: 0;
      background: transparent;
    }

    .actions a {
      flex: 1 1 0;
      min-width: 0;
      min-height: 38px;
      padding: 0 6px;
      font-size: 12px;
      white-space: nowrap;
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
