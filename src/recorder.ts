import * as Cesium from 'cesium';
import type { Config } from './config';
import { setCameraToFrame, type Trajectory } from './scenes';
import { Mp4Encoder } from './encoder';

/** Thrown when a recording is cancelled through its AbortSignal. */
export class RecordingCancelled extends Error {
  constructor() {
    super('Recording cancelled.');
    this.name = 'RecordingCancelled';
  }
}

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
  trajectory: Trajectory,
  config: Config,
  onProgress: (p: RecordProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new RecordingCancelled();
  };

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
    onProgress({ frame: 0, frameCount: trajectory.frameCount, phase: 'warm-up', etaSeconds: null });
    setCameraToFrame(viewer.scene.camera, trajectory, 0);
    await renderUntilLoaded(viewer, config.tileLoadTimeoutMs, signal);
    throwIfCancelled();

    const startedAt = performance.now();
    for (let frame = 0; frame < trajectory.frameCount; frame++) {
      throwIfCancelled();
      setCameraToFrame(viewer.scene.camera, trajectory, frame);
      await renderUntilLoaded(viewer, config.tileLoadTimeoutMs, signal);
      throwIfCancelled();
      await encoder.addFrame(frame);

      const elapsed = (performance.now() - startedAt) / 1000;
      const etaSeconds = frame > 0 ? (elapsed / (frame + 1)) * (trajectory.frameCount - frame - 1) : null;
      onProgress({ frame: frame + 1, frameCount: trajectory.frameCount, phase: 'recording', etaSeconds });
    }

    throwIfCancelled();
    onProgress({ frame: trajectory.frameCount, frameCount: trajectory.frameCount, phase: 'encoding', etaSeconds: null });
    return await encoder.finalize();
  } catch (err) {
    await encoder.cancel().catch(() => {});
    throw err;
  }
}

/**
 * Renders repeatedly until the globe reports all tiles loaded for several
 * consecutive renders (imagery can lag terrain by a beat), or the timeout hits.
 * Returns early when the signal is aborted so cancellation is prompt.
 */
async function renderUntilLoaded(viewer: Cesium.Viewer, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const scene = viewer.scene;
  const deadline = performance.now() + timeoutMs;
  const REQUIRED_SETTLED_RENDERS = 3;
  let settled = 0;

  while (settled < REQUIRED_SETTLED_RENDERS) {
    if (signal?.aborted) return;
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
    await nextFrame(signal);
  }
  // One final clean render right before capture.
  viewer.render();
}

/**
 * Resolves on the next animation frame, or immediately when the signal aborts.
 * Animation frames pause while the tab is hidden, so without the abort path a
 * cancel click made from another tab would only take effect on return.
 */
function nextFrame(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = () => resolve();
    signal?.addEventListener('abort', onAbort, { once: true });
    requestAnimationFrame(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}
