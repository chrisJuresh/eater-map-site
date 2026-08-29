// The Card export harness — never prerendered, so the production build emits no
// /export page and Vercel has nothing to serve. The page itself is gated on
// import.meta.env.DEV, so even the SPA fallback route renders only a stub, and
// the collector it drives is behind a dynamic import inside that gate so the
// production bundle does not carry it either. Same shape as /tune.
export const prerender = false;
