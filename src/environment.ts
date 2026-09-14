import * as Cesium from 'cesium';
import type { Config } from './config';
import type { FlightPath } from './path';

export interface Environment {
  /** Re-applies time-of-day and weather for a (new) flight path. */
  update(path: FlightPath): void;
}

/**
 * Applies time-of-day and weather to the scene for the current flight path.
 *
 * Time: the configured hour is local solar time at the end point — converted
 * to UTC via its longitude (15° per hour) — and the globe is sun-lit, so
 * lighting matches the chosen hour and season.
 *
 * Weather: fog density plus procedurally placed cumulus clouds around the end
 * point, covering the whole flight corridor. Cloud placement uses a seeded
 * RNG, so every recording of the same path renders the identical sky.
 */
export function createEnvironment(viewer: Cesium.Viewer, config: Config): Environment {
  const scene = viewer.scene;
  scene.globe.enableLighting = true;
  viewer.clock.shouldAnimate = false;

  let clouds: Cesium.CloudCollection | null = null;

  return {
    update(path: FlightPath): void {
      const { date, hourOfDay, weather } = config.environment;

      const utcHours = hourOfDay - path.spec.end.lon / 15;
      const time = Cesium.JulianDate.fromIso8601(`${date}T00:00:00Z`);
      Cesium.JulianDate.addHours(time, utcHours, time);
      viewer.clock.currentTime = time;

      if (clouds) {
        scene.primitives.remove(clouds); // also destroys it
        clouds = null;
      }

      switch (weather) {
        case 'clear':
          scene.fog.enabled = false;
          break;
        case 'partlyCloudy':
          scene.fog.enabled = false;
          clouds = addClouds(scene, path, {
            count: 40,
            brightness: 1.0,
            baseAltitude: 1400,
            altitudeSpread: 700,
          });
          break;
        case 'overcast':
          scene.fog.enabled = true;
          scene.fog.density = 4e-4;
          clouds = addClouds(scene, path, {
            count: 170,
            brightness: 0.55,
            baseAltitude: 1000,
            altitudeSpread: 400,
          });
          break;
        case 'foggy':
          scene.fog.enabled = true;
          scene.fog.density = 1.2e-3;
          break;
      }
    },
  };
}

interface CloudOptions {
  count: number;
  brightness: number;
  /** Cloud base height above the end point's ground, meters. */
  baseAltitude: number;
  altitudeSpread: number;
}

function addClouds(scene: Cesium.Scene, path: FlightPath, opts: CloudOptions): Cesium.CloudCollection {
  const clouds = new Cesium.CloudCollection();
  const rng = mulberry32(0xc10d5eed);
  const { lon, lat } = path.spec.end;
  const groundHeight = path.endGroundHeight;

  // Cover the whole flight corridor with margin.
  const radius = Math.max(3000, path.length + 1500);
  const metersPerDegLat = 111_320;
  const metersPerDegLon = metersPerDegLat * Math.cos(Cesium.Math.toRadians(lat));

  for (let i = 0; i < opts.count; i++) {
    // Uniform position in a disc around the end point.
    const angle = rng() * Cesium.Math.TWO_PI;
    const dist = radius * Math.sqrt(rng());
    const east = Math.cos(angle) * dist;
    const north = Math.sin(angle) * dist;

    const width = 800 + rng() * 1400;
    clouds.add({
      position: Cesium.Cartesian3.fromDegrees(
        lon + east / metersPerDegLon,
        lat + north / metersPerDegLat,
        groundHeight + opts.baseAltitude + rng() * opts.altitudeSpread,
      ),
      scale: new Cesium.Cartesian2(width, width * (0.15 + rng() * 0.1)),
      maximumSize: new Cesium.Cartesian3(50, 12 + rng() * 8, 15),
      slice: 0.25 + rng() * 0.25,
      brightness: opts.brightness,
    });
  }

  scene.primitives.add(clouds);
  return clouds;
}

/** Small deterministic PRNG so cloud layouts are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
