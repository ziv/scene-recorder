# High Resolution Scene Recorder

## Overview

A world viewer using Cesium.js with pre-defined path that record the "flying" in a high-res video.

The app should allow me to start it by clicking and it will start the flying along the path and record the scene.

## Path

- Configurable starting point and end point
- The flying is in straight line, no need for special movement
- The flying is in constant speed

For example
- target: lat/lon and height above ground
- start position: (1000m north, 100m south, 400m height) from target

## Configuration

- Path details
- Speed details

## Optimization Consideration

- How to avoid poping tiles
- Should we use render frame by frame to let tiles load before capturing the image?
- Use 4K if there is
- Use the best quality imagery Cesium can provide
- Should we capture the canvas or frame by frame?