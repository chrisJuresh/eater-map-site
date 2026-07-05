// Canvas marker overlay + spiderfy.
// - regular markers composited at a FLAT 0.42 opacity (overlaps must not darken)
// - the priced ("38 Best London") markers composited fully opaque, ON TOP
// - the selected marker drawn above everything at full detail
// - offscreen sprite cache keyed by price/detail/DPR
// - tapping a stack fans it out (spiderfy) into spaced, thumb-tappable targets

import {
  FULL_MARKER_ZOOM,
  MARKER_LAYER_OPACITY,
  MARKER_PADDING,
  MARKER_SPRITE_PADDING,
  MID_MARKER_ZOOM,
  PRICED_MARKER_LAYER_OPACITY,
  SPIDER_EDGE_PAD,
  SPIDER_GAP,
  SPIDER_MAX,
  SPIDER_MEMBER_OPACITY,
  SPIDER_MIN_R,
  SPIDER_MS,
  SPIDER_STACK_RADIUS_M,
  SPIDER_STAGGER,
  SPIDERFY_MIN_ZOOM,
  clamp,
  hasCoordinates,
  markerColor
} from '../constants.js';

function markerPriority(restaurant) {
  return restaurant?.priceRange ? 1 : 0;
}

// Hit tolerance (px) added to a marker's radius. Coarse pointers (thumbs) get a
// much larger target than a mouse cursor.
const HIT_EXTRA = 8;
const TOUCH_HIT_EXTRA = 22;
// Full-detail marker radius — fanned targets always draw at this size.
const FULL_RADIUS = 12;

