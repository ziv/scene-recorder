# Plan: High Resolution Scene Recorder

## Goal

A browser app (CesiumJS) that, on a single click, flies the camera along a straight, constant-speed path toward a target and produces a high-resolution (4K) MP4 video of the flight — with no tile popping.

## Decisions (agreed)

| Topic | Decision |
|---|---|
| Stack | Vanilla TypeScript + Vite + CesiumJS |
| Capture | Deterministic frame-by-frame rendering (not real-time) |
| Output | MP4 (H.264) encoded in-browser via WebCodecs, downloaded as a file |
| Config | JSON/TS config file in the repo |
| Imagery/terrain | Cesium ion (user has a token): Cesium World Terrain + best ion imagery |
| Camera aim | Always looks at the target (target stays centered) |
| Video | 3840×2160 (4K), 30 fps; speed configured in m/s, duration derived |

### Path definition (per clarification)

- **End position (target):** `lat`, `lon`, `height` (height above ellipsoid/ground — see open point below).
- **Start position:** offset **relative to the end position** in local axes:
  - `x` — meters, positive = **east**
  - `y` — meters, positive = **south**
  - `z` — **height** in meters (absolute camera height component of the offset frame)
- Flight: straight line from start to end, constant speed, camera continuously pointed at the target.

## Architecture

```
scene-recorder/
├── index.html              # canvas container + "Start Recording" button + progress UI
├── vite.config.ts          # vite-plugin-cesium (static assets, CESIUM_BASE_URL)
├── .env.local              # VITE_CESIUM_ION_TOKEN=...  (git-ignored, never committed)
├── src/
│   ├── config.ts           # all user configuration (typed)
│   ├── main.ts             # bootstrap: viewer init, wire UI to recorder
│   ├── viewer.ts           # Cesium Viewer creation tuned for quality + offline rendering
│   ├── path.ts             # start/end Cartesian3 computation, per-frame camera pose
│   ├── recorder.ts         # frame loop: pose → render → wait tiles → capture
│   └── encoder.ts          # WebCodecs VideoEncoder + mp4-muxer → downloadable MP4
├── project.md
└── plan.md
```

### Configuration (`src/config.ts`)

```ts
export const config = {
  target: { lat: 0, lon: 0, height: 100 },       // end position (deg, deg, m)
  startOffset: { x: -1000, y: 500, z: 400 },     // m; x+ = east, y+ = south, z = height
  speed: 50,                                     // m/s along the path
  video: { width: 3840, height: 2160, fps: 30, bitrate: 40_000_000 },
  quality: {
    maximumScreenSpaceError: 1,                  // lower = sharper tiles (default 2)
    tileCacheSize: 1000,
    msaaSamples: 4,
  },
};
```

## Implementation phases

### Phase 1 — Project scaffolding
1. `npm create vite@latest` (vanilla-ts), add `cesium`, `vite-plugin-cesium`, `mp4-muxer`.
2. Ion token from `import.meta.env.VITE_CESIUM_ION_TOKEN`; add `.env.local` to `.gitignore` (already has entries — verify).
3. Basic page: full-window Cesium canvas, Start button, progress bar/status text.

### Phase 2 — Viewer tuned for quality
Create the `Viewer` with:
- `Cesium.createWorldTerrainAsync()` + ion world imagery (`createWorldImageryAsync`, Aerial) — the highest-quality sources ion provides.
- Fixed off-screen-sized canvas: container sized to exactly 3840×2160 with `resolutionScale = 1` and `useBrowserRecommendedResolution = false`, so captured pixels are true 4K (the container can be CSS-scaled down to fit the screen; WebGL renders at full size).
- `preserveDrawingBuffer: true` (needed only if capturing via `toBlob`; with `VideoFrame(canvas)` captured synchronously after render it may be avoidable — decide in code, start with `true` for safety).
- Quality settings: `maximumScreenSpaceError` from config, `msaaSamples`, FXAA on, fog off, disable default animations/widgets, `requestRenderMode: true` + explicit rendering only (we drive every render ourselves).

