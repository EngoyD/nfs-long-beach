// Clean-city world v2: real Long Beach footprints (OSM) rendered as a night
// city — emissive window facades, streetlights, glossy harbor water, palms.
// Zero photogrammetry artifacts by construction.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { geoToWorldFlat } from './tiles.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const _v = new THREE.Vector3();

function toXZ(lonlat) {
  geoToWorldFlat(lonlat[1], lonlat[0], _v);
  return [_v.x, _v.z];
}

// ---- Realistic facade texture builders (512px, world scale ~3.6m/tile) ----
function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  return [c, c.getContext('2d')];
}

function finishTex(c, maxAniso) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Glass curtain-wall tower: mullion grid, sky-gradient panes, some floors lit.
function glassFacade(seed, maxAniso, tintTop, tintBottom) {
  const rand = seededRand(seed);
  const [ac, a] = makeCanvas();
  const [ec, e] = makeCanvas();
  a.fillStyle = '#181c22';
  a.fillRect(0, 0, 512, 512);
  e.fillStyle = '#000';
  e.fillRect(0, 0, 512, 512);
  const cols = 8, rows = 11;
  const cw = 512 / cols, rh = 512 / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cw + 3, y = r * rh + 3, w = cw - 6, h = rh - 6;
      const g = a.createLinearGradient(0, y, 0, y + h);
      const j = (rand() - 0.5) * 18 | 0;
      g.addColorStop(0, tintTop(j));
      g.addColorStop(1, tintBottom(j));
      a.fillStyle = g;
      a.fillRect(x, y, w, h);
      // pane sheen
      a.fillStyle = 'rgba(255,255,255,0.07)';
      a.fillRect(x, y, w, 3);
      if (rand() < 0.22) {
        e.fillStyle = rand() < 0.75 ? '#ffd9a0' : '#cfe4ff';
        e.fillRect(x, y, w, h);
      }
    }
  }
  return { at: finishTex(ac, maxAniso), et: finishTex(ec, maxAniso) };
}

// Concrete office: floor bands, punched windows with frames and sill shadows.
function concreteFacade(seed, maxAniso, base) {
  const rand = seededRand(seed);
  const [ac, a] = makeCanvas();
  const [ec, e] = makeCanvas();
  a.fillStyle = base;
  a.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5000; i++) {
    const g = 120 + rand() * 90 | 0;
    a.fillStyle = `rgba(${g},${g - 6},${g - 14},0.10)`;
    a.fillRect(rand() * 512, rand() * 512, 3, 3);
  }
  e.fillStyle = '#000';
  e.fillRect(0, 0, 512, 512);
  const rows = 9, cols = 7;
  const rh = 512 / rows, cw = 512 / cols;
  for (let r = 0; r < rows; r++) {
    // floor line
    a.fillStyle = 'rgba(0,0,0,0.18)';
    a.fillRect(0, r * rh, 512, 3);
    for (let col = 0; col < cols; col++) {
      const x = col * cw + 12, y = r * rh + 12, w = cw - 24, h = rh - 22;
      a.fillStyle = '#33373d';
      a.fillRect(x - 3, y - 3, w + 6, h + 6); // frame
      const g = a.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#54626f');
      g.addColorStop(1, '#2c343d');
      a.fillStyle = g;
      a.fillRect(x, y, w, h);
      a.fillStyle = 'rgba(0,0,0,0.3)';
      a.fillRect(x - 3, y + h + 3, w + 6, 4); // sill shadow
      if (rand() < 0.18) {
        e.fillStyle = '#ffd9a0';
        e.fillRect(x, y, w, h);
      }
    }
  }
  return { at: finishTex(ac, maxAniso), et: finishTex(ec, maxAniso) };
}

