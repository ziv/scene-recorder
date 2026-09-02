import * as Cesium from 'cesium';
import type { Config } from './config';

export interface FlightPath {
  /** Camera start position (ECEF). */
  start: Cesium.Cartesian3;
  /** Camera end position == the look-at target (ECEF). */
  target: Cesium.Cartesian3;
  /** Straight-line path length in meters. */
  length: number;
  /** Total video frames (both endpoints included). */
  frameCount: number;
  /** Video duration in seconds. */
  duration: number;
  /** Camera pose for frame i (0-based). */
  poseAt(frame: number): { position: Cesium.Cartesian3; direction: Cesium.Cartesian3; up: Cesium.Cartesian3 };
}

/**
 * Builds the straight, constant-speed flight path.
 *
 * Target height in config means "meters above ground": the terrain height at
 * the target is sampled and added. The start offset is expressed in the local
 * frame of the target: x+ = east, y+ = south, z = up.
 */
export async function buildPath(terrainProvider: Cesium.TerrainProvider, config: Config): Promise<FlightPath> {
  const carto = Cesium.Cartographic.fromDegrees(config.target.lon, config.target.lat);
  const [sampled] = await Cesium.sampleTerrainMostDetailed(terrainProvider, [carto]);
  const groundHeight = sampled.height ?? 0;

  const target = Cesium.Cartesian3.fromDegrees(
    config.target.lon,
    config.target.lat,
    groundHeight + config.target.height,
  );

  // Local east-north-up frame at the target; config offset is (east, south, up).
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(target);
  const offsetLocal = new Cesium.Cartesian3(
    config.startOffset.x, // east
    -config.startOffset.y, // config y+ is south, ENU y+ is north
    config.startOffset.z, // up
  );
  const start = Cesium.Matrix4.multiplyByPoint(enu, offsetLocal, new Cesium.Cartesian3());

  const length = Cesium.Cartesian3.distance(start, target);
  const duration = length / config.speed;
  const frameCount = Math.max(2, Math.ceil(duration * config.video.fps) + 1);

  let lastDirection = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(target, start, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  );

  const poseAt = (frame: number) => {
    const t = frame / (frameCount - 1);
    const position = Cesium.Cartesian3.lerp(start, target, t, new Cesium.Cartesian3());

    // Look at the target; near the very end the direction degenerates, so the
    // last valid direction is kept.
    const toTarget = Cesium.Cartesian3.subtract(target, position, new Cesium.Cartesian3());
    let direction: Cesium.Cartesian3;
    if (Cesium.Cartesian3.magnitude(toTarget) > 0.001) {
      direction = Cesium.Cartesian3.normalize(toTarget, new Cesium.Cartesian3());
      lastDirection = direction;
    } else {
      direction = lastDirection;
    }

    // Orthonormal up: start from geodetic up at the camera position.
    const geodeticUp = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(position, new Cesium.Cartesian3());
    const right = Cesium.Cartesian3.cross(direction, geodeticUp, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(right, right);
    const up = Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(up, up);

    return { position, direction, up };
  };

  return { start, target, length, frameCount, duration, poseAt };
}
