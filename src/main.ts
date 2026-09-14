import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { defaultConfig, type Config } from './config';
import { applyQuality, createViewer } from './viewer';
import { createEnvironment } from './environment';
import { createFlightMap } from './map';
import { renderForm, type FormHandle } from './form';
import { recordFlight, RecordingCancelled, type RecordProgress } from './recorder';
import { applySettings, configToSettings, settingsFields } from './settings';
import {
  getSceneType,
  sceneTypes,
  setCameraToFrame,
  type ParamField,
  type Params,
  type PointField,
  type SceneType,
  type Trajectory,
  type Waypoint,
} from './scenes';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const startBtn = $<HTMLButtonElement>('startBtn');
const cancelBtn = $<HTMLButtonElement>('cancelBtn');
const statusEl = $<HTMLDivElement>('status');
const progressBar = $<HTMLDivElement>('progressBar');
const progressFill = $<HTMLDivElement>('progressFill');
const viewportEl = $<HTMLDivElement>('viewport');
const container = $<HTMLDivElement>('cesiumContainer');
const mapEl = $<HTMLDivElement>('map');
const pickHint = $<HTMLDivElement>('pickHint');
const sceneSelect = $<HTMLSelectElement>('sceneType');
const sceneDescription = $<HTMLDivElement>('sceneDescription');
const paramsForm = $<HTMLDivElement>('paramsForm');
const pathSummary = $<HTMLDivElement>('pathSummary');
const frameSlider = $<HTMLInputElement>('frameSlider');
const frameLabel = $<HTMLSpanElement>('frameLabel');
const fitBtn = $<HTMLButtonElement>('fitBtn');
const resetBtn = $<HTMLButtonElement>('resetBtn');
const settingsForm = $<HTMLDivElement>('settingsForm');
const resetSettingsBtn = $<HTMLButtonElement>('resetSettingsBtn');

const STORAGE_KEY = 'scene-recorder:v2';
/** Points sampled along the trajectory for the map's ground track. */
const TRACK_SAMPLES = 128;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

/** Lay the container out at exact video resolution, CSS-scaled to fit the viewport. */
function fitViewport(config: Config): void {
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

function pointFields(scene: SceneType): PointField[] {
  return scene.fields.filter((f): f is PointField => f.kind === 'point');
}

// ---- Persistence -------------------------------------------------------------
// Remembers the selected scene and each scene's params across reloads.

interface StoredState {
  sceneId: string;
  params: Record<string, Params>;
  /** Flat "Output & quality" settings (see settings.ts). */
  settings?: Params;
}

function loadStoredState(): StoredState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredState) : null;
  } catch {
    return null;
  }
}

function saveStoredState(state: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable; nothing to do.
  }
}

/** Stored params are only trusted if every field is present with the right shape. */
function paramsMatchSchema(fields: ParamField[], params: unknown): params is Params {
  if (typeof params !== 'object' || params === null) return false;
  const p = params as Record<string, unknown>;
  return fields.every((f) => {
    const v = p[f.key];
    if (f.kind === 'point') {
      const w = v as Partial<Waypoint> | undefined;
      return (
        typeof w === 'object' &&
        w !== null &&
        Number.isFinite(w.lat) &&
        Number.isFinite(w.lon) &&
        Number.isFinite(w.height)
      );
    }
    if (f.kind === 'number') return typeof v === 'number' && Number.isFinite(v);
    if (f.kind === 'date') return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    return typeof v === 'string' && f.options.some((o) => o.value === v);
  });
}

// ---- App ---------------------------------------------------------------------