// Low retail: storefront glass + colored sign band + stucco upper windows.
function retailFacade(seed, maxAniso) {
  const rand = seededRand(seed);
  const [ac, a] = makeCanvas();
  const [ec, e] = makeCanvas();
  a.fillStyle = '#c4b8a6';
  a.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) {
    const g = 150 + rand() * 70 | 0;
    a.fillStyle = `rgba(${g},${g - 8},${g - 20},0.12)`;
    a.fillRect(rand() * 512, rand() * 512, 3, 3);
  }
  e.fillStyle = '#000';
  e.fillRect(0, 0, 512, 512);
  // ground floor = bottom band of the tile (v wraps every ~3.6m; ground floor
  // dominates low buildings so give the lower half storefront treatment)
  a.fillStyle = '#232830';
  a.fillRect(0, 300, 512, 212);
  for (let s = 0; s < 4; s++) {
    const x = s * 128 + 10;
    a.fillStyle = '#3d4c5c';
    a.fillRect(x, 316, 108, 180);
    a.fillStyle = 'rgba(255,255,255,0.08)';
    a.fillRect(x, 316, 108, 8);
    const hue = ((rand() * 360) | 0);
    a.fillStyle = `hsl(${hue},60%,45%)`;
    a.fillRect(x, 300, 108, 14); // sign band
    if (rand() < 0.6) {
      e.fillStyle = `hsl(${hue},80%,62%)`;
      e.fillRect(x, 300, 108, 14);
      e.fillStyle = 'rgba(255,220,170,0.5)';
      e.fillRect(x, 316, 108, 180);
    }
  }
  // upper windows
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 6; col++) {
      const x = col * 85 + 16, y = r * 95 + 18, w = 54, h = 62;
      a.fillStyle = '#3a3d42';
      a.fillRect(x - 3, y - 3, w + 6, h + 6);
      a.fillStyle = '#37424e';
      a.fillRect(x, y, w, h);
      if (rand() < 0.25) {
        e.fillStyle = '#ffd9a0';
        e.fillRect(x, y, w, h);
      }
    }
  }
  return { at: finishTex(ac, maxAniso), et: finishTex(ec, maxAniso) };
}

// Rooftop: gravel + AC units — what you actually see from above.
function roofTexture(maxAniso) {
  const rand = seededRand(909);
  const [c, ctx] = makeCanvas();
  ctx.fillStyle = '#7a7b7c';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16000; i++) {
    const g = 100 + rand() * 60 | 0;
    ctx.fillStyle = `rgba(${g},${g},${g},0.25)`;
    ctx.fillRect(rand() * 512, rand() * 512, 2, 2);
  }
  for (let i = 0; i < 6; i++) {
    const x = rand() * 400 + 20, y = rand() * 400 + 20, s = 28 + rand() * 40;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + 5, y + 5, s, s);
    ctx.fillStyle = '#9a9da0';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#6e7174';
    ctx.fillRect(x + 4, y + 4, s - 8, s - 8);
  }
  return finishTex(c, maxAniso);
}

