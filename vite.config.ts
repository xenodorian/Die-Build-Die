import { defineConfig } from 'vite';

// GitHub Pages serves the site from https://<user>.github.io/Die-Build-Die/
// Override with BASE_PATH=/ for other hosts.
export default defineConfig(({ command }) => ({
  base: process.env.BASE_PATH ?? (command === 'build' ? '/Die-Build-Die/' : '/'),
}));
