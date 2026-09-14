import * as Cesium from 'cesium';
import type { Config } from './config';
import { setCameraToFrame, type FlightPath } from './path';
import { Mp4Encoder } from './encoder';

export interface RecordProgress {
  frame: number;
  frameCount: number;
  phase: 'warm-up' | 'recording' | 'encoding';
  etaSeconds: number | null;
}

/**
 * Renders the flight deterministically, one frame at a time. The camera is
 * advanced by frame index (simulated time), and each frame is captured only
 * after every terrain/imagery tile has finished loading — so the video has
 * constant speed and no tile popping, regardless of load times.
 */
export async function recordFlight(
  viewer: Cesium.Viewer,
  path: FlightPath,
  config: Config,
  onProgress: (p: RecordProgress) => void,
): Promise<Blob> {
  const canvas = viewer.scene.canvas;
  if (canvas.width !== config.video.width || canvas.height !== config.video.height) {
    throw new Error(
      `Canvas is ${canvas.width}x${canvas.height}, expected ${config.video.width}x${config.video.height}. ` +
        'The GPU/browser may not support a render buffer this large.',
    );
  }

  const encoder = await Mp4Encoder.create(canvas, config);
  try {
    // Warm-up: load the start view fully so frame 0 is as sharp as the rest.
    onProgress({ frame: 0, frameCount: path.frameCount, phase: 'warm-up', etaSeconds: null });
    setCameraToFrame(viewer.scene.camera, path, 0);
    await renderUntilLoaded(viewer, config.tileLoadTimeoutMs);

    const startedAt = performance.now();
    for (let frame = 0; frame < path.frameCount; frame++) {
      setCameraToFrame(viewer.scene.camera, path, frame);
      await renderUntilLoaded(viewer, config.tileLoadTimeoutMs);
      await encoder.addFrame(frame);

      const elapsed = (performance.now() - startedAt) / 1000;
      const etaSeconds = frame > 0 ? (elapsed / (frame + 1)) * (path.frameCount - frame - 1) : null;
      onProgress({ frame: frame + 1, frameCount: path.frameCount, phase: 'recording', etaSeconds });
    }

    onProgress({ frame: path.frameCount, frameCount: path.frameCount, phase: 'encoding', etaSeconds: null });
    return await encoder.finalize();
  } catch (err) {
    await encoder.cancel().catch(() => {});
    throw err;
  }
}

/**
 * Renders repeatedly until the globe reports all tiles loaded for several
 * consecutive renders (imagery can lag terrain by a beat), or the timeout hits.
 */
async function renderUntilLoaded(viewer: Cesium.Viewer, timeoutMs: number): Promise<void> {
  const scene = viewer.scene;
  const deadline = performance.now() + timeoutMs;
  const REQUIRED_SETTLED_RENDERS = 3;
  let settled = 0;

  while (settled < REQUIRED_SETTLED_RENDERS) {
    viewer.render();
    if (scene.globe.tilesLoaded) {
      settled++;
    } else {
      settled = 0;
      if (performance.now() > deadline) {
        console.warn('Tile load timeout — capturing frame with whatever has loaded.');
        break;
      }
    }
    // Yield so network requests and decodes can progress.
    await nextFrame();
  }
  // One final clean render right before capture.
  viewer.render();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
