import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

export default defineConfig({
  site: 'https://felixplace.com',
  adapter: netlify({
    imageCDN: false,
    devFeatures: {
      images: false,
      edgeFunctions: false,
    },
  }),
});