/** Markers within tolerance of a screen point, nearest-first (deterministic). */
function candidatesAt(map, restaurants, selectedId, point, extra) {
  const candidates = [];
  for (const restaurant of restaurants) {
    const projected = map.project([restaurant.lon, restaurant.lat]);
    const x = projected.x + restaurant.offsetX;
    const y = projected.y + restaurant.offsetY;
    const distance = Math.hypot(point.x - x, point.y - y);
    const radius = restaurant.id === selectedId ? 17 : 13;
    if (distance <= radius + extra) candidates.push({ restaurant, distance });
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
  return candidates;
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

function metersPerPixel(lat, z) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/** Great-circle distance in metres between two {lat, lon} points. */
function metersBetween(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/**
 * Fan slot offsets (relative to the origin): one even ring, sized so adjacent
 * dots sit ~SPIDER_GAP apart (a tiny, uniform gap), floored at MIN_R for small
 * stacks. The ring grows with count so it never self-overlaps.
 */
function fanSlots(n) {
  if (n < 2) return [{ dx: 0, dy: 0 }];
  const radius = Math.max(SPIDER_MIN_R, SPIDER_GAP / (2 * Math.sin(Math.PI / n)));
  const slots = [];
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n; // start at 12 o'clock, clockwise
    slots.push({ dx: radius * Math.cos(angle), dy: radius * Math.sin(angle) });
  }
  return slots;
}

export class MarkerRenderer {
  /**
   * @param {object} opts
   * @param {import('maplibre-gl').Map} opts.map
   * @param {HTMLCanvasElement} opts.canvas
   * @param {HTMLElement} opts.host - element whose size defines the viewport
   * @param {() => {restaurants: any[], selectedId: any, userLocation: any}} opts.read
   * @param {(count: number) => void} [opts.onVisibleCount]
   */
  constructor({ map, canvas, host, read, onVisibleCount }) {
    this.map = map;
    this.canvas = canvas;
    this.host = host;
    this.read = read;
    this.onVisibleCount = onVisibleCount;
    this.frame = 0;
    this.spriteCache = new Map();
    this.layerCanvas = null;
    this.lastVisible = [];
    // Spiderfy state (null when closed). members[].tx/ty are absolute screen px.
    this.spider = null;
    this.spiderFrame = 0;
  }

  schedule() {
    if (!this.canvas || !this.map || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.spiderFrame) cancelAnimationFrame(this.spiderFrame);
    this.frame = 0;
    this.spiderFrame = 0;
    this.spider = null;
    this.map = null;
  }

  isSpiderOpen() {
    return !!this.spider;
  }

  collapseSpider() {
    if (this.spiderFrame) cancelAnimationFrame(this.spiderFrame);
    this.spiderFrame = 0;
    if (this.spider) {
      this.spider = null;
      this.schedule();
    }
  }

  draw() {
    const { map, canvas, host } = this;
    if (!map || !canvas || !host) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);
    if (canvas.width !== targetWidth) canvas.width = targetWidth;
    if (canvas.height !== targetHeight) canvas.height = targetHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { restaurants, selectedId, userLocation } = this.read();
    const z = map.getZoom();
    const spiderIds = this.spider ? new Set(this.spider.members.map((m) => m.restaurant.id)) : null;
    const markers = [];
    for (const restaurant of restaurants) {
      const point = map.project([restaurant.lon, restaurant.lat]);
      const x = point.x + restaurant.offsetX;
      const y = point.y + restaurant.offsetY;
      if (x < -MARKER_PADDING || x > width + MARKER_PADDING || y < -MARKER_PADDING || y > height + MARKER_PADDING) continue;
      markers.push({ restaurant, x, y });
    }
    this.lastVisible = markers.map((m) => m.restaurant);
    this.onVisibleCount?.(markers.length);

    if (!this.layerCanvas) this.layerCanvas = document.createElement('canvas');
    const layerCanvas = this.layerCanvas;
    if (layerCanvas.width !== targetWidth) layerCanvas.width = targetWidth;
    if (layerCanvas.height !== targetHeight) layerCanvas.height = targetHeight;
    const layerCtx = layerCanvas.getContext('2d');
    if (!layerCtx) return;
    layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const regularMarkers = [];
    const pricedMarkers = [];
    let selectedMarker = null;
    for (const marker of markers) {
      if (spiderIds?.has(marker.restaurant.id)) continue; // drawn in the spider tail instead
      if (marker.restaurant.id === selectedId) {
        selectedMarker = marker;
        continue;
      }
      if (marker.restaurant.priceRange) pricedMarkers.push(marker);
      else regularMarkers.push(marker);
    }

    // Composite each group at a flat opacity so overlapping markers do not darken.
    layerCtx.clearRect(0, 0, width, height);
    for (const marker of regularMarkers) this.drawMarker(layerCtx, marker, false, z);
    ctx.save();
    ctx.globalAlpha = MARKER_LAYER_OPACITY;
    ctx.drawImage(layerCanvas, 0, 0, width, height);
    ctx.restore();

    layerCtx.clearRect(0, 0, width, height);
    for (const marker of pricedMarkers) this.drawMarker(layerCtx, marker, false, z);
    ctx.save();
    ctx.globalAlpha = PRICED_MARKER_LAYER_OPACITY;
    ctx.drawImage(layerCanvas, 0, 0, width, height);
    ctx.restore();

    if (selectedMarker) this.drawMarker(ctx, selectedMarker, true, z);
    this.drawUserLocation(ctx, userLocation, z);
    if (this.spider) this.drawSpider(ctx, z, selectedId);
  }

  drawMarker(ctx, marker, active, z) {
    const sprite = this.getSprite(marker.restaurant.priceRange, active, z);
    ctx.drawImage(sprite.canvas, marker.x - sprite.size / 2, marker.y - sprite.size / 2, sprite.size, sprite.size);
  }

  getSprite(priceRange, active, z) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const normalizedPrice = priceRange || 'none';
    const detail = markerDetail(z, active);
    const key = `${normalizedPrice}-${active ? 'active' : detail.key}-${dpr}`;
    const cached = this.spriteCache.get(key);
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
    this.spriteCache.set(key, sprite);
    return sprite;
  }

  drawUserLocation(ctx, location, z) {
    if (!location || !hasCoordinates(location) || !this.map) return;
    const point = this.map.project([location.lon, location.lat]);
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

  // ---- Spiderfy ---------------------------------------------------------------

  /**
   * The stack = restaurants within SPIDER_STACK_RADIUS_M metres of the seed (i.e.
   * genuinely at the same spot), NOT everything that visually overlaps at the
   * current zoom. This keeps fans small (~a handful) even when tapping a dense
   * neighbourhood at low zoom, instead of chaining a whole area into one huge fan.
   */
  buildCluster(seed) {
    const { restaurants } = this.read();
    const pool = this.lastVisible.length ? this.lastVisible : restaurants;
    const set = [];
    for (const restaurant of pool) {
      if (metersBetween(seed, restaurant) <= SPIDER_STACK_RADIUS_M) set.push(restaurant);
    }
    if (!set.some((r) => r.id === seed.id)) set.push(seed);
    // Deterministic slot order: priced first, then nearest the seed, then id.
    set.sort((a, b) => {
      const priority = markerPriority(b) - markerPriority(a);
      if (priority) return priority;
      const distance = metersBetween(seed, a) - metersBetween(seed, b);
      if (Math.abs(distance) > 0.5) return distance;
      return String(a.id).localeCompare(String(b.id));
    });
    if (set.length > SPIDER_MAX) set.length = SPIDER_MAX;
    return set;
  }

  /**
   * Keep the fan in sync with the current selection. An OPEN fan is STATIC: if it
   * already contains the selected restaurant, it is left completely untouched
   * (selecting another leg only moves the highlight — never re-anchors/rebuilds).
   * A fan only (re)builds when a restaurant OUTSIDE the current fan is selected,
   * and collapses when nothing stacked/close-zoom is selected.
   */
  syncSpider(selected) {
    if (!this.map) return;
    if (!selected || this.map.getZoom() < SPIDERFY_MIN_ZOOM) {
      this.collapseSpider();
      return;
    }
    if (this.spider && this.spider.members.some((m) => m.restaurant.id === selected.id)) return;
    const cluster = this.buildCluster(selected);
    if (cluster.length <= 1) {
      this.collapseSpider();
      return;
    }
    this.openSpider(cluster);
  }

  openSpider(cluster) {
    const origin = this.map.project([cluster[0].lon, cluster[0].lat]); // true coord, no offset
    const slots = fanSlots(cluster.length);
    // Store offsets from the origin (not absolute px) so the fan follows the map.
    const members = cluster.map((restaurant, i) => ({ restaurant, dx: slots[i].dx, dy: slots[i].dy }));
    this.applyEdgeCorrection(members, origin);

    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    this.spider = {
      members,
      anchorLngLat: [cluster[0].lon, cluster[0].lat],
      start: typeof performance !== 'undefined' ? performance.now() : 0,
      dur: reduce ? 0 : SPIDER_MS,
      phase: reduce ? 'open' : 'expanding'
    };
    this.spiderTick();
  }

  /** Nudge the whole constellation inward if any slot lands under an edge/topbar. */
  applyEdgeCorrection(members, origin) {
    const width = this.host?.clientWidth || 0;
    const height = this.host?.clientHeight || 0;
    if (!width || !height) return;
    const margin = FULL_RADIUS + SPIDER_EDGE_PAD;
    const padTop = margin + 56; // clear the top bar / search
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const m of members) {
      const x = origin.x + m.dx;
      const y = origin.y + m.dy;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    let dx = 0;
    let dy = 0;
    if (minX - margin < 0) dx = margin - minX;
    else if (maxX + margin > width) dx = width - margin - maxX;
    if (minY - padTop < 0) dy = padTop - minY;
    else if (maxY + margin > height) dy = height - margin - maxY;
    if (dx || dy) for (const m of members) {
      m.dx += dx;
      m.dy += dy;
    }
  }

  spiderTick() {
    this.spiderFrame = 0;
    this.draw();
    const spider = this.spider;
    if (!spider || spider.phase === 'open') return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const progress = (now - spider.start) / Math.max(1, spider.dur);
    if (progress >= 1) {
      spider.phase = 'open';
      this.draw();
      return;
    }
    if (typeof requestAnimationFrame !== 'undefined') {
      this.spiderFrame = requestAnimationFrame(() => this.spiderTick());
    }
  }

  drawSpider(ctx, z, selectedId) {
    const spider = this.spider;
    if (!spider || !this.map) return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const progress = clamp((now - spider.start) / Math.max(1, spider.dur), 0, 1);
    const origin = this.map.project(spider.anchorLngLat);
    const n = spider.members.length;
    // Scale the per-member stagger down for large fans so the last still finishes.
    const stagger = Math.min(SPIDER_STAGGER, 0.4 / Math.max(1, n - 1));
    const denom = Math.max(0.2, 1 - (n - 1) * stagger);

    const placed = spider.members.map((m, i) => {
      const raw = clamp((progress - i * stagger) / denom, 0, 1);
      const ease = easeOutCubic(raw);
      return {
        member: m,
        ease,
        cx: origin.x + m.dx * ease,
        cy: origin.y + m.dy * ease
      };
    });

    // Legs first (under the dots).
    ctx.save();
    ctx.lineCap = 'round';
    for (const p of placed) {
      ctx.globalAlpha = p.ease;
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(p.cx, p.cy);
      ctx.strokeStyle = 'rgba(27, 31, 28, 0.30)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(p.cx, p.cy);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();

    // Origin hub.
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(27, 31, 28, 0.5)';
    ctx.fill();

    // Non-selected dots at an intermediate opacity (between the map's 0.42 and the
    // opaque selected marker); the selected member drawn last, opaque, on top.
    const detailZoom = Math.max(z, FULL_MARKER_ZOOM);
    let selectedPlacement = null;
    ctx.save();
    for (const p of placed) {
      if (p.member.restaurant.id === selectedId) {
        selectedPlacement = p;
        continue;
      }
      ctx.globalAlpha = SPIDER_MEMBER_OPACITY * p.ease;
      const sprite = this.getSprite(p.member.restaurant.priceRange, false, detailZoom);
      ctx.drawImage(sprite.canvas, p.cx - sprite.size / 2, p.cy - sprite.size / 2, sprite.size, sprite.size);
    }
    ctx.restore();
    if (selectedPlacement) {
      const sprite = this.getSprite(selectedPlacement.member.restaurant.priceRange, true, detailZoom);
      ctx.drawImage(
        sprite.canvas,
        selectedPlacement.cx - sprite.size / 2,
        selectedPlacement.cy - sprite.size / 2,
        sprite.size,
        sprite.size
      );
    }
  }

  /** Nearest fanned member under a point (or null). Follows the map via the origin. */
  hitSpider(point, touch = false) {
    if (!this.spider || !this.map) return null;
    const origin = this.map.project(this.spider.anchorLngLat);
    const extra = touch ? TOUCH_HIT_EXTRA : HIT_EXTRA;
    let best = null;
    let bestDistance = Infinity;
    for (const m of this.spider.members) {
      const x = origin.x + m.dx;
      const y = origin.y + m.dy;
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= FULL_RADIUS + extra && distance < bestDistance) {
        bestDistance = distance;
        best = m.restaurant;
      }
    }
    return best;
  }

  // ---- Interaction ------------------------------------------------------------

  /**
   * Non-mutating: the restaurant under a point (or null). Spider-aware so the
   * cursor tracks fanned targets; never opens/closes the fan. Used for hover.
   */
  hitTest(point, touch = false) {
    if (!this.map) return null;
    if (this.spider) return this.hitSpider(point, touch);
    const { restaurants, selectedId } = this.read();
    const extra = touch ? TOUCH_HIT_EXTRA : HIT_EXTRA;
    const candidates = candidatesAt(this.map, restaurants, selectedId, point, extra);
    return candidates.length ? candidates[0].restaurant : null;
  }

  /**
   * Resolve a tap/click into a selection. Returns:
   *  - { type: 'select', restaurant }  → open its details (the fan, if any, is
   *      opened/closed by syncSpider() reacting to the new selection)
   *  - { type: 'lines' }               → show the rail/tube lines popup
   *
   * No camera moves and no clustering happen here — clicking never zooms, and a
   * far-zoom tap just selects the nearest marker.
   */
  activate(point, { touch = false } = {}) {
    if (!this.map) return null;
    const extra = touch ? TOUCH_HIT_EXTRA : HIT_EXTRA;

    // An open fan owns taps that land on its legs.
    if (this.spider) {
      const hit = this.hitSpider(point, touch);
      if (hit) return { type: 'select', restaurant: hit };
    }

    const { restaurants, selectedId } = this.read();
    const candidates = candidatesAt(this.map, restaurants, selectedId, point, extra);
    if (!candidates.length) return { type: 'lines' };
    return { type: 'select', restaurant: candidates[0].restaurant };
  }
}
