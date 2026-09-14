import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { config, type FlightSpec, type Waypoint } from './config';
import { createViewer } from './viewer';
import { buildPath, setCameraToFrame, type FlightPath } from './path';
import { createEnvironment } from './environment';
import { createFlightMap, type PointKind } from './map';
import { recordFlight, type RecordProgress } from './recorder';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const startBtn = $<HTMLButtonElement>('startBtn');
const statusEl = $<HTMLDivElement>('status');
const progressBar = $<HTMLDivElement>('progressBar');
const progressFill = $<HTMLDivElement>('progressFill');
const viewportEl = $<HTMLDivElement>('viewport');
const container = $<HTMLDivElement>('cesiumContainer');
const mapEl = $<HTMLDivElement>('map');
const pickHint = $<HTMLDivElement>('pickHint');
const pathSummary = $<HTMLDivElement>('pathSummary');
const frameSlider = $<HTMLInputElement>('frameSlider');
const frameLabel = $<HTMLSpanElement>('frameLabel');
const fitBtn = $<HTMLButtonElement>('fitBtn');
const speedInput = $<HTMLInputElement>('speed');
const pointInputs: Record<PointKind, { lat: HTMLInputElement; lon: HTMLInputElement; height: HTMLInputElement }> = {
  start: { lat: $('startLat'), lon: $('startLon'), height: $('startHeight') },
  end: { lat: $('endLat'), lon: $('endLon'), height: $('endHeight') },
};
const pickButtons: Record<PointKind, HTMLButtonElement> = {
  start: $('pickStart'),
  end: $('pickEnd'),
};
const editableControls = [
  ...Object.values(pointInputs).flatMap((p) => [p.lat, p.lon, p.height]),
  ...Object.values(pickButtons),
  speedInput,
  frameSlider,
  fitBtn,
];

function setStatus(text: string): void {
  statusEl.textContent = text;
}

