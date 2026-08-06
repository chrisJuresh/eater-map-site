<script>
  import { onMount } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { Protocol } from 'pmtiles';
  import {
    GB_FIT_BOUNDS,
    HOME_VIEW_PADDING,
    LINES_HIT_PX,
    LOCATION_ZOOM,
    LONDON_BOUNDS,
    MAX_ZOOM,
    MIN_ZOOM_OFFLINE_FLOOR,
    MIN_ZOOM_ONLINE,
    OFFLINE_MAX_BOUNDS,
    ONLINE_TILE_URL,
    SEARCH_ZOOM,
    STATION_SEARCH_PX,
    clamp
  } from '../constants.js';
  import { buildLocalStyle, buildOnlineStyle, LINE_QUERY_LAYERS, STATION_LAYER } from './style.js';
  import { MarkerRenderer } from './markers.js';

  /**
   * @type {{ app: import('../state.svelte.js').AppState,
   *          initialView?: {zoom:number,lat:number,lon:number} | null,
   *          onViewChange?: (view: {zoom:number,lat:number,lon:number}) => void }}
   */
  let { app, initialView = null, onViewChange } = $props();

  let mapEl;
  let markerCanvas;
  let map;
  let mapReady = $state(false);
  let renderer;
  let resizeObserver;
  let locationWatchId = null;
  let homeViewApplied = false;
  let mapWasInteractedWith = false;
  let styleMode = ''; // 'online' | 'local'
  let settleFrame = 0;

  onMount(() => {
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    // Coarse pointers (thumbs) get a larger tap target + a more forgiving cycle
    // window so tapping through stacked markers doesn't demand pixel precision.
    const coarsePointer = window.matchMedia?.('(any-pointer: coarse)')?.matches ?? false;
    const isTouch = (event) => coarsePointer || event?.originalEvent?.pointerType === 'touch';
    // Hover is a fine-pointer affordance. A tap also emits one compatibility
    // mousemove, which would otherwise leave a hover popup stuck on screen with
    // no mouseout to clear it — so gate on hover capability, and on hybrids
    // swallow the single synthetic move a touch produces.
    const canHover = window.matchMedia?.('(hover: hover)')?.matches ?? true;
    let touchSyntheticMove = false;

    const startOnline = app.online && Boolean(ONLINE_TILE_URL);
    styleMode = startOnline ? 'online' : 'local';
    if (initialView) {
      // A shared/deep-linked view wins over the automatic home/location view.
      homeViewApplied = true;
      mapWasInteractedWith = true;
    }
    map = new maplibregl.Map({
      container: mapEl,
      style: startOnline ? buildOnlineStyle() : buildLocalStyle(),
      center: initialView
        ? [initialView.lon, initialView.lat]
        : [(LONDON_BOUNDS.minLon + LONDON_BOUNDS.maxLon) / 2, (LONDON_BOUNDS.minLat + LONDON_BOUNDS.maxLat) / 2],
      zoom: initialView ? initialView.zoom : 10,
      minZoom: startOnline ? MIN_ZOOM_ONLINE : MIN_ZOOM_OFFLINE_FLOOR,
      maxZoom: MAX_ZOOM,
      maxBounds: startOnline ? undefined : OFFLINE_MAX_BOUNDS,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: false
    });
    map.touchZoomRotate.disableRotation();

    renderer = new MarkerRenderer({
      map,
      canvas: markerCanvas,
      host: mapEl,
      read: () => ({ restaurants: app.filtered, selectedId: app.selected?.id, userLocation: app.userLocation }),
      onVisibleCount: (count) => {
        if (app.visibleMarkerCount !== count) app.visibleMarkerCount = count;
      }
    });

    map.on('error', (event) => console.error('MapLibre error:', event.error?.message || event.error));
    map.on('load', () => {
      mapReady = true;
      if (styleMode === 'local') updateOfflineMinZoom();
      // A cached geolocation fix can arrive before 'load' (setLocationView is a
      // no-op until mapReady) — apply it now instead of stranding the default view.
      if (app.userLocation && !homeViewApplied && !mapWasInteractedWith) setLocationView(app.userLocation);
      else applyFallbackHomeView();
      renderer.schedule();
      settleSoon();
    });
    map.on('styledata', () => renderer.schedule());
    map.on('move', () => {
      renderer.schedule();
      // Both popups are pinned to a place on the map, so re-project them every
      // frame of the camera move. (A desktop drag also fires mousemove, which
      // re-reads the lines under the cursor and wins — as hover should.)
      if (app.linesPopup) app.linesPopup = placeLines(app.linesPopup);
      if (app.hoverLines) app.hoverLines = placeLines(app.hoverLines);
    });
    map.on('moveend', () => {
      renderer.schedule();
      settleSoon();
      renderer.syncSpider(app.selected); // open/close the fan as the zoom gate is crossed
      const center = map.getCenter();
      onViewChange?.({ zoom: map.getZoom(), lat: center.lat, lon: center.lng });
    });
    map.on('idle', () => settleSoon());
    map.on('movestart', (event) => {
      if (event.originalEvent) mapWasInteractedWith = true;
    });
    // A restaurant and a line can sit under the same point: selecting one does
    // not hide the other, so the popup lists whatever lines are under the tap
    // either way (it is pointer-events:none, so it never eats the next tap).
    map.on('click', (event) => {
      const action = renderer.activate(event.point, { touch: isTouch(event) });
      if (action?.type === 'select') app.select(action.restaurant);
      app.linesPopup = linesAt(event.point);
    });
    // Desktop hover: live line identification (touch devices rely on tap above).
    // Same rule as the click — lines show whether or not a restaurant is under
    // the cursor. hitTest is non-mutating, so hovering never disturbs the
    // tap-cycle state.
    map.on('touchstart', () => {
      touchSyntheticMove = true;
      app.hoverLines = null; // the tap owns the popup from here
    });
    map.on('mousemove', (event) => {
      if (!canHover) return;
      if (touchSyntheticMove) {
        touchSyntheticMove = false;
        return;
      }
      const overRestaurant = Boolean(renderer.hitTest(event.point));
      app.hoverLines = linesAt(event.point);
      map.getCanvas().style.cursor = overRestaurant || app.hoverLines ? 'pointer' : '';
    });
    map.on('mouseout', () => (app.hoverLines = null));

    resizeObserver = new ResizeObserver(() => {
      map?.resize();
      if (styleMode === 'local') updateOfflineMinZoom();
      renderer?.schedule();
    });
    resizeObserver.observe(mapEl);

    locate();

    return () => {
      resizeObserver?.disconnect();
      stopLocationTracking();
      if (settleFrame) cancelAnimationFrame(settleFrame);
      renderer?.destroy();
      map?.remove();
      maplibregl.removeProtocol('pmtiles');
    };
  });

  // Redraw when the filtered set, selection, or user location changes.
  $effect(() => {
    app.filtered;
    app.selected;
    app.userLocation;
    if (mapReady) {
      renderer?.schedule();
      settleSoon();
    }
  });

  // Keep the fan in sync with the selection: a stacked selection at close zoom is
  // always shown fanned; anything else collapses it. Idempotent, so re-selecting a
  // member of the same stack keeps the fan open (no re-animate).
  $effect(() => {
    app.filtered;
    app.selected;
    if (mapReady) renderer?.syncSpider(app.selected);
  });

  // Swap basemap when connectivity changes (after initial mount).
  $effect(() => {
    const wantOnline = app.online && Boolean(ONLINE_TILE_URL);
    const wantMode = wantOnline ? 'online' : 'local';
    if (!map || !styleMode || wantMode === styleMode) return;
    styleMode = wantMode;
    if (wantOnline) {
      map.setMaxBounds(null);
      map.setMinZoom(MIN_ZOOM_ONLINE);
      map.setStyle(buildOnlineStyle());
    } else {
      map.setStyle(buildLocalStyle());
      map.setMaxBounds(OFFLINE_MAX_BOUNDS);
      updateOfflineMinZoom();
    }
    renderer?.schedule();
  });

  // Settle the in-view list once the camera/filters stop changing. Always
  // re-arm: a pending settle queued before a draw frame would otherwise publish
  // the PRE-change marker set (rAF callbacks run in queue order).
  function settleSoon() {
    if (settleFrame) cancelAnimationFrame(settleFrame);
    settleFrame = requestAnimationFrame(() => {
      settleFrame = 0;
      if (renderer) app.inView = renderer.lastVisible;
    });
  }

  // Zoom out far enough (offline) that the whole covered area fits with padding,
  // computed for the current viewport so it works on desktop and mobile.
  function updateOfflineMinZoom() {
    if (!map) return;
    const camera = map.cameraForBounds(GB_FIT_BOUNDS, { padding: 24 });
    if (camera && Number.isFinite(camera.zoom)) {
      map.setMinZoom(Math.max(MIN_ZOOM_OFFLINE_FLOOR - 1, camera.zoom - 0.25));
    }
  }

  // Nearest station dot to a screen point, within STATION_SEARCH_PX. Measured in
  // screen space (project each candidate back) so the closest one wins, not
  // whichever the query happened to return first.
  function stationNear(point) {
    if (!map.getLayer(STATION_LAYER)) return null;
    const box = [
      [point.x - STATION_SEARCH_PX, point.y - STATION_SEARCH_PX],
      [point.x + STATION_SEARCH_PX, point.y + STATION_SEARCH_PX]
    ];
    let closest = null;
    let closestDistance = Infinity;
    for (const feature of map.queryRenderedFeatures(box, { layers: [STATION_LAYER] })) {
      const name = feature.properties?.name;
      const at = feature.geometry?.coordinates;
      if (!name || !Array.isArray(at) || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) continue;
      const screen = map.project(at);
      const distance = Math.hypot(screen.x - point.x, screen.y - point.y);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = name;
      }
    }
    return closest;
  }

  // Rail/tube lines under a screen point, deduped by name (for the popup).
  function linesAt(point) {
    if (!map) return null;
    const availableLayers = LINE_QUERY_LAYERS.filter((id) => map.getLayer(id));
    if (!availableLayers.length) return null;
    const box = [
      [point.x - LINES_HIT_PX, point.y - LINES_HIT_PX],
      [point.x + LINES_HIT_PX, point.y + LINES_HIT_PX]
    ];
    const features = map.queryRenderedFeatures(box, { layers: availableLayers });
    const seen = new Set();
    const items = [];
    for (const feature of features) {
      const name = feature.properties.line || 'National Rail';
      if (seen.has(name)) continue;
      seen.add(name);
      items.push({ name, color: feature.properties.color || '#41476b' });
      if (items.length >= 8) break;
    }
    if (!items.length) return null;
    // Anchor to the geographic point, not the screen point, so the popup rides
    // the map when it is panned or zoomed.
    const anchor = map.unproject(point);
    // Resolved once, at the point that opened the popup — panning re-places the
    // popup but must not re-pick the station out from under it.
    return placeLines({ lng: anchor.lng, lat: anchor.lat, station: stationNear(point), items });
  }

  // Screen placement for a map-anchored lines popup. Flipped so it stays inside
  // the map near the right/bottom edges.
  function placeLines(entry) {
    const { x, y } = map.project([entry.lng, entry.lat]);
    const container = map.getContainer();
    const w = container.clientWidth;
    const h = container.clientHeight;
    return { ...entry, x, y, w, h, flipX: x > w - 252, flipY: y > h - 160 };
  }

  // ---- Exported camera / location API -----------------------------------------

  export function applyFallbackHomeView() {
    if (!mapReady || homeViewApplied || app.userLocation) return;
    map.fitBounds(
      [
        [LONDON_BOUNDS.minLon, LONDON_BOUNDS.minLat],
        [LONDON_BOUNDS.maxLon, LONDON_BOUNDS.maxLat]
      ],
      { padding: HOME_VIEW_PADDING, maxZoom: 11, animate: false }
    );
    homeViewApplied = true;
  }

  export function flyToRestaurant(restaurant, { jump = false } = {}) {
    if (!map || !Number.isFinite(restaurant?.lat) || !Number.isFinite(restaurant?.lon)) return;
    mapWasInteractedWith = true;
    homeViewApplied = true;
    const zoom = Math.max(map.getZoom(), SEARCH_ZOOM);
    if (jump) map.jumpTo({ center: [restaurant.lon, restaurant.lat], zoom });
    else map.flyTo({ center: [restaurant.lon, restaurant.lat], zoom });
  }

  export function flyToPlace(place) {
    if (!map) return;
    mapWasInteractedWith = true;
    homeViewApplied = true;
    const bbox = place.boundingbox;
    if (Array.isArray(bbox) && bbox.length === 4) {
      const [south, north, west, east] = bbox.map(Number);
      if ([south, north, west, east].every(Number.isFinite)) {
        map.fitBounds(
          [
            [west, south],
            [east, north]
          ],
          { maxZoom: 16, padding: 80, duration: 800 }
        );
        return;
      }
    }
    map.flyTo({ center: [Number(place.lon), Number(place.lat)], zoom: 16 });
  }

  export function zoomBy(delta) {
    if (!map) return;
    map.easeTo({ zoom: clamp(map.getZoom() + delta, map.getMinZoom(), MAX_ZOOM), duration: 200 });
  }

  // Re-fit the home view even though one was applied already. This is what the
  // locate button falls back to when there is no location to fly to, so it
  // doubles as the "get me back to the whole map" reset.
  function returnToHomeView() {
    homeViewApplied = false;
    applyFallbackHomeView();
  }

  function setLocationView(location) {
    if (!location || !mapReady) return;
    map.flyTo({ center: [location.lon, location.lat], zoom: clamp(LOCATION_ZOOM, map.getMinZoom(), MAX_ZOOM) });
    homeViewApplied = true;
  }

  export function locate(options = {}) {
    // An explicit press is also the app's reset: drop the fan, and if there is
    // no location (unsupported, denied, timed out) fall back to the home view.
    if (options.restart) renderer?.collapseSpider();
    if (!navigator.geolocation) {
      app.locationStatus = 'Location unavailable';
      if (options.restart) returnToHomeView();
      return;
    }
    if (app.userLocation) setLocationView(app.userLocation);
    if (options.restart && locationWatchId !== null) stopLocationTracking();
    if (locationWatchId !== null) return;

    app.locationStatus = 'Locating';
    locationWatchId = navigator.geolocation.watchPosition(
      (position) => {
        const firstLocation = !app.userLocation;
        app.userLocation = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        app.locationStatus = 'Live location on';
        if (firstLocation && (!mapWasInteractedWith || options.restart)) setLocationView(app.userLocation);
        renderer?.schedule();
      },
      (error) => {
        app.locationStatus = error.message || 'Location unavailable';
        stopLocationTracking();
        // On the automatic first attempt this only fills an unset view; a
        // deliberate press re-fits the home view even if one is already applied.
        if (options.restart) returnToHomeView();
        else applyFallbackHomeView();
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
  }

  function stopLocationTracking() {
    if (locationWatchId === null || !navigator.geolocation) return;
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
</script>

<div class="map-canvas" bind:this={mapEl} role="application" aria-label="Restaurant map"></div>
<canvas class="marker-layer" bind:this={markerCanvas} aria-hidden="true"></canvas>

<style>
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
</style>
