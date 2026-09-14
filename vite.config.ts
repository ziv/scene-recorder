import { defineConfig } from 'vite';

// The production build is deployed to GitHub Pages as a project site, which is
// served under /<repo>/ rather than the domain root. Dev keeps the root path.
const REPO_NAME = 'scene-recorder';

// Cesium's static assets are exposed via a symlink: public/cesium ->
// node_modules/cesium/Build/Cesium. Vite serves public/ as-is in dev and
// copies it into the output directory on build; CESIUM_BASE_URL tells Cesium
// where they live and must include the base path.
export default defineConfig(({ command }) => {
  const base = command === 'build' ? `/${REPO_NAME}/` : '/';
  return {
    base,
    define: {
      CESIUM_BASE_URL: JSON.stringify(`${base}cesium`),
    },
    build: {
      // GitHub Pages can serve directly from the docs/ folder of the main branch.
      outDir: 'docs',
    },
  };
});
