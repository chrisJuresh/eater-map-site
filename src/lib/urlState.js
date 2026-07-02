// URL deep-link state: ?r=<restaurant id> selects a restaurant, and
// #<zoom>/<lat>/<lon> restores the camera. Both are written with replaceState
// (no history spam) and both work offline.

export function parseUrlState(url) {
  const out = { restaurantId: null, view: null };
  try {
    const u = typeof url === 'string' ? new URL(url) : url;
    const r = u.searchParams.get('r');
    if (r) out.restaurantId = r;
    const m = /^#(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(u.hash || '');
    if (m) {
      const [zoom, lat, lon] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if ([zoom, lat, lon].every(Number.isFinite)) out.view = { zoom, lat, lon };
    }
  } catch {
    // malformed URL — ignore
  }
  return out;
}

export function serializeView(zoom, lat, lon) {
  return `#${zoom.toFixed(2)}/${lat.toFixed(5)}/${lon.toFixed(5)}`;
}

/** Build the href to write back, preserving whichever parts are set. */
export function buildAppUrl({ pathname = '/', restaurantId = null, viewHash = '' }) {
  const search = restaurantId ? `?r=${encodeURIComponent(restaurantId)}` : '';
  return `${pathname}${search}${viewHash}`;
}
