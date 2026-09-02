import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { config } from './config';
import { createViewer } from './viewer';
import { buildPath } from './path';
import { recordFlight, type RecordProgress } from './recorder';

const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const progressBar = document.getElementById('progressBar') as HTMLDivElement;
const progressFill = document.getElementById('progressFill') as HTMLDivElement;
const container = document.getElementById('cesiumContainer') as HTMLDivElement;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

/** Lay the container out at exact video resolution, CSS-scaled to fit the window. */
function fitViewport(): void {
  const { width, height } = config.video;
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  const scale = Math.min(window.innerWidth / width, window.innerHeight / height);
  container.style.transform = `scale(${scale})`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatEta(seconds: number | null): string {
  if (seconds === null) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return ` — ETA ${m}:${String(s).padStart(2, '0')}`;
}

async function main(): Promise<void> {
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
  if (!token) {
    setStatus(
      'Missing Cesium ion token.\nCreate .env.local with:\nVITE_CESIUM_ION_TOKEN=<your token>',
    );
    return;
  }
  Cesium.Ion.defaultAccessToken = token;

  fitViewport();
  window.addEventListener('resize', fitViewport);

  setStatus('Loading terrain & imagery…');
  const viewer = await createViewer(container, config);
  const path = await buildPath(viewer.terrainProvider, config);

  // Idle render loop for previewing; paused while recording.
  let recording = false;
  const idleLoop = () => {
    if (!recording) viewer.render();
    requestAnimationFrame(idleLoop);
  };
  // Show the start of the path while idle.
  const startPose = path.poseAt(0);
  viewer.scene.camera.setView({
    destination: startPose.position,
    orientation: { direction: startPose.direction, up: startPose.up },
  });
  idleLoop();

  setStatus(
    `Ready.\nPath: ${path.length.toFixed(0)} m at ${config.speed} m/s → ` +
      `${path.duration.toFixed(1)} s video (${path.frameCount} frames @ ${config.video.fps} fps, ` +
      `${config.video.width}x${config.video.height})`,
  );
  startBtn.disabled = false;

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    recording = true;
    progressBar.classList.add('active');
    try {
      const blob = await recordFlight(viewer, path, config, (p: RecordProgress) => {
        progressFill.style.width = `${(p.frame / p.frameCount) * 100}%`;
        if (p.phase === 'warm-up') {
          setStatus('Warming up: loading tiles for the first frame…');
        } else if (p.phase === 'recording') {
          setStatus(`Recording frame ${p.frame}/${p.frameCount}${formatEta(p.etaSeconds)}`);
        } else {
          setStatus('Finalizing MP4…');
        }
      });
      downloadBlob(blob, 'flight.mp4');
      setStatus(`Done — flight.mp4 downloaded (${(blob.size / 1e6).toFixed(1)} MB).`);
    } catch (err) {
      console.error(err);
      setStatus(`Recording failed:\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      recording = false;
      progressBar.classList.remove('active');
      startBtn.disabled = false;
    }
  });
}

main().catch((err) => {
  console.error(err);
  setStatus(`Startup failed:\n${err instanceof Error ? err.message : String(err)}`);
});
