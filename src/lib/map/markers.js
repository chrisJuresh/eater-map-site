// Canvas marker overlay. Ported verbatim from the tuned implementation:
// - regular markers composited at a FLAT 0.42 opacity (overlaps must not darken)
// - the priced ("38 Best London") markers composited fully opaque, ON TOP
// - the selected marker drawn above everything at full detail
// - offscreen sprite cache keyed by price/detail/DPR
// - hit-testing with click-cycling through overlapping markers

import {
  FULL_MARKER_ZOOM,
  MARKER_LAYER_OPACITY,
  MARKER_PADDING,
  MARKER_SPRITE_PADDING,
  MID_MARKER_ZOOM,
  PRICED_MARKER_LAYER_OPACITY,
  clamp,
  hasCoordinates,
  markerColor
} from '../constants.js';

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

function metersPerPixel(lat, z) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
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
    this.lastPick = null;
    this.lastVisible = [];
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
    this.frame = 0;
    this.map = null;
  }

  clearPick() {
    this.lastPick = null;
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

  /**
   * Hit-test a screen point. Repeated clicks in (roughly) the same spot cycle
   * through overlapping markers; priced markers win ties within 4px.
   */
  pick(point) {
    const { map } = this;
    if (!map) return null;
    const { restaurants, selectedId } = this.read();
    const candidates = [];
    for (const restaurant of restaurants) {
      const projected = map.project([restaurant.lon, restaurant.lat]);
      const x = projected.x + restaurant.offsetX;
      const y = projected.y + restaurant.offsetY;
      const distance = Math.hypot(point.x - x, point.y - y);
      const radius = restaurant.id === selectedId ? 17 : 13;
      if (distance <= radius + 8) candidates.push({ restaurant, distance });
    }
    if (!candidates.length) {
      this.lastPick = null;
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
      this.lastPick && this.lastPick.key === key && Math.abs(this.lastPick.x - point.x) <= 18 && Math.abs(this.lastPick.y - point.y) <= 18;
    const index = repeatedPick ? (this.lastPick.index + 1) % candidates.length : 0;
    this.lastPick = { key, index, x: point.x, y: point.y };
    return candidates[index].restaurant;
  }
}