### Phase 3 — Path math (`path.ts`)
1. Target → `Cartesian3` via `Cartesian3.fromDegrees(lon, lat, height)`.
2. Build local frame at target with `Transforms.eastNorthUpToFixedFrame`.
3. Start = target + offset transformed through that frame, mapping config axes: east = `+x`, north = `-y` (y is south-positive), up = `z`.
4. Path length = `Cartesian3.distance(start, end)`; total frames = `ceil(length / speed * fps)`.
5. `poseAt(frameIndex)` → interpolated position (`Cartesian3.lerp`) + orientation from `lookAt`-style direction toward target (compute direction/up so the camera points at the target each frame).

### Phase 4 — Deterministic frame-by-frame recorder (`recorder.ts`)
This is the answer to the "popping tiles" / "render frame by frame" questions in project.md:

For each frame `i` of `N`:
1. Set camera to `poseAt(i)` (`camera.setView` with position + direction/up).
2. Call `scene.requestRender()` / render, then **wait until the scene is fully loaded**:
   - `scene.globe.tilesLoaded === true`, and
   - a `Scene.postRender` tick where no tile/imagery requests are in flight (use `globe.tileLoadProgressEvent` reaching 0, plus a couple of settle renders — imagery can lag terrain).
3. Render one final clean frame, then hand the canvas to the encoder.
4. Update progress UI (`frame i/N`, ETA).

Because we never advance until tiles are resolved, the output has zero popping regardless of how long loading takes — and constant speed is exact because time is simulated (frame index ↔ distance), not wall-clock.

Timeout guard per frame (e.g. 30 s) so a stuck tile request can't hang the recording forever; log and proceed if hit.

### Phase 5 — MP4 encoding (`encoder.ts`)
1. `VideoEncoder` (WebCodecs) with `avc1.*` (H.264 High profile, level sufficient for 4K30 — `avc1.640033`), bitrate from config, keyframe every ~2 s.
2. Per frame: `new VideoFrame(canvas, { timestamp: i * 1e6 / fps })` → `encoder.encode(frame)` → `frame.close()`. Apply backpressure via `encoder.encodeQueueSize` so memory stays bounded.
3. Mux chunks with `mp4-muxer` into an in-memory (or File System Access API stream) MP4; on finish, trigger download `flight.mp4`.
4. Feature-check at startup: if `VideoEncoder.isConfigSupported` rejects H.264@4K, report clearly and fall back to HEVC or VP9/WebM (with a visible notice).

### Phase 6 — Wire-up + polish
1. Start button → disable UI → run recorder → auto-download → re-enable.
2. Status line: phase (loading tiles / encoding), frame counter, elapsed/ETA.
3. Pre-flight warm-up: before frame 0, position camera at start and let everything load once so frame 0 is as sharp as the rest.

## Verification

1. `npm run dev`, load app, verify the globe renders with terrain + ion imagery at the configured target.
2. Record a short test path (e.g., 5 s at low speed) — confirm MP4 downloads, plays, is 3840×2160@30fps (check with `ffprobe`), and has no visible tile popping or blur-in.
3. Record the real configured path; visually inspect start/end framing (target centered throughout).

## Open points / risks (will surface during implementation, not blockers)

- **`target.height` semantics:** project.md says "height above ground". Cesium positions use height above the ellipsoid. Plan: use `sampleTerrainMostDetailed` to get ground elevation at the target and add the configured height on top, so config means "above ground" as written.
- **4K WebGL canvas:** requires a GPU/browser supporting ≥3840×2160 render buffers — standard on modern hardware; the app will assert `canvas.width` matches config and warn otherwise.
- **H.264 4K encoder support** varies by browser/OS; Chrome on macOS should be fine (hardware encode). Fallback path noted in Phase 5.
- **Memory:** muxing in memory holds the whole MP4 (~40 Mbps × duration). For long videos, switch the muxer target to a File System Access API stream (writes directly to disk). Will implement the in-memory version first and streamed target if durations get long.
