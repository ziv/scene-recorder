import * as Cesium from 'cesium';

export interface MapMarker {
  key: string;
  label: string;
  /** CSS colour. */
  color: string;
  lat: number;
  lon: number;
}

export interface FlightMap {
  /** Replaces the point markers. */
  setMarkers(markers: MapMarker[]): void;
  /** Draws the camera's ground track (ECEF positions; heights are ignored). Empty clears it. */
  setTrack(positions: Cesium.Cartesian3[]): void;
  /** Which marker the next map click will place; null disables picking. */
  setArmed(key: string | null): void;
  /** Zooms the map to show every marker and the track. */
  fitAll(): void;
  /** Blocks picking (e.g. while recording). */
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

export interface FlightMapOptions {
  /** Called with the picked lat/lon when the user clicks the map while a marker is armed. */
  onPick: (key: string, lat: number, lon: number) => void;
}

/**
 * A small 2D map (labelled aerial imagery, with a place-name search box) used
 * to pick scene points by clicking. Independent of the recording viewer, so
 * the main viewport can keep showing the camera preview.
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

  const markerEntities = new Map<string, Cesium.Entity>();
  let markerPositions: Cesium.Cartographic[] = [];
  let trackPositions: Cesium.Cartographic[] = [];

  const trackEntity = viewer.entities.add({
    show: false,
    polyline: {
      positions: [],
      width: 10,
      material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.YELLOW),
    },
  });

  let armed: string | null = null;
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
    setMarkers(markers) {
      const seen = new Set<string>();
      for (const m of markers) {
        seen.add(m.key);
        const position = Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 0);
        const color = Cesium.Color.fromCssColorString(m.color);
        let entity = markerEntities.get(m.key);
        if (!entity) {
          entity = viewer.entities.add({
            position,
            point: { pixelSize: 12, color, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
            label: {
              text: m.label,
              font: '13px system-ui, sans-serif',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -16),
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            },
          });
          markerEntities.set(m.key, entity);
        } else {
          entity.position = new Cesium.ConstantPositionProperty(position);
          entity.point!.color = new Cesium.ConstantProperty(color);
          entity.label!.text = new Cesium.ConstantProperty(m.label);
        }
      }
      for (const [key, entity] of markerEntities) {
        if (!seen.has(key)) {
          viewer.entities.remove(entity);
          markerEntities.delete(key);
        }
      }
      markerPositions = markers.map((m) => Cesium.Cartographic.fromDegrees(m.lon, m.lat));
      scene.requestRender();
    },
    setTrack(positions) {
      trackPositions = positions.map((p) => Cesium.Cartographic.fromCartesian(p));
      const flat = trackPositions.map((c) => Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 0));
      trackEntity.show = flat.length >= 2;
      trackEntity.polyline!.positions = new Cesium.ConstantProperty(flat);
      scene.requestRender();
    },
    setArmed(key) {
      armed = key;
      updateCursor();
    },
    fitAll() {
      const all = [...markerPositions, ...trackPositions];
      if (all.length === 0) return;
      const rect = Cesium.Rectangle.fromCartographicArray(all);
      // Pad by half the span on each side, with a floor so a tiny scene still gets a sensible zoom.
      const padLon = Math.max(rect.width * 0.5, Cesium.Math.toRadians(0.01));
      const padLat = Math.max(rect.height * 0.5, Cesium.Math.toRadians(0.01));
      scene.camera.setView({
        destination: new Cesium.Rectangle(
          rect.west - padLon,
          Math.max(rect.south - padLat, -Cesium.Math.PI_OVER_TWO),
          rect.east + padLon,
          Math.min(rect.north + padLat, Cesium.Math.PI_OVER_TWO),
        ),
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
