<script>
  import { onMount } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { Protocol } from 'pmtiles';
  import {
    GB_FIT_BOUNDS,
    HOME_VIEW_PADDING,
    LOCATION_ZOOM,
    LONDON_BOUNDS,
    MAX_ZOOM,
    MIN_ZOOM_OFFLINE_FLOOR,
    MIN_ZOOM_ONLINE,
    OFFLINE_MAX_BOUNDS,
    ONLINE_TILE_URL,
    SEARCH_ZOOM,
    clamp
  } from '../constants.js';
  import { buildLocalStyle, buildOnlineStyle, LINE_QUERY_LAYERS } from './style.js';
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
    map.on('move', () => renderer.schedule());
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
    map.on('click', (event) => {
      const action = renderer.activate(event.point, { touch: isTouch(event) });
      if (action?.type === 'select') {
        app.select(action.restaurant);
        app.linesPopup = null; // restaurant takes priority
      } else {
        app.linesPopup = linesAt(event.point);
      }
    });
    // Desktop hover: live line identification (touch devices rely on tap above).
    // hitTest is non-mutating so hovering never disturbs the tap-cycle state.
    map.on('mousemove', (event) => {
      if (renderer.hitTest(event.point)) {
        app.hoverLines = null;
        map.getCanvas().style.cursor = 'pointer';
        return;
      }
      app.hoverLines = linesAt(event.point);
      map.getCanvas().style.cursor = app.hoverLines ? 'pointer' : '';
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

  // Rail/tube lines under a screen point, deduped by name (for the popup).
  function linesAt(point) {
    if (!map) return null;
    const availableLayers = LINE_QUERY_LAYERS.filter((id) => map.getLayer(id));
    if (!availableLayers.length) return null;
    const box = [
      [point.x - 6, point.y - 6],
      [point.x + 6, point.y + 6]
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
    // Flip the popup so it stays inside the map near the right/bottom edges.
    const container = map.getContainer();
    const w = container.clientWidth;
    const h = container.clientHeight;
    return { x: point.x, y: point.y, w, h, flipX: point.x > w - 252, flipY: point.y > h - 160, items };
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

  export function resetView() {
    renderer?.collapseSpider();
    if (app.userLocation) {
      setLocationView(app.userLocation);
    } else {
      homeViewApplied = false;
      applyFallbackHomeView();
    }
  }

  function setLocationView(location) {
    if (!location || !mapReady) return;
    map.flyTo({ center: [location.lon, location.lat], zoom: clamp(LOCATION_ZOOM, map.getMinZoom(), MAX_ZOOM) });
    homeViewApplied = true;
  }

  export function locate(options = {}) {
    if (!navigator.geolocation) {
      app.locationStatus = 'Location unavailable';
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
