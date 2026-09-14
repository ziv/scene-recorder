import * as Cesium from 'cesium';
import { defineScene, type Waypoint } from './types';
import { constantSpeedTrajectory, lookAtPose, sampleGround } from './geo';

interface OrbitParams extends Record<string, Waypoint | number | string> {
  center: Waypoint;
  startRadius: number;
  endRadius: number;
  startHeight: number;
  endHeight: number;
  startBearing: number;
  sweep: number;
  direction: 'cw' | 'ccw';
  speed: number;
}

/**
 * Cinematic orbit: the camera circles the centre point while the radius and
 * height ease from their start to end values, so it spirals in (or out) and
 * keeps the centre framed the whole time.
 */
export const cinematicOrbit = defineScene<OrbitParams>({
  id: 'orbit',
  name: 'Cinematic orbit',
  description:
    'Circles the centre point while closing in: radius and height move from their start to end values over the sweep. The camera always looks at the centre.',
  fields: [
    { kind: 'point', key: 'center', label: 'Centre (camera target)', color: '#f44336', heightLabel: 'Look-at height above ground' },
    { kind: 'number', key: 'startRadius', label: 'Start radius', unit: 'm', min: 1, max: 200_000, step: 100 },
    { kind: 'number', key: 'endRadius', label: 'End radius', unit: 'm', min: 1, max: 200_000, step: 100 },
    { kind: 'number', key: 'startHeight', label: 'Start height above centre ground', unit: 'm', min: -1000, max: 50_000, step: 50 },
    { kind: 'number', key: 'endHeight', label: 'End height above centre ground', unit: 'm', min: -1000, max: 50_000, step: 50 },
    { kind: 'number', key: 'startBearing', label: 'Start bearing from centre', unit: '° from N', min: -360, max: 360, step: 5 },
    { kind: 'number', key: 'sweep', label: 'Sweep', unit: '°', min: 1, max: 1080, step: 15 },
    {
      kind: 'select',
      key: 'direction',
      label: 'Direction',
      options: [
        { value: 'cw', label: 'Clockwise (seen from above)' },
        { value: 'ccw', label: 'Counter-clockwise' },
      ],
    },
    { kind: 'number', key: 'speed', label: 'Speed', unit: 'm/s', min: 1, max: 5000, step: 5 },
  ],
  defaults: {
    center: { lat: 45.9763, lon: 7.6586, height: 100 },
    startRadius: 4000,
    endRadius: 1200,
    startHeight: 2500,
    endHeight: 800,
    startBearing: 315,
    sweep: 270,
    direction: 'cw',
    speed: 120,
  },
  async build(ctx, params) {
    const [groundHeight] = await sampleGround(ctx.terrainProvider, [params.center]);
    const groundPoint = Cesium.Cartesian3.fromDegrees(params.center.lon, params.center.lat, groundHeight);
    const target = Cesium.Cartesian3.fromDegrees(params.center.lon, params.center.lat, groundHeight + params.center.height);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(groundPoint);
    const sign = params.direction === 'ccw' ? -1 : 1;

    // Smoothstep easing on radius/height so the approach starts and ends gently.
    const ease = (u: number) => u * u * (3 - 2 * u);

    const positionAt = (u: number): Cesium.Cartesian3 => {
      const e = ease(u);
      const r = Cesium.Math.lerp(params.startRadius, params.endRadius, e);
      const h = Cesium.Math.lerp(params.startHeight, params.endHeight, e);
      const bearing = Cesium.Math.toRadians(params.startBearing + sign * params.sweep * u);
      const local = new Cesium.Cartesian3(r * Math.sin(bearing), r * Math.cos(bearing), h);
      return Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3());
    };

    // Fallback look direction (only used if the camera lands on the target): towards the centre.
    const inward = Cesium.Cartesian3.subtract(target, positionAt(1), new Cesium.Cartesian3());

    const core = constantSpeedTrajectory({
      positionAt,
      poseAt: (position) => lookAtPose(position, target, inward),
      speed: params.speed,
      fps: ctx.fps,
      samples: 2048,
    });

    return {
      ...core,
      focus: { lat: params.center.lat, lon: params.center.lon, groundHeight },
      radius: Math.max(params.startRadius, params.endRadius),
      notes: [
        `Ground at centre ${groundHeight.toFixed(0)} m`,
        `Radius ${params.startRadius} → ${params.endRadius} m, height ${params.startHeight} → ${params.endHeight} m over ${params.sweep}°`,
      ],
    };
  },
});