// Box-project UVs: walls get (along-wall, height) so the facade grid lands
// upright; roofs get a small-scale top projection.
function boxProjectUVs(geo, wallScale = 3.6) {
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i);
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (Math.abs(ny) > 0.7) {
      uv[i * 2] = x / 8;
      uv[i * 2 + 1] = z / 8;
    } else {
      uv[i * 2] = (x * nz - z * nx) / wallScale;
      uv[i * 2 + 1] = y / wallScale;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function buildCleanCity(scene, city, circuitXZ, maxAniso = 8, envMap = null) {
  const world = new THREE.Group();
  const night = { mats: [], lights: [] };

  // ---------- Ground: dark asphalt city floor with painted roads + water.
  const WORLD = 4200;
  const TEX = 4096;
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d');
  const px = (x) => (x / WORLD + 0.5) * TEX;
  const pz = (z) => (z / WORLD + 0.5) * TEX;
  ctx.fillStyle = '#2b2f38';
  ctx.fillRect(0, 0, TEX, TEX);
  for (let i = 0; i < 26000; i++) {
    const g = 28 + Math.random() * 34 | 0;
    ctx.fillStyle = `rgba(${g},${g},${g + 6},0.25)`;
    ctx.fillRect(Math.random() * TEX, Math.random() * TEX, 2, 2);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const drawRoad = (road, color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, (width / WORLD) * TEX);
    ctx.beginPath();
    road.pts.forEach((ll, i) => {
      const [x, z] = toXZ(ll);
      if (i === 0) ctx.moveTo(px(x), pz(z));
      else ctx.lineTo(px(x), pz(z));
    });
    ctx.stroke();
  };
  for (const road of city.roads || []) drawRoad(road, '#34373e', road.w + 6); // shoulders
  for (const road of city.roads || []) drawRoad(road, '#44474e', road.w);
  ctx.setLineDash([10, 12]);
  for (const road of city.roads || []) {
    if (road.w >= 12) drawRoad(road, 'rgba(220,215,190,0.5)', 0.7);
  }
  ctx.setLineDash([]);
  const groundTex = new THREE.CanvasTexture(c);
  groundTex.anisotropy = maxAniso;
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.94 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  // ---------- Water: glossy dark harbor planes.
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x0d2438, metalness: 0.85, roughness: 0.12,
  });
  for (const ring of city.water || []) {
    try {
      const shape = new THREE.Shape();
      ring.forEach((ll, i) => {
        const [x, z] = toXZ(ll);
        if (i === 0) shape.moveTo(x, -z);
        else shape.lineTo(x, -z);
      });
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, waterMat);
      mesh.position.y = 0.06;
      world.add(mesh);
    } catch { /* skip bad ring */ }
  }

  // ---------- Buildings: real-life material styles per height band.
  // Retail (<12m): storefront glass + sign bands. Offices (12-30m): punched
  // concrete windows. Towers (30m+): reflective glass curtain wall.
  const styles = [
    { max: 12, ...retailFacade(11, maxAniso), roughness: 0.8, metalness: 0.05 },
    { max: 30, ...concreteFacade(22, maxAniso, '#b5ad9f'), roughness: 0.75, metalness: 0.06 },
    {
      max: 70,
      ...glassFacade(33, maxAniso,
        (j) => `rgb(${127 + j},${168 + j},${200 + j})`,
        (j) => `rgb(${74 + j},${106 + j},${136 + j})`),
      roughness: 0.3, metalness: 0.55,
    },
    {
      max: 1e9,
      ...glassFacade(44, maxAniso,
        (j) => `rgb(${140 + j},${160 + j},${178 + j})`,
        (j) => `rgb(${70 + j},${88 + j},${108 + j})`),
      roughness: 0.25, metalness: 0.6,
    },
  ];
  const bands = styles.map((s) => {
    const mat = new THREE.MeshStandardMaterial({
      map: s.at, emissiveMap: s.et, emissive: 0xffffff, emissiveIntensity: 0.12,
      roughness: s.roughness, metalness: s.metalness, envMap: envMap || null,
      envMapIntensity: envMap ? 0.7 : 0,
    });
    night.mats.push(mat);
    return { max: s.max, mat, geos: [] };
  });
  const roofMat = new THREE.MeshStandardMaterial({
    map: roofTexture(maxAniso), roughness: 0.95, metalness: 0.0,
  });
  for (const b of city.buildings || []) {
    if (!b.pts || b.pts.length < 3) continue;
    const shape = new THREE.Shape();
    b.pts.forEach((ll, i) => {
      const [x, z] = toXZ(ll);
      if (i === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    try {
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      bands.find((bd) => b.h <= bd.max).geos.push(geo);
    } catch { /* skip degenerate footprint */ }
  }
  const colliders = new THREE.Group();
  const _pA = new THREE.Vector3(), _pB = new THREE.Vector3(), _pC = new THREE.Vector3();
  const _ab = new THREE.Vector3(), _cb = new THREE.Vector3();
  for (const band of bands) {
    if (!band.geos.length) continue;
    const merged = mergeGeometries(band.geos, false);
    merged.computeVertexNormals();
    boxProjectUVs(merged);
    // split roofs from walls so roofs get gravel/AC instead of windows
    // (merged extrudes are non-indexed: triangle t = vertices 3t..3t+2)
    const posA = merged.attributes.position;
    const wallIdx = [];
    const roofIdx = [];
    for (let t = 0; t < posA.count; t += 3) {
      _pA.fromBufferAttribute(posA, t);
      _pB.fromBufferAttribute(posA, t + 1);
      _pC.fromBufferAttribute(posA, t + 2);
      _cb.subVectors(_pC, _pB);
      _ab.subVectors(_pA, _pB);
      _cb.cross(_ab);
      const up = Math.abs(_cb.y) / (_cb.length() || 1);
      (up > 0.6 ? roofIdx : wallIdx).push(t, t + 1, t + 2);
    }
    for (const [indices, mat] of [[wallIdx, band.mat], [roofIdx, roofMat]]) {
      if (!indices.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', merged.attributes.position);
      geo.setAttribute('normal', merged.attributes.normal);
      geo.setAttribute('uv', merged.attributes.uv);
      geo.setIndex(indices);
      geo.computeBoundsTree();
      colliders.add(new THREE.Mesh(geo, mat));
    }
    band.geos.forEach((g) => g.dispose());
  }
  world.add(colliders);

  // ---------- Streetlights along major roads (instanced).
  {
    const spots = [];
    let seed = 777;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    outer:
    for (const road of city.roads || []) {
      if (road.w < 12) continue;
      let acc = 0;
      for (let i = 0; i < road.pts.length - 1; i++) {
        const [ax, az] = toXZ(road.pts[i]);
        const [bx, bz] = toXZ(road.pts[i + 1]);
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len, nz = dx / len;
        acc += len;
        if (acc > 36) {
          acc = 0;
          const side = rand() < 0.5 ? 1 : -1;
          const off = road.w / 2 + 1.6;
          spots.push({ x: bx + nx * off * side, z: bz + nz * off * side });
          if (spots.length >= 1400) break outer;
        }
      }
    }
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 6.4, 6);
    poleGeo.translate(0, 3.2, 0);
    const headGeo = new THREE.SphereGeometry(0.22, 8, 6);
    headGeo.translate(0, 6.5, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.7 });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    headMat.color.multiplyScalar(4); // blooms at night
    night.lights.push(headMat);
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, spots.length);
    const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => {
      m.makeTranslation(s.x, 0, s.z);
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
    });
    world.add(poles, heads);
  }

  // ---------- Palms along the circuit.
  if (circuitXZ && circuitXZ.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 7, 6);
    trunkGeo.translate(0, 3.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a4036, roughness: 0.9 });
    const frondGeo = new THREE.ConeGeometry(2.1, 1.2, 7);
    frondGeo.translate(0, 7.2, 0);
    const frondMat = new THREE.MeshStandardMaterial({
      color: 0x2c4a30, roughness: 0.85, flatShading: true,
    });
    let seed = 4242;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const spots = [];
    for (let i = 0; i < circuitXZ.length; i += 2) {
      const a = circuitXZ[i];
      const b = circuitXZ[(i + 1) % circuitXZ.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len;
      for (const side of [-1, 1]) {
        if (rand() < 0.45) continue;
        const off = 11 + rand() * 5;
        spots.push({ x: a.x + nx * off * side, z: a.z + nz * off * side, s: 0.8 + rand() * 0.5, r: rand() * Math.PI * 2 });
      }
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const fronds = new THREE.InstancedMesh(frondGeo, frondMat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    spots.forEach((s, i) => {
      q.setFromAxisAngle(up, s.r);
      m.compose(new THREE.Vector3(s.x, 0, s.z), q, new THREE.Vector3(s.s, s.s, s.s));
      trunks.setMatrixAt(i, m);
      fronds.setMatrixAt(i, m);
    });
    world.add(trunks, fronds);
  }

  scene.add(world);
  return {
    world,
    colliders,
    ground,
    setNight(on) {
      for (const m of night.mats) m.emissiveIntensity = on ? 1.15 : 0.12;
      for (const m of night.lights) m.color.setHex(0xffd9a0).multiplyScalar(on ? 4 : 1);
    },
  };
}
