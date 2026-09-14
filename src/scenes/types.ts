import type * as Cesium from 'cesium';

/** A geographic point; height is meters above the terrain at that lat/lon. */
export interface Waypoint {
  lat: number;
  lon: number;
  height: number;
}

export interface CameraPose {
  position: Cesium.Cartesian3;
  direction: Cesium.Cartesian3;
  up: Cesium.Cartesian3;
}

/** A fully resolved camera motion, ready to be scrubbed or recorded. */
export interface Trajectory {
  /** Path length in meters. */
  length: number;
  /** Video duration in seconds. */
  duration: number;
  /** Total frames, both endpoints included. */
  frameCount: number;
  /** Camera pose for frame i (0-based). */
  poseAt(frame: number): CameraPose;
  /** What the scene is about: centre for clouds and reference for time-of-day. */
  focus: { lat: number; lon: number; groundHeight: number };
  /** Horizontal extent from the focus that the scene covers, meters. */
  radius: number;
  /** Extra human-readable details for the summary panel. */
  notes: string[];
}

// ---- Parameter schema -------------------------------------------------------
// Each scene declares its inputs; the form and the map are generated from them.

export interface PointField {
  kind: 'point';
  key: string;
  label: string;
  /** Marker colour on the map (CSS colour). */
  color: string;
  /** Label for the height input (defaults to "Height above ground"). */
  heightLabel?: string;
}

export interface NumberField {
  kind: 'number';
  key: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
}

export interface SelectField {
  kind: 'select';
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export interface DateField {
  kind: 'date';
  key: string;
  label: string;
}

export type ParamField = PointField | NumberField | SelectField | DateField;

export type ParamValue = Waypoint | number | string;
export type Params = Record<string, ParamValue>;

export interface BuildContext {
  terrainProvider: Cesium.TerrainProvider;
  fps: number;
}

export interface SceneType<P extends Params = Params> {
  id: string;
  name: string;
  /** One or two sentences shown under the scene selector. */
  description: string;
  fields: ParamField[];
  defaults: P;
  /** Resolves terrain and builds the camera motion. Throws with a user-facing message if the params are unusable. */
  build(ctx: BuildContext, params: P): Promise<Trajectory>;
}

/** Helper so scene modules can declare typed params while the registry stays untyped. */
export function defineScene<P extends Params>(scene: SceneType<P>): SceneType {
  return scene as unknown as SceneType;
}
