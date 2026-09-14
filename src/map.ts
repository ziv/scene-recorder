import * as Cesium from 'cesium';
import type { Waypoint } from './config';

export type PointKind = 'start' | 'end';

export interface FlightMap {
  /** Moves the start/end markers and the connecting arrow. */
  setPoints(start: Waypoint, end: Waypoint): void;
  /** Which point the next map click will place; null disables picking. */
  setArmed(kind: PointKind | null): void;
  /** Zooms the map to show both points. */
  fitTo(start: Waypoint, end: Waypoint): void;
  /** Blocks picking (e.g. while recording). */
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

export interface FlightMapOptions {
  /** Called with the picked lat/lon when the user clicks the map while a point is armed. */
  onPick: (kind: PointKind, lat: number, lon: number) => void;
}

/**
 * A small 2D map (labelled aerial imagery, with a place-name search box) used
 * to pick the flight's start and end points by clicking. Independent of the
 * recording viewer, so the main viewport can keep showing the camera preview.
 */
export function createFlightMap(container: HTMLElement, options: FlightMapOptions): FlightMap {
  const viewer = new Cesium.Viewer(container, {
    sceneMode: Cesium.SceneMode.SCENE2D,
    mapProjection: new Cesium.WebMercatorProjection(),
    // Cesium ion world imagery with place labels, so the map is readable.
    baseLayer: Cesium.ImageryLayer.fromProviderAsync(
      Cesium.IonImageryProvider.fromAssetId(Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS),
    ),
    // Only redraw when something changes; the map is mostly static.
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    geocoder: true,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    creditContainer: document.createElement('div'),
  });
  const scene = viewer.scene;
  const canvas = scene.canvas;

  const startEntity = viewer.entities.add({
    position: Cesium.Cartesian3.ZERO,
    point: { pixelSize: 12, color: Cesium.Color.LIME, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
    label: labelFor('Start'),
  });
  const endEntity = viewer.entities.add({
    position: Cesium.Cartesian3.ZERO,
    point: { pixelSize: 12, color: Cesium.Color.RED, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
    label: labelFor('End'),
  });
  const lineEntity = viewer.entities.add({
    polyline: {
      positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
      width: 10,
      material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.YELLOW),
    },
  });

  let armed: PointKind | null = null;
  let enabled = true;

  const handler = new Cesium.ScreenSpaceEventHandler(canvas);
  handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    if (!armed || !enabled) return;
    const picked = scene.camera.pickEllipsoid(event.position, scene.ellipsoid);
    if (!picked) return;
    const carto = Cesium.Cartographic.fromCartesian(picked);
    options.onPick(armed, Cesium.Math.toDegrees(carto.latitude), Cesium.Math.toDegrees(carto.longitude));
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  const updateCursor = () => {
    canvas.style.cursor = armed && enabled ? 'crosshair' : '';
  };

  return {
    setPoints(start, end) {
      const s = Cesium.Cartesian3.fromDegrees(start.lon, start.lat, 0);
      const e = Cesium.Cartesian3.fromDegrees(end.lon, end.lat, 0);
      startEntity.position = new Cesium.ConstantPositionProperty(s);
      endEntity.position = new Cesium.ConstantPositionProperty(e);
      lineEntity.polyline!.positions = new Cesium.ConstantProperty([s, e]);
      scene.requestRender();
    },
    setArmed(kind) {
      armed = kind;
      updateCursor();
    },
    fitTo(start, end) {
      const west = Math.min(start.lon, end.lon);
      const east = Math.max(start.lon, end.lon);
      const south = Math.min(start.lat, end.lat);
      const north = Math.max(start.lat, end.lat);
      // Pad by half the span on each side, with a floor so identical points still get a sensible zoom.
      const padLon = Math.max((east - west) * 0.5, 0.01);
      const padLat = Math.max((north - south) * 0.5, 0.01);
      scene.camera.setView({
        destination: Cesium.Rectangle.fromDegrees(west - padLon, south - padLat, east + padLon, north + padLat),
      });
      scene.requestRender();
    },
    setEnabled(value) {
      enabled = value;
      updateCursor();
    },
    destroy() {
      handler.destroy();
      viewer.destroy();
    },
  };
}

function labelFor(text: string): Cesium.LabelGraphics.ConstructorOptions {
  return {
    text,
    font: '13px system-ui, sans-serif',
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 3,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new Cesium.Cartesian2(0, -16),
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
  };
}
