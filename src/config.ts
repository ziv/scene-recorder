export type Weather = 'clear' | 'partlyCloudy' | 'overcast' | 'foggy';

export interface Config {
  /** Scene type selected when the app loads (see src/scenes/index.ts). */
  defaultScene: string;
  video: {
    width: number;
    height: number;
    fps: number;
    /** Target encode bitrate, bits/second. */
    bitrate: number;
  };
  quality: {
    /** Lower = sharper tiles, more loading. Cesium default is 2. */
    maximumScreenSpaceError: number;
    tileCacheSize: number;
    msaaSamples: number;
  };
  /** Per-frame ceiling on waiting for tiles before giving up and capturing anyway. */
  tileLoadTimeoutMs: number;
  environment: {
    /** Date used for the sun's seasonal position, 'YYYY-MM-DD'. */
    date: string;
    /** Hour of day (0-24, fractions allowed), local solar time at the scene's focus point. */
    hourOfDay: number;
    weather: Weather;
  };
}

/**
 * Built-in defaults. The app makes a mutable copy of this at startup; the
 * "Output & quality" panel edits that copy and persists it in the browser.
 */
export const defaultConfig: Config = {
  defaultScene: 'straight',
  video: {
    width: 1200,
    height: 800,
    fps: 30,
    bitrate: 12_000_000,
  },
  quality: {
    maximumScreenSpaceError: 1,
    tileCacheSize: 1000,
    msaaSamples: 4,
  },
  tileLoadTimeoutMs: 30_000,
  environment: {
    date: '2026-06-21',
    hourOfDay: 12,
    weather: 'partlyCloudy',
  },
};
