import type { Config, Weather } from './config';
import type { ParamField, Params } from './scenes';

/**
 * The "Output & quality" panel. Config is nested, while the form renderer
 * works on a flat record, so this module maps between the two and picks
 * friendlier units (Mbit/s, seconds) for the UI.
 */
export const settingsFields: ParamField[] = [
  { kind: 'number', key: 'width', label: 'Video width', unit: 'px', min: 160, max: 7680, step: 2 },
  { kind: 'number', key: 'height', label: 'Video height', unit: 'px', min: 90, max: 4320, step: 2 },
  { kind: 'number', key: 'fps', label: 'Frame rate', unit: 'fps', min: 1, max: 120, step: 1 },
  { kind: 'number', key: 'bitrateMbps', label: 'Bitrate', unit: 'Mbit/s', min: 0.5, max: 200, step: 0.5 },
  { kind: 'number', key: 'maximumScreenSpaceError', label: 'Tile detail (lower = sharper)', min: 0.5, max: 16, step: 0.5 },
  { kind: 'number', key: 'tileCacheSize', label: 'Tile cache', unit: 'tiles', min: 100, max: 10_000, step: 100 },
  {
    kind: 'select',
    key: 'msaaSamples',
    label: 'Anti-aliasing (MSAA)',
    options: [
      { value: '1', label: 'Off' },
      { value: '2', label: '2×' },
      { value: '4', label: '4×' },
      { value: '8', label: '8×' },
    ],
  },
  { kind: 'number', key: 'tileLoadTimeoutSec', label: 'Tile load timeout', unit: 's', min: 1, max: 300, step: 1 },
  { kind: 'date', key: 'date', label: 'Date (sun position)' },
  { kind: 'number', key: 'hourOfDay', label: 'Local solar time', unit: 'h', min: 0, max: 24, step: 0.5 },
  {
    kind: 'select',
    key: 'weather',
    label: 'Weather',
    options: [
      { value: 'clear', label: 'Clear' },
      { value: 'partlyCloudy', label: 'Partly cloudy' },
      { value: 'overcast', label: 'Overcast' },
      { value: 'foggy', label: 'Foggy' },
    ],
  },
];

export function configToSettings(config: Config): Params {
  return {
    width: config.video.width,
    height: config.video.height,
    fps: config.video.fps,
    bitrateMbps: config.video.bitrate / 1e6,
    maximumScreenSpaceError: config.quality.maximumScreenSpaceError,
    tileCacheSize: config.quality.tileCacheSize,
    msaaSamples: String(config.quality.msaaSamples),
    tileLoadTimeoutSec: config.tileLoadTimeoutMs / 1000,
    date: config.environment.date,
    hourOfDay: config.environment.hourOfDay,
    weather: config.environment.weather,
  };
}

/** Writes validated settings back into the (mutable) config in place. */
export function applySettings(settings: Params, config: Config): void {
  config.video.width = Math.round(settings.width as number);
  config.video.height = Math.round(settings.height as number);
  config.video.fps = Math.round(settings.fps as number);
  config.video.bitrate = Math.round((settings.bitrateMbps as number) * 1e6);
  config.quality.maximumScreenSpaceError = settings.maximumScreenSpaceError as number;
  config.quality.tileCacheSize = Math.round(settings.tileCacheSize as number);
  config.quality.msaaSamples = Number(settings.msaaSamples);
  config.tileLoadTimeoutMs = Math.round((settings.tileLoadTimeoutSec as number) * 1000);
  config.environment.date = settings.date as string;
  config.environment.hourOfDay = settings.hourOfDay as number;
  config.environment.weather = settings.weather as Weather;
}
