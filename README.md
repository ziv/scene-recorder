# Scene Recorder

Scene Recorder renders cinematic camera flights over real terrain and saves them as MP4 files. It runs entirely in the browser: Cesium draws the globe with Cesium ion world terrain and imagery, every frame is rendered only after all tiles have loaded, and the frames are encoded with the browser's built-in video encoder. The result is a smooth, constant-speed video with no tile popping, regardless of network speed.

You pick a scene type, place its points on a small map, preview any frame, and press record.

## Requirements

- Node.js 18 or newer
- A [Cesium ion](https://ion.cesium.com) account and access token (the free tier is enough)
- A recent Chromium-based browser. Recording uses the WebCodecs API to encode video, so Chrome or Edge are recommended. Firefox and Safari lack full support.

## Setup

```bash
npm install
cp .env.example .env.local
```

Open `.env.local` and paste your Cesium ion token:

```
VITE_CESIUM_ION_TOKEN=your-token-here
```

Then start the dev server:

```bash
npm run dev
```

The app prints a local URL. Open it in Chrome.

Other scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build to `docs/` for GitHub Pages |
| `npm run preview` | Serve the production build locally |

Cesium's static assets are exposed through a symlink, `public/cesium`, which points into `node_modules`. Vite serves it in development and copies it into the build output.

## Deploying to GitHub Pages

The project is set up to deploy as a GitHub Pages project site at `https://ziv.github.io/scene-recorder/`.

- `npm run build` writes the site to `docs/`, which is committed to the repository. In the repository settings under Pages, choose "Deploy from a branch", select `main` and the `/docs` folder.
- The build uses the `/scene-recorder/` base path so asset and Cesium URLs resolve under the project subpath. If you rename the repository, update `REPO_NAME` in `vite.config.ts`.
- The Cesium ion token for the deployed site lives in `.env.production`, which Vite reads during `npm run build`. It is a web token restricted to the `ziv.github.io` origin, so it is safe to commit and will not work from other domains. Local development keeps using the token in `.env.local`.
- A `.nojekyll` file in `public/` is copied into the output so GitHub serves every file as-is.

To publish a new version:

```bash
npm run build
git add docs
git commit -m "Deploy"
git push
```

## Using the app

The left sidebar holds everything you control. The main viewport shows a live preview of what the camera sees.

1. **Choose a scene** from the dropdown. A short description explains what it does.
2. **Place points.** Each scene has one or more geographic points. Click "Pick on map" next to a point, then click the map to place it. After placing one point the next one is armed automatically, so a straight flight is just two clicks. You can also type latitude, longitude and height directly. The search box on the map jumps to a place by name.
3. **Tune parameters.** Speed, heights, radii and angles are plain numeric fields. Out-of-range values highlight the field and disable recording.
4. **Preview.** The map draws the camera's ground track as a yellow arrow. Drag the Preview slider to scrub through frames in the main viewport. The summary panel shows path length, duration and frame count.
5. **Record.** Press Start Recording. Progress and an ETA are shown. When done, the browser downloads a file named after the scene, for example `orbit.mp4`.

Heights are always meters above the terrain at that point. The terrain height is sampled and added automatically, so a start height of 1500 means 1500 meters above the ground at the start location.

Your scene selection and parameters are saved in the browser and restored on reload. "Reset to defaults" restores a scene's built-in example, and "Fit map to scene" recenters the map.

Recording takes a while. Every frame waits for all terrain and imagery tiles to finish loading before it is captured, so a 30 second video at 30 fps can take several minutes depending on your connection and GPU. Keep the tab in the foreground while recording.

## Scene types

**Straight flight.** Flies in a straight line from the start point to the end point. The camera always looks at the end point.

**Cinematic orbit.** Circles a centre point while the radius and height ease from their start values to their end values over the chosen sweep. Set a smaller end radius to spiral in. Direction can be clockwise or counter-clockwise. The camera always looks at the centre. Heights are relative to the ground at the centre point.

**Fly-by.** Flies in a straight line from the start point to the end point while the camera stays locked on a separate target. Useful for passing a landmark.

**Flyover.** Flies in a straight line from the start point to the end point looking ahead along the route, tilted down by a configurable pitch. This gives a cockpit or drone forward view.

All scenes move at constant speed along their path, so duration is simply path length divided by speed.

## Configuration

Video and quality settings live in `src/config.ts`:

- `video`: output width, height, frame rate and bitrate. The Cesium canvas is laid out at exactly this resolution, so the video is rendered pixel for pixel. Very large resolutions may exceed what your GPU or browser encoder supports.
- `quality`: Cesium tile detail (`maximumScreenSpaceError`, lower is sharper), tile cache size and anti-aliasing samples.
- `tileLoadTimeoutMs`: how long to wait per frame for tiles before capturing anyway.
- `environment`: date and local solar hour for sun position, plus weather. Weather is one of `clear`, `partlyCloudy`, `overcast` or `foggy`. Clouds are placed with a seeded random generator, so the same scene always renders the same sky.
- `defaultScene`: which scene type is selected on first load.

Default parameters for each scene live in the scene's own file under `src/scenes/`.

## Project layout

```
src/
  main.ts           App wiring: scene selector, form, map, preview, recording
  config.ts         Video, quality and environment settings
  viewer.ts         Creates the Cesium viewer tuned for offline rendering
  recorder.ts       Renders each frame after tiles load and feeds the encoder
  encoder.ts        MP4 encoding via mediabunny and WebCodecs
  environment.ts    Sun time, fog and clouds for the current scene
  map.ts            The small 2D picking map with markers and ground track
  form.ts           Renders a parameter form from a scene's field schema
  scenes/
    types.ts        Scene and trajectory contracts, parameter field schema
    geo.ts          Geometry helpers and constant-speed reparametrisation
    index.ts        Scene registry
    straight.ts     Straight flight
    orbit.ts        Cinematic orbit
    flyby.ts        Fly-by with fixed target
    flyover.ts      Forward-looking flyover
```

## Adding a scene type

A scene is a single module. It declares its parameters as a schema, and the form and the map are generated from that schema, so no UI code is needed.

1. Create `src/scenes/myscene.ts`.
2. Call `defineScene` with an id, name, description, a `fields` list, `defaults`, and a `build` function.
3. Fields can be `point` (a lat/lon/height picked on the map), `number` (with min, max and step) or `select` (a list of options).
4. In `build`, sample terrain with `sampleGround`, define a `positionAt(u)` function for the curve, and pass it to `constantSpeedTrajectory` along with a pose function. The helper measures the curve and re-parametrises it by arc length so the video plays at uniform speed. Return the result together with a `focus` point and `radius`, which the environment uses to centre clouds and compute sun time.
5. Append the scene to the list in `src/scenes/index.ts`.

Look at `src/scenes/flyby.ts` for a compact example and `src/scenes/orbit.ts` for a curved path with easing.

## How recording works

The Cesium viewer is created without its default render loop. During recording the app sets the camera pose for a frame, renders repeatedly until the globe reports all tiles loaded for several consecutive renders, then captures the canvas into the encoder. Because the camera advances by frame index rather than wall-clock time, the output has perfectly constant speed no matter how long each frame took to load.

Encoding uses [mediabunny](https://github.com/Vanilagy/mediabunny) on top of WebCodecs. The encoder prefers H.264, then HEVC, VP9 and AV1, picking the first one the browser can encode at the configured resolution. The finished MP4 is assembled in memory and downloaded.

## Troubleshooting

- **"Missing Cesium ion token"**: create `.env.local` as described in Setup and restart the dev server. For the deployed site, check `.env.production`.
- **Blank or black viewport on load**: terrain and imagery are still streaming. Give it a few seconds. If the tab was in the background, bring it forward, since browsers throttle background tabs.
- **"This browser cannot encode ... video"**: the browser has no WebCodecs encoder for that resolution. Use Chrome or Edge, or lower `video.width` and `video.height` in `src/config.ts`.
- **"Canvas is WxH, expected ..."**: the GPU could not allocate a render buffer at the configured size. Lower the video resolution.
- **Recording is slow**: lower `quality.maximumScreenSpaceError` toward Cesium's default of 2, reduce resolution, or increase speed to shorten the video.
