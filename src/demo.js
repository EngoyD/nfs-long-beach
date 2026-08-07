// Demo mode world: flat neon city grid (no API key needed).
import * as THREE from 'three';

function windowTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 122; y += 10) {
    for (let x = 6; x < 58; x += 10) {
      if (Math.random() < 0.42) {
        ctx.fillStyle = Math.random() < 0.8 ? 'rgba(150,200,255,0.9)' : 'rgba(255,190,120,0.9)';
        ctx.fillRect(x, y, 6, 6);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

// circuitXZ: array of {x, z} — keep streets clear along the loop.
export function buildDemoWorld(scene, circuitXZ) {
  const world = new THREE.Group();

  // Ground with painted streets.
  const g = document.createElement('canvas');
  g.width = g.height = 2048;
  const ctx = g.getContext('2d');
  const WORLD = 4000; // meters covered by texture
  const toPx = (v) => (v / WORLD + 0.5) * 2048;
  ctx.fillStyle = '#101318';
  ctx.fillRect(0, 0, 2048, 2048);
  // street grid
  ctx.strokeStyle = '#1c2028';
  ctx.lineWidth = 14;
  for (let m = -WORLD / 2; m <= WORLD / 2; m += 90) {
    ctx.beginPath(); ctx.moveTo(toPx(m), 0); ctx.lineTo(toPx(m), 2048); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, toPx(m)); ctx.lineTo(2048, toPx(m)); ctx.stroke();
  }
  // circuit ribbon
  if (circuitXZ.length) {
    ctx.strokeStyle = '#12444f';
    ctx.lineWidth = 22;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= circuitXZ.length; i++) {
      const p = circuitXZ[i % circuitXZ.length];
      if (i === 0) ctx.moveTo(toPx(p.x), toPx(p.z));
      else ctx.lineTo(toPx(p.x), toPx(p.z));
    }
    ctx.stroke();
    ctx.strokeStyle = '#2ee6ff';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  const groundTex = new THREE.CanvasTexture(g);
  groundTex.anisotropy = 8;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  world.add(ground);

  // Buildings — deterministic placement, cleared off the circuit.
  const winTex = windowTexture();
  const colliders = new THREE.Group();
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let bx = -1200; bx <= 1200; bx += 90) {
    for (let bz = -1200; bz <= 1200; bz += 90) {
      if (rand() < 0.25) continue;
      const x = bx + (rand() - 0.5) * 20;
      const z = bz + (rand() - 0.5) * 20;
      let clear = true;
      for (let i = 0; i < circuitXZ.length; i++) {
        const a = circuitXZ[i];
        const b = circuitXZ[(i + 1) % circuitXZ.length];
        if (distToSegment(x, z, a.x, a.z, b.x, b.z) < 55) { clear = false; break; }
      }
      if (!clear) continue;
      const h = 14 + rand() * rand() * 85;
      const w = 26 + rand() * 24;
      const d = 26 + rand() * 24;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x11141c, roughness: 0.85,
        emissiveMap: winTex, emissive: 0x9fc8ff, emissiveIntensity: 0.55,
      });
      const box = new THREE.Mesh(boxGeo, mat);
      box.scale.set(w, h, d);
      box.position.set(x, h / 2, z);
      colliders.add(box);
    }
  }
  world.add(colliders);
  scene.add(world);
  return { world, colliders, ground };
}
