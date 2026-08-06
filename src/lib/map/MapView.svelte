<script>
  import { onMount } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { Protocol } from 'pmtiles';
  import {
    GB_FIT_BOUNDS,
    HOME_VIEW_PADDING,
    JUMP_MARKER_TOP_GAP,
    LINES_HIT_PX,
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
  import { buildLocalStyle, buildOnlineStyle, LINE_QUERY_LAYERS, STATION_LAYER } from './style.js';
  import { MarkerRenderer } from './markers.js';
  import { loadStations, stationsNow, stationsWithin } from '../stations.js';

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
  let stationsLoaded = $state(0); // bumps when /stations.json lands, to re-derive open popups
  let renderer;
  let resizeObserver;
  let locationWatchId = null;
  let homeViewApplied = false;
  let mapWasInteractedWith = false;
  let styleMode = ''; // 'online' | 'local'
  let settleFrame = 0;
  let userMove = false; // is the camera moving in the user's hands, or under ours?
  let popupFit = 0; // generation of the popups' placement decision

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
      // The popups are pinned to a place on the map, so re-project them every
      // frame of the camera move. (A desktop drag also fires mousemove, which
      // re-reads the point under the cursor and wins — as hover should.)
      replacePopups();
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
      // A move with an originalEvent is a drag, a pinch or a wheel: the user's
      // hands, so the open popups ride rather than re-fit until it ends.
      userMove = Boolean(event.originalEvent);
      if (event.originalEvent) mapWasInteractedWith = true;
    });
    // The popup is rooted where the tap landed: on the restaurant if one was
    // selected, otherwise on the point itself when that point is on the rail
    // network. Selecting therefore clears any tap-rooted popup — the new
    // selection owns the root. (The popup is pointer-events:none, so it never
    // eats the next tap.)
    map.on('click', (event) => {
      const action = renderer.activate(event.point, { touch: isTouch(event) });
      if (action?.type === 'select') {
        app.linesPopup = null;
        app.select(action.restaurant);
        return;
      }
      app.linesPopup = railUnder(event.point) ? stationsPopupAt(event.point) : null;
    });
    // Desktop hover: the stations around whatever the cursor is over (touch
    // devices rely on the tap above). hitTest is non-mutating, so hovering never
    // disturbs the tap-cycle state.
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
      // A restaurant and a line can share a point, and one must not hide the
      // other: rail under the cursor opens the popup either way.
      const overRestaurant = Boolean(renderer.hitTest(event.point));
      const overRail = railUnder(event.point);
      app.hoverLines = overRail ? stationsPopupAt(event.point) : null;
      map.getCanvas().style.cursor = overRestaurant || overRail ? 'pointer' : '';
    });
    map.on('mouseout', () => (app.hoverLines = null));

    resizeObserver = new ResizeObserver(() => {
      map?.resize();
      if (styleMode === 'local') updateOfflineMinZoom();
      renderer?.schedule();
    });
    resizeObserver.observe(mapEl);

    // Walk distances need every station, including the ones off screen — a small
    // list of its own, fetched once alongside the map.
    loadStations().then((stations) => {
      if (stations.length) stationsLoaded += 1;
    });

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

  // A selected restaurant roots the popup on itself: the stations you could walk
  // to from its door, with what runs from each. Re-derived on every selection
  // change, and again once the station list has actually loaded.
  $effect(() => {
    const restaurant = app.selected;
    stationsLoaded;
    if (!mapReady) return;
    app.selectionLines =
      restaurant && Number.isFinite(restaurant.lat) && Number.isFinite(restaurant.lon)
        ? stationsPopup({ lng: restaurant.lon, lat: restaurant.lat, title: restaurant.nameCore || restaurant.name })
        : null;
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

  // Is there rail under this screen point? Only decides WHETHER a tap on the
  // bare map opens the popup — what it lists comes from the root point, not from
  // the features hit here.
  function railUnder(point) {
    if (!map) return false;
    const layers = [...LINE_QUERY_LAYERS, STATION_LAYER].filter((id) => map.getLayer(id));
    if (!layers.length) return false;
    const box = [
      [point.x - LINES_HIT_PX, point.y - LINES_HIT_PX],
      [point.x + LINES_HIT_PX, point.y + LINES_HIT_PX]
    ];
    return map.queryRenderedFeatures(box, { layers }).length > 0;
  }

  // The popup for a root place: every station within a walk of it, each with the
  // lines that serve it. Anchored to the root's lng/lat, not to the screen point,
  // so it rides the map when panned or zoomed.
  function stationsPopup(root) {
    if (!map || !Number.isFinite(root?.lng) || !Number.isFinite(root?.lat)) return null;
    const near = stationsWithin({ lat: root.lat, lon: root.lng }, stationsNow());
    if (!near.length) return null;
    return placePopup({ ...root, stations: near });
  }

  function stationsPopupAt(point) {
    const anchor = map.unproject(point);
    return stationsPopup({ lng: anchor.lng, lat: anchor.lat });
  }

  // The strip of map nothing is covering, in container px. On mobile the chrome
  // floats over the map, so the popup and the jump target have to live between
  // the search dropdown (or the top bar) and the details sheet.
  function freeBand() {
    const h = map.getContainer().clientHeight;
    const top = clamp(app.mapBandTop, 0, h);
    return { top, bottom: Math.max(top + 1, app.mapBandBottom || h) };
  }

  // Screen placement for a map-anchored popup: which side of the root it opens
  // on, flipped so it stays inside the free band near the right/bottom edges. The
  // height depends on how many stations are listed, so estimate it rather than
  // assume one size; the popup nudges itself the last few px once it knows its
  // real size. `fit` marks the generation of that decision — LinesPopup re-fits
  // when it changes and holds the fit it has when it doesn't.
  //
  // None of it applies unless the root is inside the band. Fitting a pane whose
  // root is off screen would strand it against an edge, listing the stations
  // around a dot that is nowhere to be seen — it slides under the chrome instead
  // (the pane sits below every control in the stack; see LinesPopup's z-index).
  function placePopup(entry) {
    const { x, y } = map.project([entry.lng, entry.lat]);
    const container = map.getContainer();
    const w = container.clientWidth;
    const h = container.clientHeight;
    const band = freeBand();
    const height = 16 + (entry.title ? 14 : 0) + entry.stations.length * 44;
    const inBand = x >= 0 && x <= w && y >= band.top && y <= band.bottom;
    popupFit += 1;
    return { ...entry, x, y, w, h, inBand, fit: popupFit, flipX: x > w - 272, flipY: inBand && y > band.bottom - height };
  }

  // Same pane, new anchor: re-project it and change nothing else, so it rides the
  // map rigidly. A viewport that changed shape is not a ride — re-decide there.
  function ridePopup(entry) {
    const container = map.getContainer();
    if (container.clientWidth !== entry.w || container.clientHeight !== entry.h) return placePopup(entry);
    const { x, y } = map.project([entry.lng, entry.lat]);
    return { ...entry, x, y };
  }

  // Re-place every open popup: the camera moved, so their anchors did too. Under
  // OUR camera (a fly to a search result) they re-fit as they go; in the user's
  // hands they only ride. Re-fitting mid-drag is what made a pane crawl away from
  // its dot and cling to the band's edge after the dot had left the screen.
  function replacePopups() {
    const place = userMove ? ridePopup : placePopup;
    if (app.selectionLines) app.selectionLines = place(app.selectionLines);
    if (app.linesPopup) app.linesPopup = place(app.linesPopup);
    if (app.hoverLines) app.hoverLines = place(app.hoverLines);
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

  // Where a jumped-to restaurant should land, as an offset from the container
  // centre. Dead centre is right where the mobile sheet is, which buries both the
  // marker and the stations popup hanging off it — so on that layout the marker
  // goes just under the panel above instead, leaving the rest of the band for the
  // popup. Never past the middle of the band, however little of it there is.
  function jumpOffset() {
    if (!app.mobileLayout) return [0, 0];
    const band = freeBand();
    const target = Math.min(band.top + JUMP_MARKER_TOP_GAP, (band.top + band.bottom) / 2);
    return [0, Math.round(target - map.getContainer().clientHeight / 2)];
  }

  export function flyToRestaurant(restaurant, { jump = false } = {}) {
    if (!map || !Number.isFinite(restaurant?.lat) || !Number.isFinite(restaurant?.lon)) return;
    mapWasInteractedWith = true;
    homeViewApplied = true;
    // easeTo, not jumpTo, for the instant case: only the animated moves take an
    // `offset`, and a zero duration makes easeTo one of them.
    const camera = {
      center: [restaurant.lon, restaurant.lat],
      zoom: Math.max(map.getZoom(), SEARCH_ZOOM),
      offset: jumpOffset()
    };
    if (jump) map.easeTo({ ...camera, duration: 0 });
    else map.flyTo(camera);
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
