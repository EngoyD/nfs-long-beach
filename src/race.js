// GP circuit checkpoints, lap timing, checkpoint rings.
import * as THREE from 'three';

// Acura Grand Prix of Long Beach street circuit (2000–present layout).
// 11 turns, 1.968 mi, clockwise around the Convention Center. Coordinates
// snapped to OSM street centerlines (Overpass), cross-checked against the
// official gplb.com circuit map. Order = direction of travel.
export const CIRCUIT = [
  { name: 'Start/Finish — Shoreline Dr', lat: 33.76221, lon: -118.18733 },
  { name: 'Shoreline sweep — Shoreline Village', lat: 33.76177, lon: -118.18921 },
  { name: 'Front straight — Rainbow Harbor', lat: 33.76258, lon: -118.19197 },
  { name: 'T1 — Aquarium Way (Acura Turn)', lat: 33.76373, lon: -118.19458 },
  { name: 'T2–T3 — Fountain roundabout', lat: 33.76282, lon: -118.19603 },
  { name: 'T4 — Aquarium Way / Chestnut Pl', lat: 33.76343, lon: -118.19714 },
  { name: 'T5 — Chestnut / Shoreline Dr', lat: 33.76492, lon: -118.19660 },
  { name: 'Shoreline return stretch', lat: 33.76436, lon: -118.19545 },
  { name: 'T6 — Shoreline / Pine Ave', lat: 33.76307, lon: -118.19270 },
  { name: 'T7 — Pine Ave kink', lat: 33.76380, lon: -118.19239 },
  { name: 'T8 — Pine / Seaside Way', lat: 33.76584, lon: -118.19236 },
  { name: 'Seaside back straight', lat: 33.76587, lon: -118.18867 },
  { name: 'T9 — Seaside Way East', lat: 33.76566, lon: -118.18589 },
  { name: 'T10 — Infield bend', lat: 33.76412, lon: -118.18503 },
  { name: 'T11 — Hairpin', lat: 33.76433, lon: -118.18417 },
  { name: 'Hairpin exit — Shoreline Dr', lat: 33.76332, lon: -118.18541 },
];

export const LAPS = 3;
// Shoreline Dr carries the front straight and the T5–T6 return stretch on
// parallel carriageways only ~20-25 m apart — radius must stay under ~20 m
// so gates on one roadway can't trigger from the other.
const CP_RADIUS = 18;

export class Race {
  constructor(scene) {
    this.scene = scene;
    this.rings = [];
    this.worldPos = [];
    this.heightsPending = [];
    this.idx = 0;
    this.lap = 1;
    this.started = false;
    this.finished = false;
    this.tStart = 0;
    this.lapStart = 0;
    this.lastLap = null;
    this.best = Number(localStorage.getItem('nfslb_best')) || null;
    this.wrongWayTime = 0;
    this.arrow = null;
  }

