import type { SceneType } from './types';
import { straightFlight } from './straight';
import { cinematicOrbit } from './orbit';
import { flyBy } from './flyby';
import { flyover } from './flyover';

/** All available scene types, in menu order. Add a new scene by appending it here. */
export const sceneTypes: readonly SceneType[] = [straightFlight, cinematicOrbit, flyBy, flyover];

export function getSceneType(id: string): SceneType {
  const scene = sceneTypes.find((s) => s.id === id);
  if (!scene) throw new Error(`Unknown scene type "${id}"`);
  return scene;
}

export * from './types';
export { setCameraToFrame } from './geo';
