import { defineConfig } from 'vite';

// Cesium's static assets are exposed via a symlink: public/cesium ->
// node_modules/cesium/Build/Cesium. Vite serves public/ as-is in dev and
// copies it into dist/ on build; CESIUM_BASE_URL tells Cesium where they live.
export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
});