/** Lay the container out at exact video resolution, CSS-scaled to fit the viewport. */
function fitViewport(): void {
  const { width, height } = config.video;
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  const scale = Math.min(viewportEl.clientWidth / width, viewportEl.clientHeight / height);
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

function formatWaypoint(w: Waypoint): string {
  return `${w.lat.toFixed(5)}, ${w.lon.toFixed(5)} @ ${w.height} m`;
}

/** Parses a number input, or null when empty/invalid/out of range. */
function readNumber(input: HTMLInputElement, min: number, max: number): number | null {
  const v = Number(input.value);
  if (input.value.trim() === '' || !Number.isFinite(v) || v < min || v > max) return null;
  return v;
}

/** Reads the flight from the form; null (with the offending field flagged) if invalid. */
function readSpecFromInputs(): FlightSpec | null {
  let ok = true;
  const read = (input: HTMLInputElement, min: number, max: number): number => {
    const v = readNumber(input, min, max);
    input.classList.toggle('invalid', v === null);
    if (v === null) ok = false;
    return v ?? 0;
  };
  const readPoint = (kind: PointKind): Waypoint => ({
    lat: read(pointInputs[kind].lat, -90, 90),
    lon: read(pointInputs[kind].lon, -180, 180),
    height: read(pointInputs[kind].height, -1000, 100_000),
  });
  const spec: FlightSpec = { start: readPoint('start'), end: readPoint('end'), speed: read(speedInput, 0.1, 10_000) };
  return ok ? spec : null;
}

function writeSpecToInputs(spec: FlightSpec): void {
  for (const kind of ['start', 'end'] as const) {
    pointInputs[kind].lat.value = spec[kind].lat.toFixed(5);
    pointInputs[kind].lon.value = spec[kind].lon.toFixed(5);
    pointInputs[kind].height.value = String(spec[kind].height);
    pointInputs[kind].lat.classList.remove('invalid');
    pointInputs[kind].lon.classList.remove('invalid');
    pointInputs[kind].height.classList.remove('invalid');
  }
  speedInput.value = String(spec.speed);
  speedInput.classList.remove('invalid');
}

async function main(): Promise<void> {
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
  if (!token) {
    setStatus('Missing Cesium ion token.\nCreate .env.local with:\nVITE_CESIUM_ION_TOKEN=<your token>');
    return;
  }
  Cesium.Ion.defaultAccessToken = token;

  fitViewport();
  window.addEventListener('resize', fitViewport);

  // ---- Flight state ------------------------------------------------------
  const spec: FlightSpec = structuredClone(config.defaultFlight);
  let path: FlightPath | null = null;
  let recording = false;
  let armed: PointKind | null = null;

  writeSpecToInputs(spec);

  // ---- Map for picking points --------------------------------------------
  const map = createFlightMap(mapEl, {
    onPick(kind, lat, lon) {
      spec[kind].lat = lat;
      spec[kind].lon = lon;
      writeSpecToInputs(spec);
      map.setPoints(spec.start, spec.end);
      scheduleRebuild();
      // Natural flow: place the start, then the end, then stop picking.
      setArmed(kind === 'start' ? 'end' : null);
    },
  });
  map.setPoints(spec.start, spec.end);
  map.fitTo(spec.start, spec.end);

  function setArmed(kind: PointKind | null): void {
    armed = kind;
    map.setArmed(kind);
    for (const k of ['start', 'end'] as const) pickButtons[k].classList.toggle('armed', k === kind);
    pickHint.textContent =
      kind === 'start'
        ? 'Click the map to place the START point.'
        : kind === 'end'
          ? 'Click the map to place the END point (the camera looks at it).'
          : 'Use “Pick on map” or type coordinates, then start recording.';
  }
  setArmed('start');

  for (const kind of ['start', 'end'] as const) {
    pickButtons[kind].addEventListener('click', () => setArmed(armed === kind ? null : kind));
  }
  fitBtn.addEventListener('click', () => map.fitTo(spec.start, spec.end));

  // ---- Recording viewer --------------------------------------------------
  setStatus('Loading terrain & imagery…');
  const viewer = await createViewer(container, config);
  const environment = createEnvironment(viewer, config);

  // Idle render loop for previewing; paused while recording.
  const idleLoop = () => {
    if (!recording) viewer.render();
    requestAnimationFrame(idleLoop);
  };
  idleLoop();

  // Debugging access from the browser console.
  Object.assign(window, { viewer, Cesium });

  // ---- Path (re)building -------------------------------------------------
  let rebuildTimer: number | undefined;
  let rebuildGeneration = 0;

  function scheduleRebuild(): void {
    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => void rebuildPath(), 250);
  }

  async function rebuildPath(): Promise<void> {
    const generation = ++rebuildGeneration;
    startBtn.disabled = true;
    setStatus('Sampling terrain…');
    try {
      const built = await buildPath(viewer.terrainProvider, spec, config.video.fps);
      if (generation !== rebuildGeneration) return; // superseded by a newer edit
      path = built;
      Object.assign(window, { path });

      environment.update(path);

      frameSlider.max = String(path.frameCount - 1);
      frameSlider.value = '0';
      showFrame(0);

      pathSummary.textContent =
        `Start: ${formatWaypoint(spec.start)} (ground ${path.startGroundHeight.toFixed(0)} m)\n` +
        `End:   ${formatWaypoint(spec.end)} (ground ${path.endGroundHeight.toFixed(0)} m)\n` +
        `Path: ${path.length.toFixed(0)} m at ${spec.speed} m/s → ${path.duration.toFixed(1)} s video\n` +
        `${path.frameCount} frames @ ${config.video.fps} fps, ${config.video.width}x${config.video.height}`;
      setStatus('Ready.');
      startBtn.disabled = recording;
    } catch (err) {
      if (generation !== rebuildGeneration) return;
      path = null;
      pathSummary.textContent = '';
      setStatus(`Invalid flight:\n${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function showFrame(frame: number): void {
    if (!path) return;
    setCameraToFrame(viewer.scene.camera, path, frame);
    const t = (frame / (path.frameCount - 1)) * path.duration;
    frameLabel.textContent = `frame ${frame} / ${path.frameCount - 1} (${t.toFixed(1)} s)`;
  }

  frameSlider.addEventListener('input', () => showFrame(Number(frameSlider.value)));

  const onInputsChanged = () => {
    const next = readSpecFromInputs();
    if (!next) {
      setStatus('Fix the highlighted fields.');
      startBtn.disabled = true;
      return;
    }
    Object.assign(spec, next);
    map.setPoints(spec.start, spec.end);
    scheduleRebuild();
  };
  for (const input of [...Object.values(pointInputs).flatMap((p) => [p.lat, p.lon, p.height]), speedInput]) {
    input.addEventListener('input', onInputsChanged);
  }

  await rebuildPath();

  // ---- Recording ---------------------------------------------------------
  function setEditingEnabled(enabled: boolean): void {
    for (const el of editableControls) (el as HTMLInputElement | HTMLButtonElement).disabled = !enabled;
    map.setEnabled(enabled);
  }

  startBtn.addEventListener('click', async () => {
    if (!path) return;
    const flight = path;
    startBtn.disabled = true;
    recording = true;
    setArmed(null);
    setEditingEnabled(false);
    progressBar.classList.add('active');
    try {
      const blob = await recordFlight(viewer, flight, config, (p: RecordProgress) => {
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
      setEditingEnabled(true);
      startBtn.disabled = path === null;
      // Return the preview to the frame the slider shows.
      showFrame(Number(frameSlider.value));
    }
  });
}

main().catch((err) => {
  console.error(err);
  setStatus(`Startup failed:\n${err instanceof Error ? err.message : String(err)}`);
});
