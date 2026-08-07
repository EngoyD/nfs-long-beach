// Authored palms planted at real OSM tree positions ON TOP of the Google
// photogrammetry (whose own melted tree-spikes get sunk flat in tiles.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function frondTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.strokeStyle = '#3d5226';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(2, 32);
  ctx.quadraticCurveTo(140, 27, 253, 33);
  ctx.stroke();
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    const x = 8 + t * 240;
    const len = 27 * (1 - Math.abs(t - 0.42) * 0.85) + 3;
    const g = 78 + Math.random() * 46 | 0;
    ctx.strokeStyle = `rgb(${26 + (g >> 2)},${g + 26},${26 + (g >> 3)})`;
    ctx.lineWidth = 1.9;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x, 32);
      ctx.quadraticCurveTo(x + 5, 32 + s * len * 0.6, x + 9 + Math.random() * 3, 32 + s * len);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// One merged palm: tall bent trunk + 12 drooping fronds + upright crown tuft.
function palmGeometry() {
  const H = 11.5;
  const LEAN = 1.7;
  const trunk = new THREE.CylinderGeometry(0.11, 0.24, H, 7, 10);
  trunk.translate(0, H / 2, 0);
  {
    const pos = trunk.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const k = (y / H) ** 1.8;
      pos.setX(i, pos.getX(i) + k * LEAN);
      // subtle trunk ring bulges
      const ring = 1 + Math.sin(y * 3.1) * 0.045;
      pos.setZ(i, pos.getZ(i) * ring);
    }
    trunk.computeVertexNormals();
  }
  const topX = LEAN;
  const topY = H;

  const mkFrond = (len, w, droop) => {
    const p = new THREE.PlaneGeometry(len, w, 8, 1);
    const pos = p.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const t = (x + len / 2) / len;
      pos.setY(i, pos.getY(i) - t * t * droop);
    }
    p.computeVertexNormals();
    p.translate(len / 2 - 0.15, 0, 0);
    return p;
  };
  const fronds = [];
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  // main drooping ring
  for (let i = 0; i < 12; i++) {
    const g = mkFrond(4.3, 1.05, 1.5 + (i % 3) * 0.5);
    e.set(0, (i / 12) * Math.PI * 2 + 0.26, -0.05 - (i % 4) * 0.12, 'YXZ');
    m.makeRotationFromEuler(e);
    m.setPosition(topX, topY - 0.1, 0);
    g.applyMatrix4(m);
    fronds.push(g);
  }
  // upright crown tuft
  for (let i = 0; i < 5; i++) {
    const g = mkFrond(2.6, 0.8, 0.5);
    e.set(0, (i / 5) * Math.PI * 2, 0.75, 'YXZ');
    m.makeRotationFromEuler(e);
    m.setPosition(topX, topY + 0.05, 0);
    g.applyMatrix4(m);
    fronds.push(g);
  }
  const frondGeo = mergeGeometries(fronds, false);
  fronds.forEach((g) => g.dispose());
  return { trunkGeo: trunk, frondGeo };
}

export function buildPalms(scene, worldPts, groundY = 0) {
  const { trunkGeo, frondGeo } = palmGeometry();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a7357, roughness: 0.92 });
  const frondMat = new THREE.MeshStandardMaterial({
    map: frondTexture(), alphaTest: 0.3, side: THREE.DoubleSide,
    roughness: 0.85, color: 0xffffff,
  });
  const n = worldPts.length;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  const fronds = new THREE.InstancedMesh(frondGeo, frondMat, n);
  trunks.castShadow = fronds.castShadow = false;
  scene.add(trunks, fronds);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const rot = (i * 2.399) % (Math.PI * 2);   // golden-angle variety
    const scale = 0.75 + ((i * 7919) % 100) / 100 * 0.55;
    q.setFromAxisAngle(up, rot);
    m.compose(
      new THREE.Vector3(worldPts[i].x, groundY, worldPts[i].z),
      q,
      new THREE.Vector3(scale, scale, scale),
    );
    trunks.setMatrixAt(i, m);
    fronds.setMatrixAt(i, m);
  }
  trunks.instanceMatrix.needsUpdate = true;
  fronds.instanceMatrix.needsUpdate = true;

  return { trunks, fronds, pending: 0, refresh() {} };
}

// Spatial lookup used by the tile processor to sink Google's melted tree
// spikes at known tree positions.
export function buildTreeGrid(worldPts, radius = 4.5) {
  const CELL = 24;
  const grid = new Map();
  const key = (cx, cz) => cx + '_' + cz;
  for (const p of worldPts) {
    const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const r2 = radius * radius;
  return {
    query(x, z) {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(key(cx + dx, cz + dz));
          if (!bucket) continue;
          for (const p of bucket) {
            const ddx = p.x - x, ddz = p.z - z;
            if (ddx * ddx + ddz * ddz < r2) return true;
          }
        }
      }
      return false;
    },
  };
}
