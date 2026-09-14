import * as Cesium from 'cesium';
import type { FlightSpec } from './config';

export interface CameraPose {
  position: Cesium.Cartesian3;
  direction: Cesium.Cartesian3;
  up: Cesium.Cartesian3;
}

export interface FlightPath {
  /** The spec this path was built from. */
  spec: FlightSpec;
  /** Camera start position (ECEF). */
  start: Cesium.Cartesian3;
  /** Camera end position == the look-at target (ECEF). */
  target: Cesium.Cartesian3;
  /** Straight-line path length in meters. */
  length: number;
  /** Sampled terrain height (above ellipsoid) at the start lat/lon. */
  startGroundHeight: number;
  /** Sampled terrain height (above ellipsoid) at the end lat/lon. */
  endGroundHeight: number;
  /** Total video frames (both endpoints included). */
  frameCount: number;
  /** Video duration in seconds. */
  duration: number;
  /** Camera pose for frame i (0-based). */
  poseAt(frame: number): CameraPose;
}

/** Minimum start-to-end distance; below this the look direction is undefined. */
const MIN_PATH_LENGTH = 1;

/**
 * Builds the straight, constant-speed flight path from start to end.
 *
 * Waypoint heights mean "meters above ground": terrain is sampled at each
 * point's lat/lon and added. The camera looks at the end point throughout.
 */
export async function buildPath(
  terrainProvider: Cesium.TerrainProvider,
  spec: FlightSpec,
  fps: number,
): Promise<FlightPath> {
  const [startSample, endSample] = await Cesium.sampleTerrainMostDetailed(terrainProvider, [
    Cesium.Cartographic.fromDegrees(spec.start.lon, spec.start.lat),
    Cesium.Cartographic.fromDegrees(spec.end.lon, spec.end.lat),
  ]);
  const startGroundHeight = startSample.height ?? 0;
  const endGroundHeight = endSample.height ?? 0;

  const start = Cesium.Cartesian3.fromDegrees(
    spec.start.lon,
    spec.start.lat,
    startGroundHeight + spec.start.height,
  );
  const target = Cesium.Cartesian3.fromDegrees(spec.end.lon, spec.end.lat, endGroundHeight + spec.end.height);

  const length = Cesium.Cartesian3.distance(start, target);
  if (length < MIN_PATH_LENGTH) {
    throw new Error('Start and end points must be at least 1 m apart.');
  }
  const duration = length / spec.speed;
  const frameCount = Math.max(2, Math.ceil(duration * fps) + 1);

  let lastDirection = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(target, start, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  );

  const poseAt = (frame: number): CameraPose => {
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

  return {
    spec: structuredClone(spec),
    start,
    target,
    length,
    startGroundHeight,
    endGroundHeight,
    frameCount,
    duration,
    poseAt,
  };
}

/** Moves the camera to the pose for the given frame of the path. */
export function setCameraToFrame(camera: Cesium.Camera, path: FlightPath, frame: number): void {
  const pose = path.poseAt(frame);
  camera.setView({
    destination: pose.position,
    orientation: { direction: pose.direction, up: pose.up },
  });
}
