import * as Cesium from 'cesium';
import { defineScene, type Waypoint } from './types';
import { constantSpeedTrajectory, lookAtPose, sampleGround, waypointToCartesian } from './geo';

interface StraightParams extends Record<string, Waypoint | number> {
  start: Waypoint;
  end: Waypoint;
  speed: number;
}

/** Straight line from start to end, camera locked onto the end point. */
export const straightFlight = defineScene<StraightParams>({
  id: 'straight',
  name: 'Straight flight',
  description: 'Flies in a straight line from the start to the end point, always looking at the end point.',
  fields: [
    { kind: 'point', key: 'start', label: 'Start point', color: '#76ff03' },
    { kind: 'point', key: 'end', label: 'End point (camera target)', color: '#f44336' },
    { kind: 'number', key: 'speed', label: 'Speed', unit: 'm/s', min: 1, max: 5000, step: 5 },
  ],
  defaults: {
    start: { lat: 46.0032, lon: 7.6327, height: 1500 },
    end: { lat: 45.9763, lon: 7.6586, height: 200 },
    speed: 100,
  },
  async build(ctx, params) {
    const [startGround, endGround] = await sampleGround(ctx.terrainProvider, [params.start, params.end]);
    const start = waypointToCartesian(params.start, startGround);
    const end = waypointToCartesian(params.end, endGround);
    const travel = Cesium.Cartesian3.subtract(end, start, new Cesium.Cartesian3());

    const core = constantSpeedTrajectory({
      positionAt: (u) => Cesium.Cartesian3.lerp(start, end, u, new Cesium.Cartesian3()),
      poseAt: (position) => lookAtPose(position, end, travel),
      speed: params.speed,
      fps: ctx.fps,
      samples: 1,
    });

    return {
      ...core,
      focus: { lat: params.end.lat, lon: params.end.lon, groundHeight: endGround },
      radius: core.length,
      notes: [`Ground at start ${startGround.toFixed(0)} m, at end ${endGround.toFixed(0)} m`],
    };
  },
});