  // worldPositions: Vector3[] matching CIRCUIT order (y = provisional).
  build(worldPositions) {
    this.dispose();
    this.worldPos = worldPositions.map((p) => p.clone());
    const ringGeo = new THREE.TorusGeometry(9, 0.45, 10, 40);
    for (let i = 0; i < this.worldPos.length; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x2ee6ff, transparent: true, opacity: 0.35, depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.position.copy(this.worldPos[i]);
      ring.position.y += 6;
      // face travel direction (toward next checkpoint)
      const next = this.worldPos[(i + 1) % this.worldPos.length];
      ring.lookAt(next.x, ring.position.y, next.z);
      this.scene.add(ring);
      this.rings.push(ring);
      this.heightsPending.push(i);
    }

    // Direction chevron floating above car.
    const arrowGeo = new THREE.ConeGeometry(0.5, 1.4, 4);
    arrowGeo.rotateX(Math.PI / 2); // point -Z? cone points +Y → after rotateX(PI/2) points +Z; flip via lookAt target
    this.arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xffb02e }));
    this.arrow.material.color.multiplyScalar(2);
    this.scene.add(this.arrow);
  }

  dispose() {
    for (const r of this.rings) this.scene.remove(r);
    if (this.arrow) this.scene.remove(this.arrow);
    this.rings = [];
    this.heightsPending = [];
  }

  // Snap ring heights to streamed ground; call periodically until done.
  refreshHeights(sampleGround) {
    this.heightsPending = this.heightsPending.filter((i) => {
      const ground = sampleGround(this.worldPos[i], 80);
      if (!ground) return true;
      this.worldPos[i].y = ground.y;
      this.rings[i].position.y = ground.y + 6;
      return false;
    });
  }

  start(now) {
    // spawn sits on cp0 — first gate is cp1, cp0 becomes the lap line
    this.idx = 1;
    this.lap = 1;
    this.started = true;
    this.finished = false;
    this.tStart = now;
    this.lapStart = now;
    this.tEnd = 0;
    this.lastLap = null;
    this.wrongWayTime = 0;
  }

  totalTime(now) {
    if (!this.started) return 0;
    return ((this.finished ? this.tEnd : now) - this.tStart) / 1000;
  }

  target() { return this.worldPos[this.idx]; }

  // Pose at any checkpoint, facing the next one.
  poseAt(i) {
    const p0 = this.worldPos[i % this.worldPos.length];
    const p1 = this.worldPos[(i + 1) % this.worldPos.length];
    const yaw = Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z));
    return { pos: p0.clone(), yaw };
  }

  spawnPose() {
    // Spawn at start line pointing at checkpoint 1.
    const p0 = this.worldPos[0];
    const p1 = this.worldPos[1 % this.worldPos.length];
    const yaw = Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z));
    return { pos: p0.clone(), yaw };
  }

  lastCheckpointPose() {
    const prev = (this.idx - 1 + this.worldPos.length) % this.worldPos.length;
    const p0 = this.worldPos[prev];
    const p1 = this.worldPos[this.idx];
    const yaw = Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z));
    return { pos: p0.clone(), yaw };
  }

  // Returns event: null | 'checkpoint' | 'lap' | 'finish'
  update(dt, now, carPos, carVel, freeRoam) {
    // ring pulse
    const t = now / 1000;
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      const isNext = i === this.idx && this.started && !this.finished && !freeRoam;
      const mat = ring.material;
      if (isNext) {
        mat.color.setHex(0xff2ea6);
        mat.opacity = 0.75 + Math.sin(t * 6) * 0.2;
        const s = 1 + Math.sin(t * 6) * 0.04;
        ring.scale.setScalar(s);
      } else {
        mat.color.setHex(0x2ee6ff);
        mat.opacity = freeRoam ? 0.12 : 0.3;
        ring.scale.setScalar(1);
      }
    }

    if (!this.started || this.finished || freeRoam) {
      if (this.arrow) this.arrow.visible = false;
      return null;
    }

    const target = this.target();

    // arrow above car
    if (this.arrow) {
      this.arrow.visible = true;
      this.arrow.position.set(carPos.x, carPos.y + 3.1, carPos.z);
      this.arrow.lookAt(target.x, carPos.y + 3.1, target.z);
    }

    // wrong-way detection
    const dx = target.x - carPos.x;
    const dz = target.z - carPos.z;
    const dist = Math.hypot(dx, dz);
    const speed = Math.hypot(carVel.x, carVel.z);
    if (speed > 6 && (carVel.x * dx + carVel.z * dz) / (dist || 1) < -4) {
      this.wrongWayTime += dt;
    } else {
      this.wrongWayTime = 0;
    }

    if (dist < CP_RADIUS) {
      // the lap completes when the start/finish gate (cp0) itself is crossed
      const crossedStart = this.idx === 0;
      this.idx = (this.idx + 1) % this.worldPos.length;
      if (crossedStart) {
        const lapTime = (now - this.lapStart) / 1000;
        this.lastLap = lapTime;
        this.lapStart = now;
        if (this.best === null || lapTime < this.best) {
          this.best = lapTime;
          localStorage.setItem('nfslb_best', String(lapTime));
        }
        if (this.lap >= LAPS) {
          this.finished = true;
          this.tEnd = now;
          return 'finish';
        }
        this.lap++;
        return 'lap';
      }
      return 'checkpoint';
    }
    return null;
  }

  get wrongWay() { return this.wrongWayTime > 2.2; }
}

export function formatTime(sec) {
  if (sec === null || sec === undefined || !isFinite(sec)) return '--:--.-';
  const t = Math.round(sec * 10) / 10; // pre-round so 119.97 → "2:00.0" not "1:60.0"
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
