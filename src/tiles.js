// Google Photorealistic 3D Tiles setup + geo → world helpers.
import * as THREE from 'three';
import { TilesRenderer, WGS84_ELLIPSOID } from '3d-tiles-renderer';
import {
  GoogleCloudAuthPlugin,
  GLTFExtensionsPlugin,
  TileCompressionPlugin,
  TilesFadePlugin,
  ReorientationPlugin,
} from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const { DEG2RAD } = THREE.MathUtils;

// World origin: midpoint of the Shoreline Drive main straight (OSM-verified,
// centered on the road) — GP circuit front straight, downtown Long Beach.
export const ORIGIN = { lat: 33.763887, lon: -118.194702 };

// Per-tile geometry cleanup, in world space.
// A) Remove palm-spires/poles and floating canopies: connected components that
//    are NARROW (footprint guard keeps terrain/buildings untouchable) and
//    either tall or airborne. Google reconstructs palms as melted spikes.
// B) Flatten photogrammetry lumps (baked parked cars) on the racing corridor.
const _w = new THREE.Vector3();
const _invM = new THREE.Matrix4();

function processTileMesh(mesh, corridor, treeGrid) {
  const geo = mesh.geometry;
  if (!geo || !geo.index || !geo.attributes.position) return;
  const pos = geo.attributes.position;
  const vCount = pos.count;
  if (vCount < 64 || vCount > 400000) return;
  try {
    mesh.updateWorldMatrix(true, false);
    const mw = mesh.matrixWorld;
    _invM.copy(mw).invert();
    const wx = new Float32Array(vCount);
    const wy = new Float32Array(vCount);
    const wz = new Float32Array(vCount);
    let tileMinY = Infinity;
    for (let i = 0; i < vCount; i++) {
      _w.fromBufferAttribute(pos, i).applyMatrix4(mw);
      wx[i] = _w.x; wy[i] = _w.y; wz[i] = _w.z;
      if (_w.y < tileMinY) tileMinY = _w.y;
    }

    // --- B) flatten lumps on the racing corridor
    if (corridor) {
      let dirty = false;
      for (let i = 0; i < vCount; i++) {
        const roadY = corridor.query(wx[i], wz[i]);
        if (roadY === null) continue;
        if (wy[i] > roadY + 0.25 && wy[i] < roadY + 3.2) {
          _w.set(wx[i], roadY + 0.2, wz[i]).applyMatrix4(_invM);
          pos.setXYZ(i, _w.x, _w.y, _w.z);
          dirty = true;
        }
      }
      if (dirty) pos.needsUpdate = true;
    }

    // --- C) sink Google's melted tree-spikes at known OSM tree positions
    // (an authored palm gets planted there instead — see palms.js)
    if (treeGrid) {
      const hits = [];
      let minY = Infinity;
      for (let i = 0; i < vCount; i++) {
        if (treeGrid.query(wx[i], wz[i])) {
          hits.push(i);
          if (wy[i] < minY) minY = wy[i];
        }
      }
      if (hits.length > 8) {
        let dirty = false;
        const capY = minY + 0.45;
        for (const i of hits) {
          if (wy[i] > capY) {
            _w.set(wx[i], capY, wz[i]).applyMatrix4(_invM);
            pos.setXYZ(i, _w.x, _w.y, _w.z);
            dirty = true;
          }
        }
        if (dirty) pos.needsUpdate = true;
      }
    }
  } catch (e) {
    console.warn('processTileMesh skipped:', e);
  }
}

// getTint: () => hex — applied to every streamed tile material (day = white,
// night = dark blue-gray; unlit Basic materials multiply map × color).
// getCorridor: () => corridor | null (see road.js buildCorridor).
export function createTiles(apiKey, camera, renderer, getTint = () => 0xffffff, getCorridor = () => null, getTreeGrid = () => null) {
  const tiles = new TilesRenderer();
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
  tiles.registerPlugin(new TileCompressionPlugin());
  // short fades, tight budget: lingering fade-out tiles hang in mid-air as
  // ghost chunks while driving — a quick pop reads better than floating debris
  tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: 180, maximumFadeOutTiles: 16 }));

  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));

  // Put the origin lat/lon at scene origin, Y-up.
  tiles.registerPlugin(new ReorientationPlugin({
    lat: ORIGIN.lat * DEG2RAD,
    lon: ORIGIN.lon * DEG2RAD,
    height: 0,
    recenter: true,
  }));

  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.errorTarget = 12;
  tiles.downloadQueue.maxJobs = 40;
  tiles.parseQueue.maxJobs = 12;

  // Max anisotropic filtering on every streamed texture — kills the smeared
  // "melting" look on road/ground at grazing angles.
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  tiles.addEventListener('load-model', ({ scene: tileScene }) => {
    tileScene.traverse((o) => {
      if (o.isMesh && o.material && o.material.map) {
        o.material.map.anisotropy = maxAniso;
        o.material.map.needsUpdate = true;
        o.material.color.setHex(getTint());
      }
      if (o.isMesh) processTileMesh(o, getCorridor(), getTreeGrid());
    });
  });
  // big cache: keep the whole preloaded downtown resident
  tiles.lruCache.minSize = 2500;
  tiles.lruCache.maxSize = 4500;
  return tiles;
}

const _cart = new THREE.Vector3();

// Exact geo → world using the tileset transform (valid once root tileset loaded).
export function geoToWorld(tiles, latDeg, lonDeg, height, target = new THREE.Vector3()) {
  WGS84_ELLIPSOID.getCartographicToPosition(latDeg * DEG2RAD, lonDeg * DEG2RAD, height, _cart);
  tiles.group.updateMatrixWorld();
  return target.copy(_cart).applyMatrix4(tiles.group.matrixWorld);
}

// World → lat/lon (for the live map minimap).
const _invMat = new THREE.Matrix4();
const _ecef = new THREE.Vector3();
const _cartOut = { lat: 0, lon: 0, height: 0 };
const RAD2DEG = THREE.MathUtils.RAD2DEG;

export function worldToGeo(tiles, pos, target = {}) {
  _invMat.copy(tiles.group.matrixWorld).invert();
  _ecef.copy(pos).applyMatrix4(_invMat);
  WGS84_ELLIPSOID.getPositionToCartographic(_ecef, _cartOut);
  target.lat = _cartOut.lat * RAD2DEG;
  target.lon = _cartOut.lon * RAD2DEG;
  return target;
}

// Flat approximation for demo mode (no tiles): east = +X, north = -Z, origin at ORIGIN.
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320 * Math.cos(ORIGIN.lat * DEG2RAD);

export function flatToGeo(pos, target = {}) {
  target.lat = ORIGIN.lat - pos.z / M_PER_DEG_LAT;
  target.lon = ORIGIN.lon + pos.x / M_PER_DEG_LON;
  return target;
}

export function geoToWorldFlat(latDeg, lonDeg, target = new THREE.Vector3()) {
  target.set(
    (lonDeg - ORIGIN.lon) * M_PER_DEG_LON,
    0,
    -(latDeg - ORIGIN.lat) * M_PER_DEG_LAT,
  );
  return target;
}
