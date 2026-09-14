export type Weather = 'clear' | 'partlyCloudy' | 'overcast' | 'foggy';

export interface Waypoint {
  lat: number; // degrees
  lon: number; // degrees
  /** Meters above ground (terrain height is sampled at this lat/lon and added). */
  height: number;
}

export interface FlightSpec {
  /** Camera position on the first frame. */
  start: Waypoint;
  /** Camera position on the last frame; the camera always looks at this point. */
  end: Waypoint;
  /** Flight speed along the path, m/s. Video duration = path length / speed. */
  speed: number;
}

export interface Config {
  /**
   * Flight shown when the app loads. Start, end and speed are edited in the UI
   * (by clicking the map or typing coordinates) before recording.
   */
  defaultFlight: FlightSpec;
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
    /** Hour of day (0-24, fractions allowed), local solar time at the end point. */
    hourOfDay: number;
    weather: Weather;
  };
}

export const config: Config = {
  defaultFlight: {
    // Example: approach to the Matterhorn summit from the north-west.
    start: { lat: 46.0032, lon: 7.6327, height: 1500 },
    end: { lat: 45.9763, lon: 7.6586, height: 200 },
    speed: 100,
  },
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
