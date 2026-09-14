import * as Cesium from 'cesium';
import type { CameraPose, Trajectory, Waypoint } from './types';

const scratchUp = new Cesium.Cartesian3();
const scratchRight = new Cesium.Cartesian3();

/** Terrain heights (above the ellipsoid) at each point, in order. */
export async function sampleGround(
  terrainProvider: Cesium.TerrainProvider,
  points: { lat: number; lon: number }[],
): Promise<number[]> {
  const cartos = points.map((p) => Cesium.Cartographic.fromDegrees(p.lon, p.lat));
  const sampled = await Cesium.sampleTerrainMostDetailed(terrainProvider, cartos);
  return sampled.map((c) => c.height ?? 0);
}

/** ECEF position of a waypoint given the terrain height at its lat/lon. */
export function waypointToCartesian(w: Waypoint, groundHeight: number): Cesium.Cartesian3 {
  return Cesium.Cartesian3.fromDegrees(w.lon, w.lat, groundHeight + w.height);
}

/** Great-circle-ish horizontal distance between two points on the ellipsoid surface, meters. */
export function horizontalDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const pa = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 0);
  const pb = Cesium.Cartesian3.fromDegrees(b.lon, b.lat, 0);
  return Cesium.Cartesian3.distance(pa, pb);
}

/**
 * Builds an orthonormal camera pose from a position and a view direction.
 * `up` is chosen closest to geodetic up; when the view is (almost) vertical,
 * local north is used instead so the pose is always well defined.
 */
export function poseFromDirection(position: Cesium.Cartesian3, direction: Cesium.Cartesian3): CameraPose {
  const dir = Cesium.Cartesian3.normalize(direction, new Cesium.Cartesian3());
  let hint = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(position, scratchUp);
  let right = Cesium.Cartesian3.cross(dir, hint, scratchRight);
  if (Cesium.Cartesian3.magnitude(right) < 1e-6) {
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(position);
    // Local north, as a direction vector.
    hint = Cesium.Matrix4.multiplyByPointAsVector(enu, Cesium.Cartesian3.UNIT_Y, new Cesium.Cartesian3());
    right = Cesium.Cartesian3.cross(dir, hint, scratchRight);
  }
  Cesium.Cartesian3.normalize(right, right);
  const up = Cesium.Cartesian3.cross(right, dir, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(up, up);
  return { position, direction: dir, up };
}

/**
 * Pose looking from `position` at `target`. If the camera is (almost) on the
 * target, `fallbackDirection` is used so the last frames stay stable.
 */
export function lookAtPose(
  position: Cesium.Cartesian3,
  target: Cesium.Cartesian3,
  fallbackDirection: Cesium.Cartesian3,
): CameraPose {
  const toTarget = Cesium.Cartesian3.subtract(target, position, new Cesium.Cartesian3());
  const direction = Cesium.Cartesian3.magnitude(toTarget) > 0.001 ? toTarget : fallbackDirection;
  return poseFromDirection(position, direction);
}

/** Unit vector in the local east-north-up frame at `origin`, given azimuth/elevation. */
export function directionFromHeadingPitch(
  origin: Cesium.Cartesian3,
  headingDeg: number,
  pitchDeg: number,
): Cesium.Cartesian3 {
  const h = Cesium.Math.toRadians(headingDeg);
  const p = Cesium.Math.toRadians(pitchDeg);
  const local = new Cesium.Cartesian3(Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p));
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  return Cesium.Matrix4.multiplyByPointAsVector(enu, local, new Cesium.Cartesian3());
}

/** Heading (deg, clockwise from north) of the horizontal component of `vector` at `origin`. */
export function headingOf(origin: Cesium.Cartesian3, vector: Cesium.Cartesian3): number {
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  const inv = Cesium.Matrix4.inverseTransformation(enu, new Cesium.Matrix4());
  const local = Cesium.Matrix4.multiplyByPointAsVector(inv, vector, new Cesium.Cartesian3());
  return Cesium.Math.toDegrees(Math.atan2(local.x, local.y));
}

export interface CurveSpec {
  /** Position along the curve for u in [0, 1]; any parametrisation. */
  positionAt(u: number): Cesium.Cartesian3;
  /** Camera orientation at a position on the curve. */
  poseAt(position: Cesium.Cartesian3, u: number): CameraPose;
  /** Constant travel speed, m/s. */
  speed: number;
  fps: number;
  /** Segments used to measure the curve (default 1024). */
  samples?: number;
}

const MIN_LENGTH = 1;

/**
 * Turns an arbitrarily parametrised curve into a constant-speed trajectory by
 * measuring it numerically and re-parametrising by arc length, so the video
 * plays at uniform speed no matter how the curve was defined.
 */
export function constantSpeedTrajectory(spec: CurveSpec): Pick<Trajectory, 'length' | 'duration' | 'frameCount' | 'poseAt'> {
  const n = spec.samples ?? 1024;
  const cumulative = new Float64Array(n + 1);
  let prev = spec.positionAt(0);
  for (let i = 1; i <= n; i++) {
    const p = spec.positionAt(i / n);
    cumulative[i] = cumulative[i - 1] + Cesium.Cartesian3.distance(prev, p);
    prev = p;
  }
  const length = cumulative[n];
  if (!(length >= MIN_LENGTH)) {
    throw new Error('The camera path must be at least 1 m long.');
  }
  if (!(spec.speed > 0)) {
    throw new Error('Speed must be positive.');
  }

  const uAtDistance = (d: number): number => {
    if (d <= 0) return 0;
    if (d >= length) return 1;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] <= d) lo = mid;
      else hi = mid;
    }
    const segment = cumulative[hi] - cumulative[lo];
    const f = segment > 0 ? (d - cumulative[lo]) / segment : 0;
    return (lo + f) / n;
  };

  const duration = length / spec.speed;
  const frameCount = Math.max(2, Math.ceil(duration * spec.fps) + 1);

  return {
    length,
    duration,
    frameCount,
    poseAt(frame) {
      const t = Math.min(Math.max(frame / (frameCount - 1), 0), 1);
      const u = uAtDistance(t * length);
      return spec.poseAt(spec.positionAt(u), u);
    },
  };
}

/** Moves the camera to the pose for the given frame. */
export function setCameraToFrame(camera: Cesium.Camera, trajectory: Trajectory, frame: number): void {
  const pose = trajectory.poseAt(frame);
  camera.setView({
    destination: pose.position,
    orientation: { direction: pose.direction, up: pose.up },
  });
}
