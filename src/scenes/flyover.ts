import * as Cesium from 'cesium';
import { defineScene, type Waypoint } from './types';
import {
  constantSpeedTrajectory,
  directionFromHeadingPitch,
  headingOf,
  poseFromDirection,
  sampleGround,
  waypointToCartesian,
} from './geo';

interface FlyoverParams extends Record<string, Waypoint | number> {
  start: Waypoint;
  end: Waypoint;
  pitch: number;
  speed: number;
}

/** Pilot's view: straight from A to B, looking ahead along the route with a fixed tilt. */
export const flyover = defineScene<FlyoverParams>({
  id: 'flyover',
  name: 'Flyover',
  description:
    'Flies in a straight line from the start to the end point looking ahead along the route, tilted down by the chosen pitch. Like a cockpit or drone forward view.',
  fields: [
    { kind: 'point', key: 'start', label: 'Start point', color: '#76ff03' },
    { kind: 'point', key: 'end', label: 'End point', color: '#29b6f6' },
    { kind: 'number', key: 'pitch', label: 'Camera pitch (negative = down)', unit: '°', min: -90, max: 45, step: 5 },
    { kind: 'number', key: 'speed', label: 'Speed', unit: 'm/s', min: 1, max: 5000, step: 5 },
  ],
  defaults: {
    start: { lat: 46.02, lon: 7.6, height: 1200 },
    end: { lat: 45.96, lon: 7.66, height: 800 },
    pitch: -15,
    speed: 120,
  },
  async build(ctx, params) {
    const [startGround, endGround] = await sampleGround(ctx.terrainProvider, [params.start, params.end]);
    const start = waypointToCartesian(params.start, startGround);
    const end = waypointToCartesian(params.end, endGround);
    const travel = Cesium.Cartesian3.subtract(end, start, new Cesium.Cartesian3());

    const core = constantSpeedTrajectory({
      positionAt: (u) => Cesium.Cartesian3.lerp(start, end, u, new Cesium.Cartesian3()),
      poseAt: (position) => {
        // Heading follows the route; pitch is applied in the local frame at the camera.
        const heading = headingOf(position, travel);
        return poseFromDirection(position, directionFromHeadingPitch(position, heading, params.pitch));
      },
      speed: params.speed,
      fps: ctx.fps,
      samples: 1,
    });

    const midLat = (params.start.lat + params.end.lat) / 2;
    const midLon = (params.start.lon + params.end.lon) / 2;
    return {
      ...core,
      focus: { lat: midLat, lon: midLon, groundHeight: (startGround + endGround) / 2 },
      radius: core.length / 2,
      notes: [`Ground at start ${startGround.toFixed(0)} m, at end ${endGround.toFixed(0)} m`],
    };
  },
});
