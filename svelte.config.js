import adapter from '@sveltejs/adapter-static';

const config = {
  kit: {
    adapter: adapter({
      fallback: 'index.html'
    }),
    serviceWorker: {
      // One lifecycle owner only. SvelteKit's generated registration runs on
      // `load` as a classic script, while src/lib/offline/client.js registers the
      // same URL as a module with an explicit update path — two owners requesting
      // different worker types make browsers treat the second call as an update,
      // so installs repeat and never settle. (Review action A03.)
      register: false
    }
  }
};

export default config;
