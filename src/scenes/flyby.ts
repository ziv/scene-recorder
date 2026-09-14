import * as Cesium from 'cesium';
import { defineScene, type Waypoint } from './types';
import { constantSpeedTrajectory, horizontalDistance, lookAtPose, sampleGround, waypointToCartesian } from './geo';

interface FlyByParams extends Record<string, Waypoint | number> {
  start: Waypoint;
  end: Waypoint;
  target: Waypoint;
  speed: number;
}

/** Straight pass from A to B while the camera stays locked on a separate point C. */
export const flyBy = defineScene<FlyByParams>({
  id: 'flyby',
  name: 'Fly-by',
  description: 'Flies in a straight line from the start to the end point while the camera stays locked on a separate target.',
  fields: [
    { kind: 'point', key: 'start', label: 'Start point', color: '#76ff03' },
    { kind: 'point', key: 'end', label: 'End point', color: '#29b6f6' },
    { kind: 'point', key: 'target', label: 'Camera target', color: '#f44336', heightLabel: 'Look-at height above ground' },
    { kind: 'number', key: 'speed', label: 'Speed', unit: 'm/s', min: 1, max: 5000, step: 5 },
  ],
  defaults: {
    // Passes about 2.5 km east of the summit so the target stays framed, not overflown.
    start: { lat: 46.01, lon: 7.68, height: 1500 },
    end: { lat: 45.94, lon: 7.7, height: 1500 },
    target: { lat: 45.9763, lon: 7.6586, height: 100 },
    speed: 150,
  },
  async build(ctx, params) {
    const [startGround, endGround, targetGround] = await sampleGround(ctx.terrainProvider, [
      params.start,
      params.end,
      params.target,
    ]);
    const start = waypointToCartesian(params.start, startGround);
    const end = waypointToCartesian(params.end, endGround);
    const target = waypointToCartesian(params.target, targetGround);
    const travel = Cesium.Cartesian3.subtract(end, start, new Cesium.Cartesian3());

    const core = constantSpeedTrajectory({
      positionAt: (u) => Cesium.Cartesian3.lerp(start, end, u, new Cesium.Cartesian3()),
      poseAt: (position) => lookAtPose(position, target, travel),
      speed: params.speed,
      fps: ctx.fps,
      samples: 1,
    });

    const radius = Math.max(
      horizontalDistance(params.target, params.start),
      horizontalDistance(params.target, params.end),
    );

    return {
      ...core,
      focus: { lat: params.target.lat, lon: params.target.lon, groundHeight: targetGround },
      radius,
      notes: [
        `Ground at start ${startGround.toFixed(0)} m, at end ${endGround.toFixed(0)} m, at target ${targetGround.toFixed(0)} m`,
      ],
    };
  },
});
