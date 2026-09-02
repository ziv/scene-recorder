import * as Cesium from 'cesium';
import type { Config } from './config';

/**
 * Creates a Cesium Viewer tuned for maximum visual quality and deterministic
 * offline rendering. The container is laid out at the exact video resolution
 * (CSS-scaled to fit the window), so the WebGL drawing buffer matches the
 * output video pixel-for-pixel.
 */
export async function createViewer(container: HTMLElement, config: Config): Promise<Cesium.Viewer> {
  const terrainProvider = await Cesium.createWorldTerrainAsync({
    requestVertexNormals: true,
  });

  const viewer = new Cesium.Viewer(container, {
    terrainProvider,
    // Cesium ion world imagery, AERIAL style (the default).
    baseLayer: Cesium.ImageryLayer.fromWorldImagery({}),
    // The recorder drives every render explicitly.
    useDefaultRenderLoop: false,
    // Render in CSS pixels so the drawing buffer is exactly the container
    // size (no devicePixelRatio multiplication on retina displays).
    useBrowserRecommendedResolution: true,
    msaaSamples: config.quality.msaaSamples,
    contextOptions: {
      webgl: {
        // Keep the frame buffer readable after render, for canvas capture.
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      },
    },
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    creditContainer: document.createElement('div'),
  });

  const scene = viewer.scene;
  scene.globe.maximumScreenSpaceError = config.quality.maximumScreenSpaceError;
  scene.globe.tileCacheSize = config.quality.tileCacheSize;
  scene.globe.enableLighting = false;
  scene.fog.enabled = false;
  scene.postProcessStages.fxaa.enabled = true;
  viewer.resolutionScale = 1.0;

  // Fixed simulation time so lighting is identical in every frame.
  viewer.clock.currentTime = Cesium.JulianDate.fromIso8601('2026-06-21T10:00:00Z');
  viewer.clock.shouldAnimate = false;

  return viewer;
}
