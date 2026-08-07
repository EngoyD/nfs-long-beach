// Hero car: Ferrari 458 glTF (three.js examples) with procedural fallback + arcade drift physics.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export const TOP_SPEED = 75;        // m/s ≈ 168 mph
export const NITRO_TOP_SPEED = 92;  // m/s ≈ 206 mph

function smoothed(geo) {
  const merged = mergeVertices(geo, 1e-4);
  merged.computeVertexNormals();
  // degenerate triangles from shape closure produce NaN normals — one NaN
  // pixel poisons the whole bloom mip chain and blacks out the frame
  const n = merged.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    if (!Number.isFinite(n.getX(i)) || !Number.isFinite(n.getY(i)) || !Number.isFinite(n.getZ(i))) {
      n.setXYZ(i, 0, 1, 0);
    }
  }
  return merged;
}

// Radially streaked disc — what a spinning rim looks like to a camera.
function blurDiscTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.translate(64, 64);
  for (let i = 0; i < 260; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = 12 + Math.random() * 48;
    const arc = 0.25 + Math.random() * 0.7;
    const g = 90 + Math.random() * 90 | 0;
    ctx.strokeStyle = `rgba(${g},${g},${g + 8},${0.05 + Math.random() * 0.1})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.arc(0, 0, r0, a, a + arc);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function buildWheel(envMap, side) {
  // steer (yaw) → spin (roll) → geometry. Calipers live in steer: they don't spin.
  const steer = new THREE.Group();
  const spin = new THREE.Group();
  steer.add(spin);

  const tireMat = new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.96 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xd8dce2, metalness: 1.0, roughness: 0.28, envMap, envMapIntensity: 1.1,
  });
  const spokeMat = new THREE.MeshStandardMaterial({
    color: 0x23262d, metalness: 0.9, roughness: 0.4, envMap, envMapIntensity: 0.8,
    transparent: true,
  });

  const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.27, 28);
  tireGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(tireGeo, tireMat));

  // rim lip on the outboard face
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.028, 10, 26), rimMat);
  lip.rotation.y = Math.PI / 2;
  lip.position.x = side * 0.13;
  spin.add(lip);

  // five twin spokes
  const spokeGeo = new THREE.BoxGeometry(0.045, 0.2, 0.045);
  for (let s = 0; s < 5; s++) {
    const arm = new THREE.Group();
    arm.rotation.x = (s / 5) * Math.PI * 2;
    for (const dz of [-0.028, 0.028]) {
      const spoke = new THREE.Mesh(spokeGeo, spokeMat);
      spoke.position.set(side * 0.115, 0.115, dz);
      arm.add(spoke);
    }
    spin.add(arm);
  }

  // hub
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 12), rimMat);
  hub.rotation.z = Math.PI / 2;
  spin.add(hub);

  // motion-blur disc — crossfades in as spokes alias out
  const blurMat = new THREE.MeshBasicMaterial({
    map: blurDiscTexture(), transparent: true, opacity: 0, side: THREE.DoubleSide,
    depthWrite: false,
  });
  const blur = new THREE.Mesh(new THREE.CircleGeometry(0.33, 24), blurMat);
  blur.rotation.y = Math.PI / 2;
  blur.position.x = side * 0.142;
  spin.add(blur);

  // brake disc + caliper (caliper fixed to the upright — it must NOT spin)
  const discGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.028, 20);
  discGeo.rotateZ(Math.PI / 2);
  const disc = new THREE.Mesh(discGeo, new THREE.MeshStandardMaterial({
    color: 0x8a8e96, metalness: 0.9, roughness: 0.45, envMap, envMapIntensity: 0.6,
  }));
  spin.add(disc);
  const caliper = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.1, 0.16),
    new THREE.MeshStandardMaterial({ color: 0xc22c2c, roughness: 0.5 }),
  );
  caliper.position.set(side * 0.06, 0.1, -0.09);
  steer.add(caliper);

  return { steer, spin, spokeMat, blurMat };
}

export function buildCar(envMap) {
  const group = new THREE.Group();

  const paint = new THREE.MeshPhysicalMaterial({
    color: 0x1670e8, metalness: 0.85, roughness: 0.26,
    clearcoat: 1.0, clearcoatRoughness: 0.06,
    envMap, envMapIntensity: 1.0,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x0b0d12, metalness: 0.55, roughness: 0.45, envMap, envMapIntensity: 0.55,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x06090e, metalness: 1.0, roughness: 0.04,
    envMap, envMapIntensity: 1.6,
  });

  // ---- Body hull: side-profile spline extruded across the width, smoothed.
  // Shape space: +x = front (rotated onto -Z below), +y = up.
  const hull = new THREE.Shape();
  hull.moveTo(2.28, 0.18);            // front bumper bottom
  hull.lineTo(2.36, 0.3);
  hull.quadraticCurveTo(2.38, 0.44, 2.24, 0.5);   // nose
  hull.quadraticCurveTo(1.6, 0.56, 1.05, 0.62);   // hood
  hull.quadraticCurveTo(0.6, 0.66, 0.2, 0.7);     // cowl
  hull.quadraticCurveTo(-0.9, 0.78, -1.6, 0.78);  // beltline / haunch
  hull.quadraticCurveTo(-2.1, 0.78, -2.28, 0.7);  // deck
  hull.lineTo(-2.32, 0.32);                        // tail face
  hull.lineTo(-2.2, 0.18);                         // rear bottom (auto-closes)

  const hullGeo = new THREE.ExtrudeGeometry(hull, {
    depth: 1.46, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.16,
    bevelSegments: 4, steps: 1, curveSegments: 10,
  });
  hullGeo.translate(0, 0, -0.73);
  const body = new THREE.Mesh(smoothed(hullGeo), paint);
  body.rotation.y = -Math.PI / 2; // shape +x → -Z (car forward)
  group.add(body);

  // ---- Greenhouse: same trick, darker glass hull.
  const canopy = new THREE.Shape();
  canopy.moveTo(0.62, 0.68);
  canopy.quadraticCurveTo(0.3, 0.98, -0.1, 1.04);   // windshield
  canopy.quadraticCurveTo(-0.65, 1.1, -1.0, 1.02);  // roof
  canopy.quadraticCurveTo(-1.55, 0.86, -1.85, 0.72); // fastback (auto-closes)
  const canopyGeo = new THREE.ExtrudeGeometry(canopy, {
    depth: 1.1, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.1,
    bevelSegments: 3, steps: 1, curveSegments: 8,
  });
  canopyGeo.translate(0, 0, -0.55);
  const cabin = new THREE.Mesh(smoothed(canopyGeo), glassMat);
  cabin.rotation.y = -Math.PI / 2;
  group.add(cabin);

  // ---- Aero details.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.36), darkMat);
  wing.position.set(0, 1.0, 2.0);
  wing.rotation.x = -0.1;
  group.add(wing);
  for (const sx of [-0.62, 0.62]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.16), darkMat);
    strut.position.set(sx, 0.86, 2.02);
    group.add(strut);
  }
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.07, 0.5), darkMat);
  splitter.position.set(0, 0.16, -2.28);
  group.add(splitter);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.12, 0.38), darkMat);
  diffuser.position.set(0, 0.18, 2.22);
  group.add(diffuser);

  // ---- Lights.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  headMat.color.multiplyScalar(4);
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff1a2e });
  tailMat.color.multiplyScalar(3);
  for (const sx of [-0.58, 0.58]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.08), headMat);
    hl.position.set(sx, 0.47, -2.32);
    hl.rotation.x = 0.3;
    group.add(hl);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.06, 0.06), tailMat);
  tail.position.set(0, 0.72, 2.3);
  group.add(tail);

  // ---- Wheels.
  const wheelDefs = [
    { x: -0.82, z: -1.45, side: -1, front: true },
    { x: 0.82, z: -1.45, side: 1, front: true },
    { x: -0.82, z: 1.5, side: -1, front: false },
    { x: 0.82, z: 1.5, side: 1, front: false },
  ];
  const wheels = [];
  for (const def of wheelDefs) {
    const w = buildWheel(envMap, def.side);
    w.steer.position.set(def.x, 0.35, def.z);
    w.front = def.front;
    group.add(w.steer);
    wheels.push(w);
  }

  // ---- Underglow + headlight spots + night light cones.
  const glow = new THREE.PointLight(0xff2ea6, 30, 7);
  glow.position.set(0, 0.15, 0);
  group.add(glow);

  const spots = [];
  const cones = [];
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xbcd8ff, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  for (const sx of [-0.55, 0.55]) {
    const spot = new THREE.SpotLight(0xeaf4ff, 60, 70, 0.45, 0.5, 1.2);
    spot.position.set(sx, 0.5, -2.2);
    spot.target.position.set(sx, 0.1, -25);
    group.add(spot);
    group.add(spot.target);
    spots.push(spot);

    const coneGeo = new THREE.ConeGeometry(1.7, 13, 16, 1, true);
    coneGeo.rotateX(-Math.PI / 2); // point down -Z... cone tip toward car
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(sx, 0.45, -2.3 - 6.5);
    cones.push(cone);
    group.add(cone);
  }

  // ---- Soft blob shadow.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.32)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.16)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 5.4),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  shadow.renderOrder = 2;
  group.add(shadow);

  const exhausts = [new THREE.Vector3(-0.45, 0.3, 2.35), new THREE.Vector3(0.45, 0.3, 2.35)];

  group.traverse((o) => { if (o.isMesh && o !== shadow) o.castShadow = true; });

  let wheelAngle = 0;
  const api = {
    group, paint, glassMat, exhausts, glow, spots,
    wheelRoots: wheels.map((w) => w.steer),
    rearWheels: [wheels[2].steer, wheels[3].steer],

    // spin + steer + spoke/blur crossfade (fixes wagon-wheel aliasing)
    updateWheels(dt, forwardSpeed, steerVisual) {
      wheelAngle += (forwardSpeed / 0.34) * dt;
      const blurT = THREE.MathUtils.clamp((Math.abs(forwardSpeed) - 5) / 9, 0, 1);
      for (const w of wheels) {
        w.spin.rotation.x = wheelAngle;
        if (w.front) w.steer.rotation.y = steerVisual;
        w.spokeMat.opacity = 1 - blurT * 0.85;
        w.blurMat.opacity = blurT * 0.5;
      }
    },

    setBrake(on) {
      tailMat.color.setHex(0xff1a2e).multiplyScalar(on ? 7 : 3);
    },

    setNight(on) {
      for (const s of spots) s.intensity = on ? 160 : 60;
      glow.intensity = on ? 45 : 30;
      coneMat.opacity = on ? 0.055 : 0;
      headMat.color.setHex(0xffffff).multiplyScalar(on ? 6 : 4);
    },
  };
  return api;
}

const _fwd = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class CarPhysics {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.vy = 0;
    this.grounded = true;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.nitro = 100;
    this.nitroActive = false;
    this.drifting = false;
    this.speed = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.steerVisual = 0;
    this.airTime = 0;
    this.crashImpulse = 0; // consumed by fx/audio each frame
  }

  forward(target = _fwd) {
    // yaw = 0 → -Z (three.js "forward").
    return target.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  place(pos, yaw) {
    this.pos.copy(pos);
    this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.drifting = false;
  }

  update(dt, input, sampleGround, sampleObstacles) {
    this.crashImpulse = 0;
    const fwd = this.forward();
    let fSpeed = this.vel.dot(fwd);
    _lat.copy(this.vel).addScaledVector(fwd, -fSpeed);
    let lSpeed = _lat.length();

    // --- Nitro ---
    const wantNitro = input.nitro && this.nitro > 2 && input.throttle > 0;
    this.nitroActive = wantNitro;
    if (this.nitroActive) {
      this.nitro = Math.max(0, this.nitro - 32 * dt);
    } else {
      this.nitro = Math.min(100, this.nitro + (this.drifting ? 16 : 5.5) * dt);
    }

    const topSpeed = this.nitroActive ? NITRO_TOP_SPEED : TOP_SPEED;

    // --- Longitudinal forces ---
    if (input.throttle > 0) {
      let accel = 21 * (1 - Math.max(0, fSpeed / topSpeed) * 0.82);
      if (this.nitroActive) accel *= 1.6;
      if (fSpeed < 0) accel = 30; // braking out of reverse
      this.vel.addScaledVector(fwd, accel * dt);
    }
    if (input.brake > 0) {
      if (fSpeed > 0.8) {
        this.vel.addScaledVector(fwd, -32 * dt); // brake
      } else {
        this.vel.addScaledVector(fwd, -11 * dt); // reverse
        if (this.vel.dot(fwd) < -13) this.vel.addScaledVector(fwd, 11 * dt);
      }
    }
    if (input.handbrake && fSpeed > 0.5) {
      this.vel.addScaledVector(fwd, -Math.min(14, fSpeed * 2) * dt);
    }

    // Drag + rolling resistance.
    const v = this.vel.length();
    if (v > 0.01) {
      const drag = 0.0022 * v * v + 0.35;
      this.vel.addScaledVector(_tmp.copy(this.vel).normalize(), -Math.min(drag * dt, v));
    }

    // --- Drift state ---
    if (input.handbrake && Math.abs(fSpeed) > 10) this.drifting = true;
    if (lSpeed > 7.5) this.drifting = true;
    if (lSpeed < 2.6 && !input.handbrake) this.drifting = false;

    // --- Steering ---
    const speedAbs = Math.abs(fSpeed);
    const steerFactor = Math.min(speedAbs / 9, 1) / (1 + speedAbs * 0.016);
    let yawRate = input.steer * 2.35 * steerFactor;
    if (this.drifting) yawRate *= 1.45;
    if (fSpeed < -0.5) yawRate = -yawRate; // reversing
    this.yaw += yawRate * dt;
    this.steerVisual += ((input.steer * 0.45) - this.steerVisual) * Math.min(1, dt * 10);

    // --- Lateral grip (recompute after yaw change) ---
    const fwd2 = this.forward();
    fSpeed = this.vel.dot(fwd2);
    _lat.copy(this.vel).addScaledVector(fwd2, -fSpeed);
    lSpeed = _lat.length();
    const grip = (input.handbrake || this.drifting) ? 1.7 : 8.5;
    const decay = Math.exp(-grip * dt);
    this.vel.copy(_lat.multiplyScalar(decay)).addScaledVector(fwd2, fSpeed);

    // --- Obstacles ---
    if (sampleObstacles) {
      const hits = sampleObstacles(this.pos, fwd2, this.vel, dt);
      for (const hit of hits) {
        const vn = this.vel.dot(hit.normal);
        if (vn < 0) {
          this.crashImpulse = Math.max(this.crashImpulse, -vn);
          this.vel.addScaledVector(hit.normal, -vn * 1.15); // remove + slight bounce
          this.vel.multiplyScalar(0.94);
          // push out of the surface
          this.pos.addScaledVector(hit.normal, Math.max(0, hit.push ?? 0));
        }
      }
    }

    // --- Integrate horizontal ---
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // --- Ground ---
    const ground = sampleGround(this.pos);
    if (ground) {
      this.airTime = 0;
      const targetY = ground.y;
      if (this.pos.y <= targetY + 0.05) {
        this.pos.y = targetY;
        this.vy = 0;
        this.grounded = true;
      } else if (this.pos.y - targetY < 1.2 && this.vy <= 0.5) {
        // glue to ground over small drops/crests
        this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * 14);
        this.vy = 0;
        this.grounded = true;
      } else {
        this.vy -= 22 * dt;
        this.pos.y += this.vy * dt;
        this.grounded = this.pos.y <= targetY;
        if (this.grounded) { this.pos.y = targetY; this.vy = 0; }
      }
      this.groundNormal.lerp(ground.normal, Math.min(1, dt * 8)).normalize();
    } else {
      this.airTime += dt;
      this.vy -= 22 * dt;
      this.pos.y += this.vy * dt;
      this.grounded = false;
      this.groundNormal.lerp(UP, Math.min(1, dt * 3)).normalize();
    }

    this.forwardSpeed = fSpeed;
    this.lateralSpeed = lSpeed;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
  }
}

// ---- Real car: Ferrari 458 Italia from the three.js examples repo.
// Returns the same API shape as buildCar; throws if the model is unavailable
// so the caller can keep the procedural fallback.
export async function loadRealCar(envMap) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  loader.setDRACOLoader(draco);
  // BASE_URL keeps assets resolvable when deployed under a subpath (Pages)
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}ferrari.glb`);
  const model = gltf.scene.children[0];

  const paint = new THREE.MeshPhysicalMaterial({
    color: 0x1670e8, metalness: 1.0, roughness: 0.45,
    clearcoat: 1.0, clearcoatRoughness: 0.03,
    envMap, envMapIntensity: 1.0,
  });
  const detailsMat = new THREE.MeshStandardMaterial({
    color: 0xd8dce2, metalness: 1.0, roughness: 0.4, envMap, envMapIntensity: 1.0,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0.25, roughness: 0,
    transmission: 1.0, transparent: true, envMap, envMapIntensity: 1.0,
  });

  const bodyMesh = model.getObjectByName('body');
  if (!bodyMesh) throw new Error('unexpected model layout');
  bodyMesh.material = paint;
  for (const n of ['rim_fl', 'rim_fr', 'rim_rl', 'rim_rr', 'trim']) {
    const o = model.getObjectByName(n);
    if (o) o.material = detailsMat;
  }
  const glassMesh = model.getObjectByName('glass');
  if (glassMesh) glassMesh.material = glassMat;

  const group = new THREE.Group();
  group.add(model);

  // Orient: game forward is -Z; flip if the model's front wheels sit at +Z.
  const wheelNodes = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']
    .map((n) => model.getObjectByName(n));
  if (wheelNodes.some((w) => !w)) throw new Error('missing wheel nodes');
  if (wheelNodes[0].position.z > 0) model.rotation.y = Math.PI;

  // Scale sanity: expect ~4.5m length.
  const bbox = new THREE.Box3().setFromObject(group);
  const len = bbox.max.z - bbox.min.z;
  if (len < 2 || len > 10) group.scale.setScalar(4.5 / len);
  bbox.setFromObject(group);

  model.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // Wrap front wheels in steer groups; add blur discs to all wheels.
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const wheel = wheelNodes[i];
    const parent = wheel.parent;
    const steer = new THREE.Group();
    steer.position.copy(wheel.position);
    parent.add(steer);
    wheel.position.set(0, 0, 0);
    steer.add(wheel);

    const wb = new THREE.Box3().setFromObject(wheel);
    const radius = (wb.max.y - wb.min.y) / 2;
    const width = wb.max.x - wb.min.x;
    const side = Math.sign(steer.position.x) || 1;
    const blurMat = new THREE.MeshBasicMaterial({
      map: blurDiscTexture(), transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const blur = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.94, 24), blurMat);
    blur.rotation.y = Math.PI / 2;
    blur.position.x = side * (width / 2 + 0.005);
    steer.add(blur);

    wheels.push({ steer, spin: wheel, blurMat, front: i < 2 });
  }

  // Light bars (the model has no emissive lights).
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  headMat.color.multiplyScalar(4);
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff1a2e });
  tailMat.color.multiplyScalar(3);
  const rearZ = bbox.max.z;
  const frontZ = bbox.min.z;
  for (const sx of [-0.62, 0.62]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.06), headMat);
    hl.position.set(sx, 0.62, frontZ + 0.08);
    group.add(hl);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.04, 0.04), tailMat);
  tail.position.set(0, 0.72, rearZ - 0.03);
  group.add(tail);

  // Underglow, headlight spots, night beam cones.
  const glow = new THREE.PointLight(0xff2ea6, 22, 4.5);
  glow.position.set(0, 0.08, 0);
  group.add(glow);
  const spots = [];
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xbcd8ff, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  for (const sx of [-0.55, 0.55]) {
    const spot = new THREE.SpotLight(0xeaf4ff, 60, 70, 0.45, 0.5, 1.2);
    spot.position.set(sx, 0.6, frontZ + 0.15);
    spot.target.position.set(sx, 0.1, frontZ - 25);
    group.add(spot);
    group.add(spot.target);
    spots.push(spot);
    const coneGeo = new THREE.ConeGeometry(1.7, 13, 16, 1, true);
    coneGeo.rotateX(-Math.PI / 2);
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(sx, 0.5, frontZ - 6.5);
    group.add(cone);
  }

  // Soft blob shadow.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.32)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.16)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 5.6),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  shadow.renderOrder = 2;
  group.add(shadow);

  const exhausts = [
    new THREE.Vector3(-0.35, 0.4, rearZ - 0.12),
    new THREE.Vector3(0.35, 0.4, rearZ - 0.12),
  ];

  let wheelAngle = 0;
  const wheelR = 0.34;
  return {
    group, paint, glassMat, exhausts, glow, spots,
    wheelRoots: wheels.map((w) => w.steer),
    rearWheels: [wheels[2].steer, wheels[3].steer],
    updateWheels(dt, forwardSpeed, steerVisual) {
      wheelAngle += (forwardSpeed / wheelR) * dt;
      const blurT = THREE.MathUtils.clamp((Math.abs(forwardSpeed) - 5) / 9, 0, 1);
      for (const w of wheels) {
        w.spin.rotation.x = wheelAngle;
        if (w.front) w.steer.rotation.y = steerVisual;
        w.blurMat.opacity = blurT * 0.45;
      }
    },
    setBrake(on) {
      tailMat.color.setHex(0xff1a2e).multiplyScalar(on ? 7 : 3);
    },
    setNight(on) {
      for (const s of spots) s.intensity = on ? 160 : 60;
      glow.intensity = on ? 34 : 22;
      coneMat.opacity = on ? 0.055 : 0;
      headMat.color.setHex(0xffffff).multiplyScalar(on ? 6 : 4);
    },
  };
}
