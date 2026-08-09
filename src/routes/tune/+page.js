// Local tuning harness — never prerendered, so the production build emits no
// /tune page and Vercel has nothing to serve. The page itself is gated on
// import.meta.env.DEV, so even the SPA fallback route renders only a stub.
export const prerender = false;
