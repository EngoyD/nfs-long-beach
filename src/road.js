// Game-quality asphalt ribbon draped over the photogrammetry along the circuit.
// The racing surface fills most of the screen — a crisp procedural road there
// upgrades perceived realism more than anything else.
import * as THREE from 'three';

const ROAD_WIDTH = 13;      // m
const SLICE_STEP = 4;       // m between cross-sections
const LIFT = 0.18;          // m above tile surface (beats z-fighting)
const V_REPEAT = 18;        // m of road per texture repeat

function asphaltTextures(maxAniso) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  // height noise reused for both albedo and the normal map
  const h = new Float32Array(512 * 512);
  for (let i = 0; i < h.length; i++) h[i] = Math.random();
  // blur a touch for coherent aggregate
  const hs = new Float32Array(512 * 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          s += h[((y + dy + 512) % 512) * 512 + ((x + dx + 512) % 512)];
        }
      }
      hs[y * 512 + x] = s / 9;
    }
  }
  const img = ctx.createImageData(512, 512);
  for (let i = 0; i < 512 * 512; i++) {
    const v = 46 + hs[i] * 26;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v + 1;
    img.data[i * 4 + 2] = v + 4;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // markings
  ctx.fillStyle = 'rgba(228,228,224,0.85)';
  ctx.fillRect(14, 0, 5, 512);
  ctx.fillRect(493, 0, 5, 512);
  ctx.fillStyle = 'rgba(230,230,225,0.7)';
  for (let y = 0; y < 512; y += 128) ctx.fillRect(254, y, 4, 52);
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAniso;
  map.colorSpace = THREE.SRGBColorSpace;

  // normal map via Sobel on the height noise
  const nc = document.createElement('canvas');
  nc.width = nc.height = 512;
  const nctx = nc.getContext('2d');
  const nimg = nctx.createImageData(512, 512);
  const at = (x, y) => hs[((y + 512) % 512) * 512 + ((x + 512) % 512)];
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const i = (y * 512 + x) * 4;
      nimg.data[i] = 128 + dx * 220;
      nimg.data[i + 1] = 128 + dy * 220;
      nimg.data[i + 2] = 255;
      nimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = maxAniso;
  return { map, normalMap };
}

function concreteTexture(maxAniso) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9b9c98';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const g = 130 + Math.random() * 50 | 0;
    ctx.fillStyle = `rgba(${g},${g},${g - 4},0.2)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // expansion joints
  ctx.strokeStyle = 'rgba(60,60,60,0.5)';
  ctx.lineWidth = 2;
  for (let x = 0; x < 256; x += 64) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function grassTexture(maxAniso) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3f7c33';
  ctx.fillRect(0, 0, 256, 256);
  // mow stripes
  for (let y = 0; y < 256; y += 64) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, y, 256, 32);
  }
  for (let i = 0; i < 9000; i++) {
    const g = 90 + Math.random() * 70 | 0;
    ctx.fillStyle = `rgba(${g * 0.45 | 0},${g},${g * 0.35 | 0},0.25)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const CURB_H = 0.13;
const WALK_W = 2.3;

