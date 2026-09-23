// Canvas marker overlay + spiderfy.
// - every marker opaque and white-ringed, drawn north to south so each ring cuts
//   the dot behind it (a pile reads as scales, not a darker blot)
// - the priced ("38 Best London") markers ON TOP of the regular ones
// - the selected marker drawn above everything at full detail
// - offscreen sprite cache keyed by price/detail/DPR
// - tapping a stack fans it out (spiderfy) into spaced, thumb-tappable targets

import {
  FULL_MARKER_ZOOM,
  MARKER_PADDING,
  MARKER_SPRITE_PADDING,
  MID_MARKER_ZOOM,
  SPIDER_EDGE_PAD,
  SPIDER_GAP,
  SPIDER_MAX,
  SPIDER_MEMBER_OPACITY,
  SPIDER_MIN_R,
  SPIDER_MS,
  SPIDER_OVERLAP_PX,
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
const FULL_RADIUS = 10;

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

// `shadow` is null for the smallest dots: at that size it only muddies the edge.
function markerDetail(z, active) {
  if (active) {
    return { key: 'active', radius: 15, strokeWidth: 3, shadow: { blur: 12, y: 4, alpha: 0.34 }, showPrice: true };
  }
  if (z >= FULL_MARKER_ZOOM) {
    return { key: 'full', radius: 10, strokeWidth: 2, shadow: { blur: 6, y: 2, alpha: 0.22 }, showPrice: true };
  }
  if (z >= MID_MARKER_ZOOM) {
    return { key: 'mid', radius: 6, strokeWidth: 1.5, shadow: { blur: 2, y: 1, alpha: 0.18 }, showPrice: false };
  }
  return { key: 'small', radius: 3.6, strokeWidth: 1, shadow: null, showPrice: false };
}

function metersPerPixel(lat, z) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
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
    // North first, so each dot overlaps the one behind it (up the screen) the
    // same way: a consistent scale pattern instead of arbitrary stacking.
    markers.sort((a, b) => a.y - b.y);

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

    for (const marker of regularMarkers) this.drawMarker(ctx, marker, false, z);
    for (const marker of pricedMarkers) this.drawMarker(ctx, marker, false, z);

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
    const key = `${normalizedPrice}-${detail.key}-${dpr}`;
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
    if (detail.shadow) {
      ctx.shadowColor = `rgba(20, 24, 30, ${detail.shadow.alpha})`;
      ctx.shadowBlur = detail.shadow.blur;
      ctx.shadowOffsetY = detail.shadow.y;
    }
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = markerColor(priceRange);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = detail.strokeWidth;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    if (priceRange && detail.showPrice) {
      ctx.fillStyle = '#ffffff';
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

  /** Screen position of a marker as drawn (base projection + ring offset). */
  originPx(restaurant) {
    const p = this.map.project([restaurant.lon, restaurant.lat]);
    return { x: p.x + restaurant.offsetX, y: p.y + restaurant.offsetY };
  }

  /**
   * The stack = markers whose drawn centres OVERLAP the seed on screen (within
   * SPIDER_OVERLAP_PX), gathered non-transitively from the seed so a dense area
   * never chains into one giant fan. Screen-space, so once you zoom in enough
   * that markers separate, nothing overlaps and no fan opens. When more than
   * SPIDER_MAX overlap, only the closest to the seed qualify.
   */
  buildCluster(seed) {
    const { restaurants } = this.read();
    const pool = this.lastVisible.length ? this.lastVisible : restaurants;
    const seedPx = this.originPx(seed);
    const near = [];
    for (const restaurant of pool) {
      const px = this.originPx(restaurant);
      const distance = Math.hypot(px.x - seedPx.x, px.y - seedPx.y);
      if (distance <= SPIDER_OVERLAP_PX) near.push({ restaurant, distance });
    }
    if (!near.some((n) => n.restaurant.id === seed.id)) near.push({ restaurant: seed, distance: 0 });
    // Closest to the seed qualify (cap), then a stable priced-first slot order.
    near.sort((a, b) => {
      if (Math.abs(a.distance - b.distance) > 0.5) return a.distance - b.distance;
      return (
        markerPriority(b.restaurant) - markerPriority(a.restaurant) ||
        String(a.restaurant.id).localeCompare(String(b.restaurant.id))
      );
    });
    return near.slice(0, SPIDER_MAX).map((n) => n.restaurant);
  }

  /**
   * Keep the fan in sync with the current selection. An OPEN fan is STATIC against
   * SELECTION changes: if it already contains the selected restaurant, its member
   * set is not rebuilt from a new seed (selecting another leg only moves the
   * highlight — never re-anchors). It is NOT static against ZOOM: because this runs
   * on moveend, an open fan is re-evaluated against the current zoom and legs that
   * have separated from the anchor are pruned (see pruneSpider). A fan only
   * (re)builds when a restaurant OUTSIDE the current fan is selected, and collapses
   * when nothing stacked/close-zoom is selected.
   */
  syncSpider(selected) {
    if (!this.map) return;
    if (!selected || this.map.getZoom() < SPIDERFY_MIN_ZOOM) {
      this.collapseSpider();
      return;
    }
    if (this.spider && this.spider.members.some((m) => m.restaurant.id === selected.id)) {
      this.pruneSpider(selected); // static set, but zooming in still drops legs that separated
      return;
    }
    const cluster = this.buildCluster(selected);
    if (cluster.length <= 1) {
      this.collapseSpider();
      return;
    }
    this.openSpider(cluster);
  }

  /**
   * Re-evaluate an OPEN fan against the CURRENT zoom/filter and drop members that
   * no longer belong: legs that have separated from the anchor on screen (they
   * would no longer be stacked if there were no fan), and members a filter change
   * has removed from the dataset. Zooming in spreads markers apart so this shrinks
   * the fan; zooming out only brings members closer, so it never removes any on
   * zoom-out and never re-adds pruned ones (the set only contracts until a new seed
   * rebuilds it). Two members are always kept so the fan stays coherent: the anchor
   * (members[0], the geometric reference) and the currently selected leg (so its
   * highlight never detaches from the fan, and the membership check in syncSpider
   * keeps routing here instead of thrashing into a rebuild). ≤1 survivor collapses
   * the fan; survivors are re-laid onto a tighter even ring, snapped fully open in
   * place (no re-bloom), following the map.
   */
  pruneSpider(selected) {
    const spider = this.spider;
    if (!spider || !this.map) return;
    const selectedId = selected?.id;
    const visibleIds = new Set(this.read().restaurants.map((r) => r.id)); // the current filtered set
    // The anchor is the fan's geometric origin; if a filter removed it there is no
    // valid reference left, so tear the fan down (a later selection rebuilds cleanly).
    // Checked before the survivor pass so the anchor is never a lingering filtered-out leg.
    if (!visibleIds.has(spider.members[0].restaurant.id)) {
      this.collapseSpider();
      return;
    }
    const anchorPx = this.originPx(spider.members[0].restaurant);
    const survivors = spider.members.filter((m, i) => {
      if (i === 0 || m.restaurant.id === selectedId) return true; // anchor (checked above) + highlighted leg: kept
      if (!visibleIds.has(m.restaurant.id)) return false; // removed by a filter change
      const px = this.originPx(m.restaurant);
      return Math.hypot(px.x - anchorPx.x, px.y - anchorPx.y) <= SPIDER_OVERLAP_PX;
    });
    if (survivors.length === spider.members.length) return; // nothing changed — leave it be
    if (survivors.length <= 1) {
      this.collapseSpider();
      return;
    }
    const origin = this.map.project(spider.anchorLngLat);
    const slots = fanSlots(survivors.length);
    survivors.forEach((m, i) => {
      m.dx = slots[i].dx;
      m.dy = slots[i].dy;
    });
    spider.members = survivors;
    this.applyEdgeCorrection(spider.members, origin);
    if (this.spiderFrame) cancelAnimationFrame(this.spiderFrame); // drop any in-flight bloom tick
    this.spiderFrame = 0;
    spider.phase = 'open'; // snap the tighter ring fully open in place rather than re-blooming
    this.schedule();
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
    // 'open' means fully expanded regardless of the (possibly stale) start time —
    // so a pruned fan snapped open in place never renders at a partial radius.
    const progress = spider.phase === 'open' ? 1 : clamp((now - spider.start) / Math.max(1, spider.dur), 0, 1);
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

    // Non-selected dots slightly faded so the opaque selected member, drawn last
    // on top, stands out.
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