async function main(): Promise<void> {
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
  if (!token) {
    setStatus('Missing Cesium ion token.\nCreate .env.local with:\nVITE_CESIUM_ION_TOKEN=<your token>');
    return;
  }
  Cesium.Ion.defaultAccessToken = token;

  // ---- Config (mutable copy of the defaults, edited in the settings panel) --
  const stored = loadStoredState();
  const config: Config = structuredClone(defaultConfig);
  if (paramsMatchSchema(settingsFields, stored?.settings)) applySettings(stored.settings, config);
  let settings: Params = configToSettings(config);

  fitViewport(config);
  window.addEventListener('resize', () => fitViewport(config));

  // ---- Scene state ---------------------------------------------------------
  const paramsByScene: Record<string, Params> = {};
  for (const scene of sceneTypes) {
    const candidate = stored?.params[scene.id];
    paramsByScene[scene.id] = paramsMatchSchema(scene.fields, candidate) ? candidate : structuredClone(scene.defaults);
  }
  let scene: SceneType = getSceneType(
    stored && sceneTypes.some((s) => s.id === stored.sceneId) ? stored.sceneId : config.defaultScene,
  );
  let params: Params = paramsByScene[scene.id];
  let trajectory: Trajectory | null = null;
  let recording = false;
  let armed: string | null = null;
  let form: FormHandle | null = null;
  /** Fit the map once the next trajectory is built (so the track is included). */
  let fitAfterBuild = true;

  const persist = () => saveStoredState({ sceneId: scene.id, params: paramsByScene, settings });

  // ---- Scene selector ------------------------------------------------------
  for (const s of sceneTypes) {
    const option = document.createElement('option');
    option.value = s.id;
    option.textContent = s.name;
    sceneSelect.append(option);
  }
  sceneSelect.value = scene.id;

  // ---- Map -----------------------------------------------------------------
  const map = createFlightMap(mapEl, {
    onPick(key, lat, lon) {
      const point = params[key] as Waypoint;
      point.lat = lat;
      point.lon = lon;
      form?.refresh();
      syncMarkers();
      scheduleRebuild();
      // Natural flow: arm the next point in the scene, then stop picking.
      const keys = pointFields(scene).map((f) => f.key);
      const next = keys[keys.indexOf(key) + 1] ?? null;
      setArmed(next);
    },
  });

  function syncMarkers(): void {
    map.setMarkers(
      pointFields(scene).map((f) => {
        const w = params[f.key] as Waypoint;
        return { key: f.key, label: f.label.replace(/\s*\(.*\)$/, ''), color: f.color, lat: w.lat, lon: w.lon };
      }),
    );
  }

  function setArmed(key: string | null): void {
    armed = key;
    map.setArmed(key);
    form?.setArmed(key);
    const field = key ? pointFields(scene).find((f) => f.key === key) : undefined;
    pickHint.textContent = field
      ? `Click the map to place: ${field.label}.`
      : 'Use “Pick on map” or type coordinates, then start recording.';
  }

  // ---- Form ----------------------------------------------------------------
  function mountScene(next: SceneType): void {
    scene = next;
    params = paramsByScene[scene.id];
    sceneSelect.value = scene.id;
    sceneDescription.textContent = scene.description;
    form?.destroy();
    form = renderForm(paramsForm, scene.fields, params, {
      onChange(valid) {
        if (!valid) {
          trajectory = null;
          startBtn.disabled = true;
          setStatus('Fix the highlighted fields.');
          return;
        }
        syncMarkers();
        scheduleRebuild();
      },
      onPick(key) {
        setArmed(armed === key ? null : key);
      },
    });
    syncMarkers();
    map.setTrack([]);
    setArmed(pointFields(scene)[0]?.key ?? null);
    persist();
  }

  sceneSelect.addEventListener('change', () => {
    mountScene(getSceneType(sceneSelect.value));
    fitAfterBuild = true;
    scheduleRebuild();
  });
  fitBtn.addEventListener('click', () => map.fitAll());
  resetBtn.addEventListener('click', () => {
    paramsByScene[scene.id] = structuredClone(scene.defaults);
    mountScene(scene);
    fitAfterBuild = true;
    scheduleRebuild();
  });

  mountScene(scene);
  map.fitAll();

  // ---- Recording viewer ----------------------------------------------------
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
  Object.assign(window, { viewer, map, config, Cesium });

  // ---- Output & quality settings ------------------------------------------
  let settingsTimer: number | undefined;
  const mountSettingsForm = (): FormHandle =>
    renderForm(settingsForm, settingsFields, settings, {
      onChange(valid) {
        if (!valid) {
          setStatus('Fix the highlighted settings.');
          startBtn.disabled = true;
          return;
        }
        window.clearTimeout(settingsTimer);
        settingsTimer = window.setTimeout(applyCurrentSettings, 250);
      },
      onPick() {},
    });
  let settingsForm_ = mountSettingsForm();

  function applyCurrentSettings(): void {
    const before = structuredClone(config);
    applySettings(settings, config);
    persist();

    const sizeChanged = before.video.width !== config.video.width || before.video.height !== config.video.height;
    if (sizeChanged) {
      fitViewport(config);
      viewer.resize();
    }
    applyQuality(viewer, config);
    if (trajectory) environment.update(trajectory);

    if (before.video.fps !== config.video.fps) {
      scheduleRebuild(); // frame count depends on fps
    } else {
      renderSummary();
      if (trajectory && !recording) {
        setStatus('Ready.');
        startBtn.disabled = false;
      }
    }
  }

  resetSettingsBtn.addEventListener('click', () => {
    settings = configToSettings(defaultConfig);
    settingsForm_.destroy();
    settingsForm_ = mountSettingsForm();
    applyCurrentSettings();
  });

  // ---- Trajectory (re)building ---------------------------------------------
  let rebuildTimer: number | undefined;
  let rebuildGeneration = 0;

  function scheduleRebuild(): void {
    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => void rebuild(), 250);
  }

  async function rebuild(): Promise<void> {
    const generation = ++rebuildGeneration;
    const builtScene = scene;
    startBtn.disabled = true;
    setStatus('Sampling terrain…');
    try {
      const built = await builtScene.build({ terrainProvider: viewer.terrainProvider, fps: config.video.fps }, params);
      if (generation !== rebuildGeneration) return; // superseded by a newer edit
      trajectory = built;
      Object.assign(window, { trajectory });
      persist();

      environment.update(trajectory);
      map.setTrack(
        Array.from({ length: TRACK_SAMPLES }, (_, i) =>
          trajectory!.poseAt(Math.round((i / (TRACK_SAMPLES - 1)) * (trajectory!.frameCount - 1))).position,
        ),
      );

      if (fitAfterBuild) {
        map.fitAll();
        fitAfterBuild = false;
      }

      frameSlider.max = String(trajectory.frameCount - 1);
      frameSlider.value = '0';
      showFrame(0);

      renderSummary();
      setStatus('Ready.');
      startBtn.disabled = recording;
    } catch (err) {
      if (generation !== rebuildGeneration) return;
      trajectory = null;
      pathSummary.textContent = '';
      map.setTrack([]);
      setStatus(`Invalid scene:\n${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function renderSummary(): void {
    if (!trajectory) {
      pathSummary.textContent = '';
      return;
    }
    pathSummary.textContent = [
      `${scene.name}`,
      ...trajectory.notes,
      `Path: ${trajectory.length.toFixed(0)} m → ${trajectory.duration.toFixed(1)} s video`,
      `${trajectory.frameCount} frames @ ${config.video.fps} fps, ${config.video.width}x${config.video.height}, ` +
        `${(config.video.bitrate / 1e6).toFixed(1)} Mbit/s`,
    ].join('\n');
  }

  function showFrame(frame: number): void {
    if (!trajectory) return;
    setCameraToFrame(viewer.scene.camera, trajectory, frame);
    const t = (frame / (trajectory.frameCount - 1)) * trajectory.duration;
    frameLabel.textContent = `frame ${frame} / ${trajectory.frameCount - 1} (${t.toFixed(1)} s)`;
  }

  frameSlider.addEventListener('input', () => showFrame(Number(frameSlider.value)));

  await rebuild();

  // ---- Recording -----------------------------------------------------------
  function setEditingEnabled(enabled: boolean): void {
    form?.setEnabled(enabled);
    settingsForm_.setEnabled(enabled);
    map.setEnabled(enabled);
    for (const el of [sceneSelect, frameSlider, fitBtn, resetBtn, resetSettingsBtn]) el.disabled = !enabled;
  }

  let abort: AbortController | null = null;
  cancelBtn.addEventListener('click', () => {
    abort?.abort();
    cancelBtn.disabled = true;
    setStatus('Cancelling…');
  });

  startBtn.addEventListener('click', async () => {
    if (!trajectory) return;
    const flight = trajectory;
    const filename = `${scene.id}.mp4`;
    abort = new AbortController();
    startBtn.hidden = true;
    cancelBtn.hidden = false;
    cancelBtn.disabled = false;
    recording = true;
    setArmed(null);
    setEditingEnabled(false);
    progressBar.classList.add('active');
    progressFill.style.width = '0%';
    try {
      const blob = await recordFlight(
        viewer,
        flight,
        config,
        (p: RecordProgress) => {
          progressFill.style.width = `${(p.frame / p.frameCount) * 100}%`;
          if (p.phase === 'warm-up') {
            setStatus('Warming up: loading tiles for the first frame…');
          } else if (p.phase === 'recording') {
            setStatus(`Recording frame ${p.frame}/${p.frameCount}${formatEta(p.etaSeconds)}`);
          } else {
            setStatus('Finalizing MP4…');
          }
        },
        abort.signal,
      );
      downloadBlob(blob, filename);
      setStatus(`Done — ${filename} downloaded (${(blob.size / 1e6).toFixed(1)} MB).`);
    } catch (err) {
      if (err instanceof RecordingCancelled) {
        setStatus('Recording cancelled.');
      } else {
        console.error(err);
        setStatus(`Recording failed:\n${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      recording = false;
      abort = null;
      progressBar.classList.remove('active');
      cancelBtn.hidden = true;
      startBtn.hidden = false;
      setEditingEnabled(true);
      startBtn.disabled = trajectory === null;
      // Return the preview to the frame the slider shows.
      showFrame(Number(frameSlider.value));
    }
  });
}

main().catch((err) => {
  console.error(err);
  setStatus(`Startup failed:\n${err instanceof Error ? err.message : String(err)}`);
});