export function buildRoad(scene, worldPoints, maxAniso = 16, lift = LIFT) {
  const curve = new THREE.CatmullRomCurve3(worldPoints, true, 'centripetal');
  const length = curve.getLength();
  const slices = Math.max(64, Math.ceil(length / SLICE_STEP));

  const centers = [];
  const sides = [];
  const up = new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let i = 0; i <= slices; i++) {
    const t = (i % slices) / slices;
    const p = curve.getPointAt(t);
    curve.getTangentAt(t, tangent);
    tangent.y = 0;
    tangent.normalize();
    side.crossVectors(tangent, up).normalize();
    centers.push(p.clone());
    sides.push({ x: side.x, z: side.z });
  }
  const n = centers.length;

  // ---- asphalt strip
  const aPos = new Float32Array(n * 2 * 3);
  const aUv = new Float32Array(n * 2 * 2);
  const aIdx = [];
  // ---- curb + sidewalk, both sides: per slice per side verts
  // [edge(y), curbTop(y+CURB_H), walkOuter(y+CURB_H)]
  const ePos = new Float32Array(n * 6 * 3);
  const eUv = new Float32Array(n * 6 * 2);
  const eIdx = [];
  // lawn verges (Shoreline stretches only): [walkOuter, lawnOuter(+7.5m)]
  const LAWN_W = 7.5;
  const LAWN_BANDS = [[0.0, 0.27], [0.40, 0.56]];
  const inBand = (i) => {
    const f = i / n;
    return LAWN_BANDS.some(([a, b]) => f >= a && f <= b);
  };
  const lPos = new Float32Array(n * 4 * 3);
  const lUv = new Float32Array(n * 4 * 2);
  const lIdx = [];

  function writeSlice(i) {
    const p = centers[i];
    const s = sides[i];
    const hw = ROAD_WIDTH / 2;
    const y = p.y + lift;
    const o = i * 6;
    aPos[o] = p.x - s.x * hw; aPos[o + 1] = y; aPos[o + 2] = p.z - s.z * hw;
    aPos[o + 3] = p.x + s.x * hw; aPos[o + 4] = y; aPos[o + 5] = p.z + s.z * hw;
    const eo = i * 18;
    for (const [k, sign] of [[0, -1], [1, 1]]) {
      const ex = p.x + s.x * hw * sign, ez = p.z + s.z * hw * sign;
      const wx = p.x + s.x * (hw + WALK_W) * sign, wz = p.z + s.z * (hw + WALK_W) * sign;
      const b = eo + k * 9;
      ePos[b] = ex; ePos[b + 1] = y; ePos[b + 2] = ez;
      ePos[b + 3] = ex; ePos[b + 4] = y + CURB_H; ePos[b + 5] = ez;
      ePos[b + 6] = wx; ePos[b + 7] = y + CURB_H; ePos[b + 8] = wz;
      const lb = i * 12 + k * 6;
      const lx = p.x + s.x * (hw + WALK_W + LAWN_W) * sign;
      const lz = p.z + s.z * (hw + WALK_W + LAWN_W) * sign;
      lPos[lb] = wx; lPos[lb + 1] = y + CURB_H + 0.01; lPos[lb + 2] = wz;
      lPos[lb + 3] = lx; lPos[lb + 4] = y + CURB_H - 0.06; lPos[lb + 5] = lz;
    }
  }

  for (let i = 0; i < n; i++) {
    writeSlice(i);
    const v = (i * SLICE_STEP) / V_REPEAT;
    aUv[i * 4] = 0; aUv[i * 4 + 1] = v;
    aUv[i * 4 + 2] = 1; aUv[i * 4 + 3] = v;
    const ev = (i * SLICE_STEP) / 6;
    for (let k = 0; k < 2; k++) {
      const ub = i * 12 + k * 6;
      eUv[ub] = 0; eUv[ub + 1] = ev;
      eUv[ub + 2] = 0.06; eUv[ub + 3] = ev;
      eUv[ub + 4] = 1; eUv[ub + 5] = ev;
    }
    if (i < n - 1) {
      const a = i * 2;
      aIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      for (let k = 0; k < 2; k++) {
        const b = i * 6 + k * 3;
        const c2 = b + 6;
        // curb face + sidewalk top
        eIdx.push(b, b + 1, c2, b + 1, c2 + 1, c2);
        eIdx.push(b + 1, b + 2, c2 + 1, b + 2, c2 + 2, c2 + 1);
      }
      if (inBand(i) && inBand(i + 1)) {
        for (let k = 0; k < 2; k++) {
          const b = i * 4 + k * 2;
          const c2 = b + 4;
          lIdx.push(b, b + 1, c2, b + 1, c2 + 1, c2);
        }
      }
    }
    const lv = (i * SLICE_STEP) / 8;
    for (let k = 0; k < 2; k++) {
      const ub = i * 8 + k * 4;
      lUv[ub] = 0; lUv[ub + 1] = lv;
      lUv[ub + 2] = 1; lUv[ub + 3] = lv;
    }
  }

  const { map, normalMap } = asphaltTextures(maxAniso);
  const aGeo = new THREE.BufferGeometry();
  aGeo.setAttribute('position', new THREE.BufferAttribute(aPos, 3));
  aGeo.setAttribute('uv', new THREE.BufferAttribute(aUv, 2));
  aGeo.setIndex(aIdx);
  aGeo.computeVertexNormals();
  const mesh = new THREE.Mesh(aGeo, new THREE.MeshStandardMaterial({
    map, normalMap, normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 0.93, metalness: 0.0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  scene.add(mesh);

  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  eGeo.setAttribute('uv', new THREE.BufferAttribute(eUv, 2));
  eGeo.setIndex(eIdx);
  eGeo.computeVertexNormals();
  const edges = new THREE.Mesh(eGeo, new THREE.MeshStandardMaterial({
    map: concreteTexture(maxAniso), roughness: 0.9, metalness: 0.0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  edges.receiveShadow = true;
  scene.add(edges);

  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3));
  lGeo.setAttribute('uv', new THREE.BufferAttribute(lUv, 2));
  lGeo.setIndex(lIdx);
  lGeo.computeVertexNormals();
  const lawn = new THREE.Mesh(lGeo, new THREE.MeshStandardMaterial({
    map: grassTexture(maxAniso), roughness: 0.95, metalness: 0.0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  lawn.receiveShadow = true;
  scene.add(lawn);

  let stable = 0;
  const draped = new Uint8Array(n);
  const groundY = new Float32Array(n);
  function redrape(sampleGround) {
    let moved = 0;
    let missing = 0;
    for (let i = 0; i < n; i++) {
      const ground = sampleGround(centers[i], 45);
      if (!ground) { missing++; continue; }
      if (!draped[i] || Math.abs(groundY[i] - ground.y) > 0.05) moved++;
      draped[i] = 1;
      groundY[i] = ground.y;
    }
    const sampledYs = [];
    for (let i = 0; i < n; i++) if (draped[i]) sampledYs.push(groundY[i]);
    if (sampledYs.length > 20) {
      sampledYs.sort((a, b) => a - b);
      const median = sampledYs[sampledYs.length >> 1];
      for (let i = 0; i < n; i++) if (!draped[i]) groundY[i] = median;
    } else if (missing > 0) {
      return false;
    }
    // median filter + low-pass around the closed loop
    const smooth = Float32Array.from(groundY);
    {
      const prev = Float32Array.from(smooth);
      const win = new Float32Array(5);
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 5; k++) win[k] = prev[(i + k - 2 + n) % n];
        win.sort();
        smooth[i] = win[2];
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      const prev = Float32Array.from(smooth);
      for (let i = 0; i < n; i++) {
        const a = prev[(i - 2 + n) % n];
        const b = prev[(i - 1 + n) % n];
        const c = prev[i];
        const d = prev[(i + 1) % n];
        const e = prev[(i + 2) % n];
        smooth[i] = (a + 2 * b + 3 * c + 2 * d + e) / 9;
      }
    }
    for (let i = 0; i < n; i++) {
      centers[i].y = smooth[i];
      writeSlice(i);
    }
    aGeo.attributes.position.needsUpdate = true;
    eGeo.attributes.position.needsUpdate = true;
    lGeo.attributes.position.needsUpdate = true;
    aGeo.computeVertexNormals();
    eGeo.computeVertexNormals();
    lGeo.computeVertexNormals();
    aGeo.computeBoundingSphere();
    eGeo.computeBoundingSphere();
    lGeo.computeBoundingSphere();
    stable = (moved === 0 && missing === 0) ? stable + 1 : 0;
    return stable >= 2;
  }

  return {
    mesh, edges, redrape, curve, centers, sides,
    get drapedFraction() {
      let c = 0;
      for (let i = 0; i < n; i++) c += draped[i];
      return c / n;
    },
  };
}

// Invisible collision strips for the whole OSM road network: the car rides
// these flat planes; the photogrammetry becomes visual-only on streets.
export function buildRoadNetwork(scene, roads, toWorld, y) {
  const positions = [];
  const pa = [0, 0], pb = [0, 0];
  for (const road of roads) {
    const half = (road.w || 10) / 2 + 1.5;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const A = toWorld(road.pts[i], pa);
      const B = toWorld(road.pts[i + 1], pb);
      const dx = B[0] - A[0], dz = B[1] - A[1];
      const len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * half, nz = (dx / len) * half;
      const ax1 = A[0] - nx, az1 = A[1] - nz, ax2 = A[0] + nx, az2 = A[1] + nz;
      const bx1 = B[0] - nx, bz1 = B[1] - nz, bx2 = B[0] + nx, bz2 = B[1] + nz;
      positions.push(
        ax1, y, az1, ax2, y, az2, bx1, y, bz1,
        ax2, y, az2, bx2, y, bz2, bx1, y, bz1,
      );
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (geo.computeBoundsTree) geo.computeBoundsTree();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
  scene.add(mesh);
  return mesh;
}

// Spatial index over the circuit centerline: query(x, z) → draped road Y if
// within `radius` meters of the racing line, else null. Used to flatten
// photogrammetry lumps (baked parked cars) on the racing surface.
export function buildCorridor(centers, radius = 7.5) {
  const CELL = 40;
  const grid = new Map();
  const key = (cx, cz) => cx + '_' + cz;
  const segs = [];
  for (let i = 0; i < centers.length - 1; i++) {
    const a = centers[i];
    const b = centers[i + 1];
    segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, y: (a.y + b.y) / 2 });
    const minX = Math.min(a.x, b.x) - radius, maxX = Math.max(a.x, b.x) + radius;
    const minZ = Math.min(a.z, b.z) - radius, maxZ = Math.max(a.z, b.z) + radius;
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = key(cx, cz);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(segs.length - 1);
      }
    }
  }
  const r2 = radius * radius;
  return {
    query(x, z) {
      const bucket = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!bucket) return null;
      for (const si of bucket) {
        const s = segs[si];
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const len2 = dx * dx + dz * dz || 1;
        let t = ((x - s.ax) * dx + (z - s.az) * dz) / len2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const px = s.ax + t * dx - x, pz = s.az + t * dz - z;
        if (px * px + pz * pz < r2) return s.y;
      }
      return null;
    },
  };
}
