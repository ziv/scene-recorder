export interface Config {
  /** End position of the flight; the camera always looks at this point. */
  target: {
    lat: number; // degrees
    lon: number; // degrees
    /** Meters above ground (terrain height is sampled and added). */
    height: number;
  };
  /** Start position relative to the target, in meters. */
  startOffset: {
    /** Positive = east. */
    x: number;
    /** Positive = south. */
    y: number;
    /** Height component (up) of the offset. */
    z: number;
  };
  /** Flight speed along the path, m/s. Video duration = path length / speed. */
  speed: number;
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
}

export const config: Config = {
  // Example: Matterhorn summit area
  // target: { lat: 45.9763, lon: 7.6586, height: 200 },
  target: { lat: 36.1, lon: -112.1251, height: 200 },
  startOffset: { x: -2000, y: -3000, z: 1500 },
  speed: 100,
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
};
