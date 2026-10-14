import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

export default defineConfig({
  adapter: netlify({
    imageCDN: false,
    devFeatures: {
      images: false,
      edgeFunctions: false,
    },
  }),
});