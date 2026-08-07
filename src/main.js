// NFS: Long Beach — main orchestration.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';

import { createTiles, geoToWorld, geoToWorldFlat, worldToGeo, flatToGeo } from './tiles.js';
import { SlippyMap } from './minimap.js';
import { buildCar, loadRealCar, CarPhysics, TOP_SPEED, NITRO_TOP_SPEED } from './car.js';
import { input, pressed, updateInput, onFirstInteraction } from './input.js';
import { Race, CIRCUIT, formatTime } from './race.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { SmokePool, NitroFlames, SpeedLines, ScreenShake } from './fx.js';
import { buildDemoWorld } from './demo.js';
import { buildCleanCity } from './cleanCity.js';
import { buildRoad, buildCorridor, buildRoadNetwork } from './road.js';
import { buildPalms, buildTreeGrid } from './palms.js';
import circuitPath from './circuit-path.json';

const KEY_STORAGE = 'nfslb_gmaps_key';
const QUALITY_STORAGE = 'nfslb_quality';
const QUALITIES = [
  { name: 'ULTRA', errorTarget: 3 },
  { name: 'HIGH', errorTarget: 8 },
  { name: 'MED', errorTarget: 16 },
  { name: 'LOW', errorTarget: 30 },
];
const DEFAULT_QUALITY = 0; // ULTRA — cruising speeds leave streaming headroom

// ---------- Renderer / scene ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.86;
renderer.domElement.classList.add('game');
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 30000);
camera.position.set(0, 4, 10);

scene.fog = new THREE.FogExp2(0xc9cdd2, 0.00026);

// Physical atmosphere (Preetham) — sun disc, haze, correct horizon falloff.
const sky = new Sky();
sky.scale.setScalar(450000);
scene.add(sky);
const skyU = sky.material.uniforms;
skyU.turbidity.value = 2.5;
skyU.rayleigh.value = 1.1;
skyU.mieCoefficient.value = 0.0015;
skyU.mieDirectionalG.value = 0.8;

const hemi = new THREE.HemisphereLight(0xbdd4ff, 0x8a7c68, 1.05);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xffe0b0, 2.0);
scene.add(sunLight);
scene.add(sunLight.target);

// Real car shadow: tight shadow frustum follows the car; an invisible
// ShadowMaterial disc under it catches the shadow (unlit tiles can't).
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(1024, 1024);
sunLight.shadow.camera.left = -8;
sunLight.shadow.camera.right = 8;
sunLight.shadow.camera.top = 8;
sunLight.shadow.camera.bottom = -8;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 300;
sunLight.shadow.bias = -0.0006;
sunLight.shadow.radius = 5; // soft penumbra
const shadowCatcher = new THREE.Mesh(
  new THREE.CircleGeometry(7, 24),
  new THREE.ShadowMaterial({ opacity: 0.4 }),
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.receiveShadow = true;
shadowCatcher.renderOrder = 1;
scene.add(shadowCatcher);

const _sunDir = new THREE.Vector3();
function setSun(elevationDeg, azimuthDeg) {
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(azimuthDeg);
  _sunDir.setFromSphericalCoords(1, phi, theta);
  skyU.sunPosition.value.copy(_sunDir);
  sunLight.position.copy(_sunDir).multiplyScalar(600);
  sunLight.intensity = elevationDeg > 0 ? 2.0 : 0.15;
  hemi.intensity = elevationDeg > 0 ? 1.05 : 0.3;
}
setSun(24, 55); // golden-hour sun — flatters photogrammetry, warm long light

// ---------- Time of day ----------
// Night is the NFS look — and darkness turns photogrammetry artifacts into
// silhouettes. Tiles are unlit, so night = tinting every tile material dark
// blue and letting emissives + the lit road ribbon carry the scene.
const TOD_STORAGE = 'nfslb_tod';
let nightMode = (localStorage.getItem(TOD_STORAGE) ?? 'day') === 'night';
const TILE_TINT_NIGHT = 0x8290b8;

function tileTint() { return nightMode ? TILE_TINT_NIGHT : 0xffffff; }

function applyTimeOfDay() {
  if (nightMode) {
    setSun(-5, 60);
    scene.fog.color.setHex(0x0a111f);
    scene.fog.density = 0.00065;
    hemi.color.setHex(0x5d6da8);
    hemi.groundColor.setHex(0x232a3a);
    hemi.intensity = 0.95;
    sunLight.intensity = 0.12;
    bloom.strength = 0.62;
  } else {
    setSun(24, 55);
    scene.fog.color.setHex(0xc9cdd2);
    scene.fog.density = 0.00026;
    hemi.color.setHex(0xbdd4ff);
    hemi.groundColor.setHex(0x8a7c68);
    hemi.intensity = 1.05;
    sunLight.intensity = 2.0;
    bloom.strength = 0.45;
  }
  car.setNight(nightMode);
  if (tiles) {
    tiles.group.traverse((o) => {
      if (o.isMesh && o.material && o.material.map) o.material.color.setHex(tileTint());
    });
  }
  if (demo && demo.setNight) demo.setNight(nightMode);
  localStorage.setItem(TOD_STORAGE, nightMode ? 'night' : 'day');
}

// Environment reflections for the car: RoomEnvironment until the world exists,
// then a live cube camera that reflects the actual city.
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const cubeRT = new THREE.WebGLCubeRenderTarget(128, {
  generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
});
const cubeCam = new THREE.CubeCamera(1, 4000, cubeRT);
cubeCam.layers.set(0); // sees world only — car meshes live on layer 1
scene.add(cubeCam);

// ---------- Post-processing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// Subtle far-field depth of field — softens distant tile LOD artifacts.
const bokeh = new BokehPass(scene, camera, {
  focus: 30, aperture: 0.00003, maxblur: 0.0045,
});
composer.addPass(bokeh);

// (No SSAO: Google photogrammetry carries real photographed occlusion —
// screen-space AO on top reads as dirt and broke to black on unlit tiles.)

// Bloom runs pre-tonemap on LINEAR HDR values — the Preetham sky reaches ~2-3
// there, so the threshold must sit above it or the whole horizon smears white.
// Only true emissives (headlights ×4, nitro flames ×5) may bloom.
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.5, 3.0,
);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const fxaa = new ShaderPass(FXAAShader);
composer.addPass(fxaa);

// Final cinematic pass: unsharp mask (crisps photogrammetry), radial motion
// blur (speed/nitro), filmic grade, vignette, grain.
const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },
    motion: { value: 0 },
    sharpness: { value: 0.4 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float time;
    uniform float motion;
    uniform float sharpness;
    varying vec2 vUv;
    vec3 tap(vec2 uv) { return texture2D(tDiffuse, uv).rgb; }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 px = 1.0 / resolution;
      vec2 dir = vUv - 0.5;
      vec3 col = tap(vUv);
      // unsharp mask
      vec3 blur4 = (tap(vUv + vec2(px.x, 0.)) + tap(vUv - vec2(px.x, 0.))
                  + tap(vUv + vec2(0., px.y)) + tap(vUv - vec2(0., px.y))) * 0.25;
      col += (col - blur4) * sharpness;
      // radial motion blur, stronger at screen edges
      float amt = motion * smoothstep(0.12, 0.85, length(dir));
      if (amt > 0.0005) {
        vec3 sum = col;
        for (int i = 1; i <= 5; i++) sum += tap(vUv - dir * amt * (float(i) / 5.0));
        col = sum / 6.0;
      }
      // grade: gentle contrast, saturation, warm highlights / cool shadows
      col = clamp(col, 0.0, 1.0);
      col = (col - 0.5) * 1.09 + 0.5;
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(luma), col, 1.26);
      col += (luma - 0.5) * vec3(0.050, 0.018, -0.038);
      // vignette + grain
      col *= mix(0.86, 1.0, smoothstep(0.95, 0.35, length(dir)));
      col += (hash(vUv * resolution + mod(time, 97.0)) - 0.5) * 0.022;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
const cinematic = new ShaderPass(CinematicShader);
composer.addPass(cinematic);

function setSize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const pr = renderer.getPixelRatio();
  fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  cinematic.material.uniforms.resolution.value.set(w * pr, h * pr);
  if (tiles) tiles.setResolutionFromRenderer(camera, renderer);
}
window.addEventListener('resize', setSize);

// ---------- Game objects ----------
let car = buildCar(envMap);
scene.add(car.group);
camera.layers.enable(1);
sunLight.layers.enable(1);
hemi.layers.enable(1);

// car meshes on layer 1 so the reflection cube camera (layer 0) skips them
function rigCar(c) {
  c.group.traverse((o) => { if (o.isMesh) o.layers.set(1); });
  c.spots.forEach((s) => s.layers.enable(1));
  c.glow.layers.enable(1);
}
rigCar(car);

let envSwapped = false;
const _cubePos = new THREE.Vector3(0, 1.2, 0);
function updateCarEnv() {
  cubeCam.position.copy(physics.pos).add(_cubePos);
  cubeCam.update(renderer, scene);
  if (!envSwapped) {
    envSwapped = true;
    for (const m of [car.paint, car.glassMat]) {
      m.envMap = cubeRT.texture;
      m.needsUpdate = true;
    }
  }
}
const carVisual = new THREE.Group(); // extra lean/pitch applied to children? kept simple: rotate group directly
const physics = new CarPhysics();
const hud = new Hud();
const audio = new GameAudio();
onFirstInteraction(() => audio.init());
const smoke = new SmokePool(scene);
let flames = new NitroFlames(car.group, car.exhausts);

// Swap in the Ferrari 458 (three.js examples model) once it loads; the
// procedural car stays as offline fallback.
loadRealCar(envMap).then((real) => {
  real.group.position.copy(car.group.position);
  real.group.quaternion.copy(car.group.quaternion);
  scene.remove(car.group);
  car = real;
  scene.add(car.group);
  rigCar(car);
  flames = new NitroFlames(car.group, car.exhausts);
  if (envSwapped) {
    for (const m of [car.paint, car.glassMat]) {
      m.envMap = cubeRT.texture;
      m.needsUpdate = true;
    }
  }
  car.setNight(nightMode);
}).catch((e) => {
  console.warn('Ferrari model unavailable — keeping procedural car:', e.message);
});
const speedLines = new SpeedLines(document.getElementById('speedlines'));
const shake = new ScreenShake();
const race = new Race(scene);
const slippy = new SlippyMap(document.getElementById('minimap'));
const _geo = {};
const _geoAhead = {};
const _mapAhead = new THREE.Vector3();
let mapTimer = 0;

// Low-res scout camera that flies ahead of the car so tiles stream in
// before the player arrives — kills pop-in shards on straights.
const scoutCam = new THREE.PerspectiveCamera(70, 1, 1, 3000);

let tiles = null;
let demo = null;           // { colliders, ground }
let road = null;           // { mesh, redrape } — tiles mode only
let roadStable = false;
let corridor = null;       // racing-line spatial index for lump flattening
let palms = null;          // authored palms at real OSM tree positions
let treeGrid = null;       // spike-sink lookup for the tile processor
let pendingTrees = null;   // fetched tree lat/lons awaiting road drape
let pendingRoads = null;   // fetched OSM road polylines awaiting road drape
let roadNet = null;        // invisible whole-network collision strips

// Once the ribbon is draped, its median height grounds the palms (flat
// downtown) — zero raycasts, which is what stalled the tile parser before.
function placePalmsIfReady() {
  // half-draped is enough — downtown is flat, the median barely moves after
  if (!tiles || !road || (!roadStable && road.drapedFraction < 0.5)) return;
  const ys = road.centers.map((c) => c.y).sort((a, b) => a - b);
  const medianY = ys[ys.length >> 1];
  if (pendingTrees && !palms) {
    const pts = pendingTrees.map((t) => geoToWorld(tiles, t.lat, t.lon, 0));
    // Shoreline Drive is palm-lined in reality, but only plant extra palms
    // where Google actually reconstructed something tall and melted — a
    // one-time probe per candidate, never per frame (that stalls streaming).
    const step = 7;
    const probe = new THREE.Vector3();
    for (let i = 0; i < road.centers.length; i += step) {
      const c = road.centers[i];
      const s = road.sides[i];
      for (const sign of [-1, 1]) {
        if ((Math.floor(i / step) + (sign + 1) / 2) % 2 === 0) continue;
        const off = 6.5 + 3.4;
        const x = c.x + s.x * off * sign;
        const z = c.z + s.z * off * sign;
        if (pts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 144)) continue;
        probe.set(x, c.y + 14, z);
        const surf = sampleGround(probe, 0, false);
        if (!surf || surf.y - c.y < 3) continue; // nothing melted here — skip
        pts.push(new THREE.Vector3(x, 0, z));
      }
    }
    treeGrid = buildTreeGrid(pts);
    palms = buildPalms(scene, pts, medianY);
    pendingTrees = null;
  }
  if (pendingRoads && !roadNet) {
    const tmp = new THREE.Vector3();
    roadNet = buildRoadNetwork(scene, pendingRoads, (ll, out) => {
      geoToWorld(tiles, ll[1], ll[0], 0, tmp);
      out[0] = tmp.x;
      out[1] = tmp.z;
      return out;
    }, medianY + 0.12);
    pendingRoads = null;
  }
}
// Route preload: scout marches the full circuit during the loading screen so
// the city is crisp before the player gets control.
const preload = { t: 0, done: false, startedAt: 0 };
// In photoreal mode the synthetic road is hidden by default so the real
// Long Beach surface shows through; toggled from the pause menu.
const OVERLAY_STORAGE = 'nfslb_overlay';
let overlayRoad = localStorage.getItem(OVERLAY_STORAGE) === 'on';
let mode = 'menu';         // menu | loading | countdown | race | freeroam | finished
let paused = false;
let freeRoam = true;       // cruising is the default; racing is opt-in via menu
let countdownT = 0;
let camMode = 0;           // 0 chase far, 1 chase near, 2 hood
let lastSafePose = null;
// one-time migration: the quality scale gained ULTRA at index 0 — old saved
// "0" meant HIGH, so remap it once rather than silently jumping users to ULTRA
if (localStorage.getItem('nfslb_qv') !== '3') {
  localStorage.setItem('nfslb_qv', '3');
  localStorage.removeItem(QUALITY_STORAGE);
}
let qualityIdx = localStorage.getItem(QUALITY_STORAGE) === null
  ? DEFAULT_QUALITY
  : Math.min(Number(localStorage.getItem(QUALITY_STORAGE)) || 0, QUALITIES.length - 1);
let loadTimeout = null;

// ---------- Raycast sampling ----------
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
const DOWN = new THREE.Vector3(0, -1, 0);
const _rayOrigin = new THREE.Vector3();
const _normal = new THREE.Vector3();

function groundTarget() {
  if (tiles) return tiles.group;
  if (demo) return demo.ground;
  return null;
}

// includeRoad: car/camera ride ON the asphalt ribbon; terrain probes (ribbon
// draping, ring heights) must ignore it or the ribbon lifts itself every pass.
// pickLowest: drape probes cast from high above — where the circuit passes
// UNDER a structure (Seaside Way under the Convention Center) the first hit is
// the roof; the road is the LOWEST surface under the ray.
function sampleGround(pos, castUp = 4, includeRoad = true, pickLowest = false) {
  const target = groundTarget();
  if (!target) return null;
  if (demo) return { y: 0, normal: new THREE.Vector3(0, 1, 0) }; // flat world fast path
  _rayOrigin.set(pos.x, pos.y + castUp, pos.z);
  raycaster.set(_rayOrigin, DOWN);
  raycaster.far = castUp + 120;
  raycaster.firstHitOnly = !pickLowest;
  const targets = [target];
  if (includeRoad && road) targets.push(road.mesh);
  if (includeRoad && roadNet) targets.push(roadNet);
  const hits = raycaster.intersectObjects(targets, true);
  raycaster.firstHitOnly = true;
  if (!hits.length) return null;
  // pickLowest: prefer a surface well below the first hit (road under a roof).
  // Hits only a few meters apart are reconstruction noise — keep the first.
  let hit = hits[0];
  if (pickLowest && hits.length > 1) {
    for (let i = hits.length - 1; i > 0; i--) {
      if (hits[0].point.y - hits[i].point.y > 6) { hit = hits[i]; break; }
    }
  } else if (includeRoad) {
    // Drivable-surface priority: circuit ribbon, then the invisible OSM road
    // network (tiles become visual-only on streets), then raw photogrammetry.
    // The network plane is flat — trust it only where the real terrain agrees
    // (protects sloped streets outside the flat downtown core).
    let ribbonHit = null, netHit = null, tileHit = null;
    for (const h of hits) {
      if (road && h.object === road.mesh) { if (!ribbonHit) ribbonHit = h; }
      else if (roadNet && h.object === roadNet) { if (!netHit) netHit = h; }
      else if (!tileHit) tileHit = h;
    }
    if (ribbonHit) hit = ribbonHit;
    else if (netHit && (!tileHit || Math.abs(netHit.point.y - tileHit.point.y) < 2.5)) hit = netHit;
    else if (tileHit) hit = tileHit;
  }
  let normal = new THREE.Vector3(0, 1, 0);
  if (hit.face) {
    normal = _normal.copy(hit.face.normal)
      .transformDirection(hit.object.matrixWorld).clone();
    if (normal.y < 0) normal.negate();
  }
  return { y: hit.point.y, normal };
}

// The car's ground probe has to survive tile LOD swaps. A single frame with no
// mesh under the ray would start it falling, and once it sinks more than the
// ray's head start the downward cast begins *below* the surface and can never
// find it again — the car falls through the world. So: always cast from above
// the last known ground, and hold that height briefly when a sample misses.
const carGround = { y: null, normal: new THREE.Vector3(0, 1, 0), miss: 0 };
let frameDt = 0.016;

function sampleCarGround(pos) {
  const castUp = carGround.y === null
    ? 4
    : Math.max(4, carGround.y - pos.y + 6);
  const g = sampleGround(pos, castUp);
  if (g) {
    carGround.y = g.y;
    carGround.normal.copy(g.normal);
    carGround.miss = 0;
    return g;
  }
  carGround.miss += frameDt;
  // brief coyote time over streaming gaps; a real drop still falls
  if (carGround.y !== null && carGround.miss < 0.5) {
    return { y: carGround.y, normal: carGround.normal };
  }
  return null;
}

const OBSTACLE_DIRS = [0, 0.6, -0.6, 1.5708, -1.5708, Math.PI];
const _dir = new THREE.Vector3();
const _hitList = [];

const _tallOrigin = new THREE.Vector3();

function sampleObstacles(pos, fwd, vel, dt) {
  _hitList.length = 0;
  const target = tiles ? tiles.group : (demo ? demo.colliders : null);
  if (!target) return _hitList;
  const speed = vel.length();
  _rayOrigin.set(pos.x, pos.y + 0.55, pos.z);
  _tallOrigin.set(pos.x, pos.y + 2.5, pos.z);
  for (const ang of OBSTACLE_DIRS) {
    const isFwd = ang === 0;
    const len = isFwd ? 2.5 + speed * dt * 2 : 1.4;
    _dir.set(
      fwd.x * Math.cos(ang) - fwd.z * Math.sin(ang),
      0,
      fwd.x * Math.sin(ang) + fwd.z * Math.cos(ang),
    );
    raycaster.set(_rayOrigin, _dir);
    raycaster.far = len;
    const hits = raycaster.intersectObject(target, true);
    if (hits.length) {
      const hit = hits[0];
      // Height discrimination (tiles mode): only obstacles that are ALSO solid
      // at 2.5m block the car — buildings, walls. Knee-high lumps (parked cars
      // baked into the photogrammetry, curbs, debris) are driven through.
      if (tiles) {
        raycaster.set(_tallOrigin, _dir);
        raycaster.far = hit.distance + 1.5;
        const tallHits = raycaster.intersectObject(target, true);
        if (!tallHits.length) continue;
      }
      let n = new THREE.Vector3().copy(_dir).negate();
      if (hit.face) {
        n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        n.y = 0;
        if (n.lengthSq() < 0.01) continue; // hit a floor-ish surface, ignore
        n.normalize();
        if (n.dot(_dir) > 0) n.negate();
      }
      _hitList.push({ normal: n, push: (len - hit.distance) * 0.5 });
    }
  }
  return _hitList;
}

// ---------- Circuit setup ----------
function computeCircuitWorld() {
  if (tiles) {
    return CIRCUIT.map((cp) => geoToWorld(tiles, cp.lat, cp.lon, 0));
  }
  return CIRCUIT.map((cp) => geoToWorldFlat(cp.lat, cp.lon));
}

// Free roam starts on the Shoreline Drive front straight facing downtown —
// harbor on one side, skyline ahead. The race start/finish sits by the marina
// parking lots, which is a far weaker first impression.
const SCENIC_SPAWN = 2;

function spawnCar() {
  const pose = freeRoam && race.worldPos.length > SCENIC_SPAWN + 1
    ? race.poseAt(SCENIC_SPAWN)
    : race.spawnPose();
  const ground = sampleGround(pose.pos, 60);
  if (ground) pose.pos.y = ground.y;
  carGround.y = null; // forget stale ground after a teleport
  carGround.miss = 0;
  physics.place(pose.pos, pose.yaw);
  physics.nitro = 100;
  lastSafePose = { pos: pose.pos.clone(), yaw: pose.yaw };
  snapCamera();
  updateCarEnv(); // seed reflections at the spawn point
}

function resetCar() {
  const pose = freeRoam
    ? (lastSafePose ?? race.spawnPose())
    : (race.started && !race.finished ? race.lastCheckpointPose() : race.spawnPose());
  const p = pose.pos.clone();
  const ground = sampleGround(p, 60);
  if (ground) p.y = ground.y;
  carGround.y = null; // forget stale ground after a teleport
  carGround.miss = 0;
  physics.place(p, pose.yaw);
  snapCamera();
}

// ---------- Overlays / DOM ----------
const $ = (id) => document.getElementById(id);
const keyScreen = $('keyScreen');
const loadingEl = $('loading');
const pauseEl = $('pause');
const keyErr = $('keyErr');
const qualityBtn = $('qualityBtn');
const modeBtn = $('modeBtn');

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

const storedKey = localStorage.getItem(KEY_STORAGE);
if (storedKey) $('apiKeyInput').value = storedKey;
qualityBtn.textContent = `QUALITY: ${QUALITIES[qualityIdx].name}`;
modeBtn.textContent = freeRoam ? 'SWITCH TO RACE' : 'SWITCH TO FREE ROAM';
$('roadBtn').textContent = overlayRoad ? 'ROAD: OVERLAY' : 'ROAD: REAL';

// Clean up paste accidents: whitespace, and the key pasted twice back-to-back.
function sanitizeKey(raw) {
  let k = (raw || '').replace(/\s+/g, '');
  if (k.length >= 20 && k.length % 2 === 0) {
    const half = k.slice(0, k.length / 2);
    if (half === k.slice(k.length / 2)) k = half;
  }
  return k;
}

$('startBtn').addEventListener('click', () => {
  const key = sanitizeKey($('apiKeyInput').value);
  if (!key) {
    keyErr.textContent = 'Paste a Google Maps API key (Map Tiles API enabled), or use Demo Mode.';
    return;
  }
  $('apiKeyInput').value = key;
  localStorage.setItem(KEY_STORAGE, key);
  startWorld(key);
});
$('demoBtn').addEventListener('click', () => startWorld(null));

$('resumeBtn').addEventListener('click', togglePause);
$('restartBtn').addEventListener('click', () => {
  freeRoam = false;
  modeBtn.textContent = 'SWITCH TO FREE ROAM';
  paused = false;
  hide(pauseEl);
  audio.setPaused(false);
  startCountdown();
});
$('modeBtn').addEventListener('click', () => {
  freeRoam = !freeRoam;
  modeBtn.textContent = freeRoam ? 'SWITCH TO RACE' : 'SWITCH TO FREE ROAM';
  paused = false;
  hide(pauseEl);
  audio.setPaused(false);
  if (!freeRoam) startCountdown();
  else { hud.clearMessages(); mode = 'freeroam'; }
});
qualityBtn.addEventListener('click', () => {
  qualityIdx = (qualityIdx + 1) % QUALITIES.length;
  localStorage.setItem(QUALITY_STORAGE, String(qualityIdx));
  qualityBtn.textContent = `QUALITY: ${QUALITIES[qualityIdx].name}`;
  if (tiles) tiles.errorTarget = QUALITIES[qualityIdx].errorTarget;
});
$('keyBtn').addEventListener('click', () => {
  window.location.reload();
});
$('roadBtn').addEventListener('click', () => {
  overlayRoad = !overlayRoad;
  localStorage.setItem(OVERLAY_STORAGE, overlayRoad ? 'on' : 'off');
  $('roadBtn').textContent = overlayRoad ? 'ROAD: OVERLAY' : 'ROAD: REAL';
  if (road && tiles) road.setVisible(overlayRoad);
});
$('muteBtn').addEventListener('click', () => {
  const muted = audio.toggleMute();
  $('muteBtn').textContent = muted ? 'SOUND: OFF' : 'SOUND: ON';
});

function togglePause() {
  if (mode === 'menu' || mode === 'loading') return;
  paused = !paused;
  pauseEl.classList.toggle('hidden', !paused);
  audio.setPaused(paused);
}

// ---------- World startup ----------
async function startWorld(apiKey) {
  hide(keyScreen);
  audio.init();
  if (apiKey) {
    mode = 'loading';
    show(loadingEl);
    slippy.initGoogle(apiKey); // live Google map in the minimap
    tiles = createTiles(apiKey, camera, renderer, tileTint,
      () => (overlayRoad ? corridor : null), () => treeGrid);
    tiles.errorTarget = QUALITIES[qualityIdx].errorTarget;
    tiles.setCamera(scoutCam);
    tiles.setResolution(scoutCam, 1024, 1024); // high-res during route preload
    preload.t = 0;
    preload.done = false;
    preload.startedAt = performance.now();
    scene.add(tiles.group);
    // 'load-root-tileset' fires AFTER ReorientationPlugin bakes its recenter
    // transform into tiles.group (plugin registered first → listener order),
    // so geoToWorld returns scene-local coords, not raw ECEF.
    let circuitBuilt = false;
    tiles.addEventListener('load-root-tileset', () => {
      if (circuitBuilt) return;
      circuitBuilt = true;
      race.build(computeCircuitWorld());
      // crisp asphalt ribbon over the real circuit streets
      const pts = circuitPath.points.map((p) => geoToWorld(tiles, p.lat, p.lon, 0));
      road = buildRoad(scene, pts, renderer.capabilities.getMaxAnisotropy());
      roadStable = false;
      corridor = buildCorridor(road.centers);
      // Photoreal mode shows Google's actual street — real markings, real
      // crosswalks, real curbs. The ribbon stays for collision only.
      road.setVisible(overlayRoad);
      // real tree positions → sink Google's melted spikes, plant good palms
      fetch(`${import.meta.env.BASE_URL}lb-trees.json`).then((r) => r.ok ? r.json() : null).then((tj) => {
        if (tj && tj.trees) pendingTrees = tj.trees;
      }).catch(() => {});
      fetch(`${import.meta.env.BASE_URL}lb-city.json`).then((r) => r.ok ? r.json() : null).then((cj) => {
        if (cj && cj.roads) pendingRoads = cj.roads;
      }).catch(() => {});
    });
    tiles.addEventListener('load-error', (e) => {
      console.error('Tiles load error', e);
      // Root tileset failure is fatal — fail fast with the real reason
      // instead of letting the 20s watchdog give a vague message.
      if (mode === 'loading' && !circuitBuilt) {
        const msg = e && e.error ? String(e.error.message || e.error) : 'unknown error';
        failLoad(`Google rejected the tiles request (${msg}). Check: Map Tiles API is enabled on the key's project, and the key has no referrer restriction blocking localhost.`);
      }
    });
    // Bail out if nothing streams in. Bad keys already fail fast via the
    // 'load-error' handler — this is only a stall backstop, and the full-route
    // preload legitimately takes a while.
    loadTimeout = setTimeout(() => {
      if (mode === 'loading' && !readyToDrive()) {
        failLoad('Tiles never arrived — check that the key is valid and Map Tiles API is enabled.');
      }
    }, 75000);
  } else {
    // No-key world: real Long Beach from OSM — clean extruded buildings,
    // zero photogrammetry artifacts. Synthwave grid remains as offline fallback.
    const circuitWorld = computeCircuitWorld();
    const circuitXZ = circuitWorld.map((p) => ({ x: p.x, z: p.z }));
    let clean = null;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}lb-city.json`);
      if (res.ok) {
        clean = buildCleanCity(scene, await res.json(), circuitXZ,
          renderer.capabilities.getMaxAnisotropy(), envMap);
      }
    } catch (e) { console.error('clean city failed, falling back:', e); }
    if (clean) {
      demo = clean;
      // crisp circuit ribbon on the flat world (near-zero lift — flat ground)
      const pts = circuitPath.points.map((p) => geoToWorldFlat(p.lat, p.lon));
      road = buildRoad(scene, pts, renderer.capabilities.getMaxAnisotropy(), 0.04);
      roadStable = true;
      // default night (windows carry the scene) but respect a saved choice
      nightMode = (localStorage.getItem(TOD_STORAGE) ?? 'night') === 'night';
      applyTimeOfDay();
    } else {
      demo = buildDemoWorld(scene, circuitXZ);
      scene.fog = new THREE.FogExp2(0x0a0c14, 0.0011);
      setSun(-6, 205); // night for the synthwave fallback
      car.setNight(true);
    }
    race.build(circuitWorld);
    startDriving();
  }
}

// Free roam (default) drops straight into the city; race mode gets a countdown.
function startDriving() {
  if (freeRoam) {
    hud.show();
    hud.clearMessages();
    race.started = false;
    race.finished = false;
    race.idx = 1;
    spawnCar();
    mode = 'freeroam';
    hud.message('LONG BEACH', 1600);
    hud.sub('CRUISE THE CITY — ESC FOR RACE MODE', 2800);
  } else {
    startCountdown();
  }
}

function failLoad(msg) {
  clearTimeout(loadTimeout);
  if (tiles) {
    scene.remove(tiles.group);
    tiles.dispose();
    tiles = null;
  }
  hide(loadingEl);
  show(keyScreen);
  keyErr.textContent = msg;
  mode = 'menu';
}

function readyToDrive() {
  if (!tiles || !race.worldPos.length) return false;
  // raw terrain only — the road ribbon isn't ground truth until draped
  return !!sampleGround(race.worldPos[0], 80, false);
}

function startCountdown() {
  hud.show();
  hud.clearMessages();
  race.started = false;
  race.finished = false;
  race.idx = 1; // countdown minimap highlights gate 1, not a stale checkpoint
  spawnCar();
  mode = 'countdown';
  countdownT = 0;
  countdownStep = 4;
}
let countdownStep = 0;

// ---------- Camera ----------
const CAM_OFFSETS = [
  // slightly higher + tilted down: photogrammetry reads far better from above
  { off: new THREE.Vector3(0, 3.5, 8.0), look: 6.0, lookUp: 0.7 },
  { off: new THREE.Vector3(0, 2.4, 5.6), look: 4.5, lookUp: 0.9 },
  { off: new THREE.Vector3(0, 1.18, -0.2), look: 30, lookUp: 0.9 },
];
const _camDesired = new THREE.Vector3();
const _camLook = new THREE.Vector3();
const _shakeOff = new THREE.Vector3();
const _fwdTmp = new THREE.Vector3();
const _offDir = new THREE.Vector3();

// Free look: drag orbits the chase camera around the car, wheel zooms,
// recenters itself shortly after release.
const look = { az: 0, pitch: 0, dist: 1, lastX: 0, lastY: 0, dragging: false, lastInput: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => {
  look.dragging = true;
  look.lastX = e.clientX;
  look.lastY = e.clientY;
});
window.addEventListener('pointermove', (e) => {
  if (!look.dragging) return;
  look.az -= (e.clientX - look.lastX) * 0.006;
  look.pitch = THREE.MathUtils.clamp(look.pitch + (e.clientY - look.lastY) * 0.004, -0.35, 0.85);
  look.lastX = e.clientX;
  look.lastY = e.clientY;
  look.lastInput = performance.now();
});
window.addEventListener('pointerup', () => {
  look.dragging = false;
  look.lastInput = performance.now();
});
window.addEventListener('wheel', (e) => {
  look.dist = THREE.MathUtils.clamp(look.dist * (1 + e.deltaY * 0.0012), 0.45, 2.4);
}, { passive: true });

function updateCamera(dt, snap = false) {
  const cfg = CAM_OFFSETS[camMode];
  const fwd = physics.forward(_fwdTmp);

  // free-look recenter once the pointer has been idle a moment
  if (!look.dragging && performance.now() - look.lastInput > 1200) {
    const k = Math.exp(-dt * 4);
    look.az *= k;
    look.pitch *= k;
  }
  const orbiting = Math.abs(look.az) > 0.05 || Math.abs(look.pitch) > 0.05;

  if (camMode === 2) {
    // hood cam: rigid, no orbit
    _camDesired.copy(physics.pos)
      .addScaledVector(fwd, -cfg.off.z)
      .add(_shakeOff.set(0, cfg.off.y, 0));
    camera.position.copy(_camDesired);
  } else {
    const dist = cfg.off.z * look.dist;
    _offDir.copy(fwd).negate().applyAxisAngle(UP, look.az);
    _camDesired.copy(physics.pos)
      .addScaledVector(_offDir, dist)
      .add(_shakeOff.set(0, cfg.off.y * look.dist + Math.sin(look.pitch) * dist, 0));
    if (snap) {
      camera.position.copy(_camDesired);
    } else {
      const k = 1 - Math.exp(-dt * 5.5);
      camera.position.lerp(_camDesired, k);
    }
  }
  // camera rides the suspension, not the raw ground samples
  if (susp.y !== null && camMode !== 2) camera.position.y += (susp.y - physics.pos.y) * 0.8;
  shake.offset(_shakeOff);
  camera.position.add(_shakeOff);
  // orbiting → look at the car itself; driving → look down the road
  const lookAhead = orbiting ? cfg.look * 0.15 : cfg.look;
  _camLook.copy(physics.pos).addScaledVector(fwd, lookAhead);
  _camLook.y += orbiting ? 0.8 : cfg.lookUp;
  camera.lookAt(_camLook);

  const speedNorm = Math.min(physics.speed / NITRO_TOP_SPEED, 1);
  // narrower base FOV: distant buildings render larger → visibly sharper
  const targetFov = 58 + speedNorm * 14 + (physics.nitroActive ? 6 : 0);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 5);
  camera.updateProjectionMatrix();
}

function snapCamera() { updateCamera(0.016, true); }

// ---------- Car visual sync ----------
const _qNormal = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qLean = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _leanAxis = new THREE.Vector3(0, 0, 1);
const _pitchAxis = new THREE.Vector3(1, 0, 0);
const _qPitch = new THREE.Quaternion();

// Virtual suspension: spring-damper follows the sampled ground so terrain
// bumps get absorbed instead of snapping the body (and camera) around.
const susp = { y: null, vy: 0, pitch: 0, lastF: 0 };

function syncCarVisual(dt) {
  // suspension spring (teleports snap it)
  if (susp.y === null || Math.abs(physics.pos.y - susp.y) > 4) {
    susp.y = physics.pos.y;
    susp.vy = 0;
  }
  const springA = 70 * (physics.pos.y - susp.y) - 13 * susp.vy;
  susp.vy += springA * dt;
  susp.y += susp.vy * dt;
  // the body may compress toward the contact point but never through it —
  // otherwise a sharp rise leaves the car visually buried in the road
  if (susp.y < physics.pos.y - 0.12) {
    susp.y = physics.pos.y - 0.12;
    susp.vy = Math.max(susp.vy, 0);
  }
  // accel/brake pitch dip
  const accel = dt > 0 ? (physics.forwardSpeed - susp.lastF) / dt : 0;
  susp.lastF = physics.forwardSpeed;
  const pitchT = THREE.MathUtils.clamp(accel * -0.0035, -0.055, 0.085);
  susp.pitch += (pitchT - susp.pitch) * Math.min(1, dt * 6);

  car.group.position.set(physics.pos.x, susp.y, physics.pos.z);
  _qNormal.setFromUnitVectors(UP, physics.groundNormal);
  _qYaw.setFromAxisAngle(UP, physics.yaw);
  const lean = THREE.MathUtils.clamp(
    -input.steer * Math.min(physics.speed / TOP_SPEED, 1) * 0.09
      - (physics.drifting ? Math.sign(input.steer) * -0.03 : 0),
    -0.14, 0.14,
  );
  _qLean.setFromAxisAngle(_leanAxis, lean);
  _qPitch.setFromAxisAngle(_pitchAxis, susp.pitch);
  car.group.quaternion.copy(_qNormal).multiply(_qYaw).multiply(_qLean).multiply(_qPitch);

  car.updateWheels(dt, physics.forwardSpeed, physics.steerVisual);
  car.setBrake(input.brake > 0 && physics.forwardSpeed > 1);

  // sun shadow frustum + catcher disc track the car
  sunLight.position.copy(physics.pos).addScaledVector(_sunDir, 150);
  sunLight.target.position.copy(physics.pos);
  shadowCatcher.position.set(physics.pos.x, physics.pos.y + 0.05, physics.pos.z);
}

// ---------- FX ----------
const _wheelWorld = new THREE.Vector3();
function updateFx(dt) {
  // drift smoke from rear wheels
  if (physics.grounded && (physics.drifting || (input.handbrake && physics.speed > 8))) {
    for (const wheel of car.rearWheels) {
      if (Math.random() < 0.7) {
        wheel.getWorldPosition(_wheelWorld);
        smoke.spawn(_wheelWorld, physics.vel, 1);
      }
    }
  }
  // nitro exhaust + shake
  flames.update(physics.nitroActive);
  if (physics.nitroActive) shake.add(dt * 0.8);
  if (physics.crashImpulse > 3) {
    shake.add(Math.min(0.6, physics.crashImpulse * 0.04));
    audio.crash(physics.crashImpulse * 0.1);
  }
  smoke.update(dt);
  shake.update(dt);
  const speedNorm = Math.min(physics.speed / TOP_SPEED, 1);
  speedLines.draw(Math.max(0, speedNorm - 0.35) * 1.6, physics.nitroActive);
}

// ---------- Main loop ----------
let lastT = performance.now();
let heightTimer = 0;
let safeTimer = 0;
let cubeFrame = 0;

let rafId = 0;
let lastTickAt = performance.now();
function tick(now) {
  // single-flight rAF: the hidden-tab fallback also calls tick(), so cancel
  // any still-pending frame before arming a new one (no parallel loops)
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
  lastTickAt = performance.now();
  const dt = Math.max(0, Math.min((now - lastT) / 1000, 0.05));
  lastT = now;
  updateInput();

  // one-shot keys
  if (pressed.has('Escape')) togglePause();
  if (pressed.has('KeyM')) {
    const muted = audio.toggleMute();
    $('muteBtn').textContent = muted ? 'SOUND: OFF' : 'SOUND: ON';
  }
  if (pressed.has('KeyC') && !paused) camMode = (camMode + 1) % CAM_OFFSETS.length;
  if (pressed.has('KeyN') && (tiles || demo) && !paused) {
    nightMode = !nightMode;
    applyTimeOfDay();
  }
  const wantReset = pressed.has('KeyR');
  pressed.clear();

  if (mode === 'loading') {
    // cinematic orbit over downtown while the city streams
    const t = now / 5000;
    camera.position.set(Math.sin(t) * 300, 190, Math.cos(t) * 300);
    camera.lookAt(0, -20, 0);
    if (tiles) {
      camera.updateMatrixWorld();
      // the overview orbit must not demand street-level LOD — at ULTRA it
      // floods the parse queue and starves the spawn area (load never ends)
      tiles.errorTarget = 20;
      bokeh.enabled = false;
      tiles.update();
      const prog = typeof tiles.loadProgress === 'number' ? tiles.loadProgress : null;
      if (prog !== null) $('loadBar').style.width = `${Math.round(prog * 100)}%`;
      // drape the ribbon while the city streams so it's seated before GO
      heightTimer += dt;
      if (road && heightTimer > 0.5) {
        heightTimer = 0;
        if (!roadStable) {
          roadStable = road.redrape((p, up) => sampleGround(p, up, false, true));
          corridor = buildCorridor(road.centers);
        }
        placePalmsIfReady();
      }
      if (readyToDrive()) {
        clearTimeout(loadTimeout);
        tiles.setResolution(scoutCam, 256, 256);
        bokeh.enabled = true;
        hide(loadingEl);
        startDriving();
      }
    }
    composer.render();
    return;
  }

  if (mode === 'menu') {
    composer.render();
    return;
  }

  if (paused) {
    if (tiles) { camera.updateMatrixWorld(); tiles.update(); }
    composer.render();
    return;
  }

  // countdown
  if (mode === 'countdown') {
    countdownT += dt;
    const step = 3 - Math.floor(countdownT);
    if (step !== countdownStep && step > 0) {
      countdownStep = step;
      hud.message(String(step), 0);
      audio.countdown();
    }
    if (countdownT >= 3) {
      hud.message('GO!', 900);
      audio.go();
      race.start(now);
      mode = freeRoam ? 'freeroam' : 'race';
    }
  }

  const driving = mode === 'race' || mode === 'freeroam' || mode === 'finished';
  const inputLocked = mode === 'countdown';

  if (driving || mode === 'countdown') {
    const effInput = inputLocked
      ? { throttle: 0, brake: 0, steer: input.steer, handbrake: false, nitro: false }
      : input;
    frameDt = dt;
    physics.update(dt, effInput, sampleCarGround, sampleObstacles);

    if (wantReset || physics.pos.y < -120 || physics.airTime > 5) resetCar();

    // remember safe pose for free-roam resets
    safeTimer += dt;
    if (safeTimer > 2 && physics.grounded && physics.speed > 2) {
      safeTimer = 0;
      lastSafePose = { pos: physics.pos.clone(), yaw: physics.yaw };
    }

    syncCarVisual(dt);
    updateCamera(dt);
    updateFx(dt);

    // live city reflections on the car (~10Hz), skipped on LOW quality
    cubeFrame++;
    if (cubeFrame % 6 === 0 && QUALITIES[qualityIdx].name !== 'LOW') updateCarEnv();
    audio.update(
      Math.min(physics.speed / TOP_SPEED, 1),
      inputLocked ? (input.throttle ? 0.6 : 0) : input.throttle,
      physics.drifting && physics.grounded,
      physics.nitroActive,
    );

    // race logic
    const evt = race.update(dt, now, physics.pos, physics.vel, freeRoam || mode === 'countdown');
    if (evt === 'checkpoint') audio.checkpoint();
    else if (evt === 'lap') {
      audio.go();
      hud.message(race.lap === 3 ? 'FINAL LAP' : `LAP ${race.lap}`, 1500);
      hud.sub(`LAST LAP ${formatTime(race.lastLap)}`, 2600);
    } else if (evt === 'finish') {
      mode = 'finished';
      hud.message('RACE COMPLETE', 0);
      hud.sub(`TOTAL ${formatTime(race.totalTime(now))} — BEST LAP ${formatTime(race.best)} — ESC TO RESTART`, 0);
    }

    // periodic ring-height + road-drape refresh while tiles stream in
    heightTimer += dt;
    if (heightTimer > 1.5) {
      heightTimer = 0;
      if (race.heightsPending.length) race.refreshHeights((p, up) => sampleGround(p, up, false, true));
      if (road && !roadStable) {
        roadStable = road.redrape((p, up) => sampleGround(p, up, false, true));
        corridor = buildCorridor(road.centers); // refresh flatten heights as drape settles
      }
      placePalmsIfReady();
    }

    hud.update({
      speedMph: physics.speed * 2.23694,
      nitro: physics.nitro,
      race,
      now,
      freeRoam: freeRoam && mode !== 'countdown',
    });
    // live map minimap (~8Hz). Heading comes from two geo samples so the
    // arrow is correct regardless of the tileset's world orientation.
    mapTimer += dt;
    if (mapTimer > 0.12) {
      mapTimer = 0;
      const fwd = physics.forward(_fwdTmp);
      _mapAhead.copy(physics.pos).addScaledVector(fwd, 20);
      const geo = tiles ? worldToGeo(tiles, physics.pos, _geo) : flatToGeo(physics.pos, _geo);
      const ahead = tiles ? worldToGeo(tiles, _mapAhead, _geoAhead) : flatToGeo(_mapAhead, _geoAhead);
      const bearing = Math.atan2(
        (ahead.lon - geo.lon) * Math.cos(geo.lat * Math.PI / 180),
        ahead.lat - geo.lat,
      );
      slippy.draw(geo.lat, geo.lon, bearing);
    }
  }

  if (tiles) {
    camera.updateMatrixWorld();
    // speed-adaptive detail: full quality while cruising, coarser target at
    // high speed so streaming fills the world instead of chasing leaf tiles
    const baseErr = QUALITIES[qualityIdx].errorTarget;
    const speedK = THREE.MathUtils.clamp((physics.speed - 15) / 45, 0, 1);
    tiles.errorTarget = baseErr * (1 + speedK * 1.6);
    // scout hovers ahead along the direction of travel
    const ahead = Math.max(70, physics.speed * 3.2);
    const fwd = physics.forward(_fwdTmp);
    scoutCam.position.copy(physics.pos).addScaledVector(fwd, ahead * 0.55);
    scoutCam.position.y += 32;
    _camLook.copy(physics.pos).addScaledVector(fwd, ahead);
    scoutCam.lookAt(_camLook);
    scoutCam.updateMatrixWorld();
    tiles.update();
  }
  cinematic.material.uniforms.time.value = now / 1000;
  cinematic.material.uniforms.motion.value =
    Math.max(0, physics.speed / TOP_SPEED - 0.35) * 0.05 + (physics.nitroActive ? 0.045 : 0);
  composer.render();
}

applyTimeOfDay();
rafId = requestAnimationFrame(tick);
setSize();

// rAF stalls when the tab is hidden/occluded — keep ticking at ~30fps so the
// race isn't silently frozen (and headless testing works). tick() itself is
// single-flight (cancels its pending rAF), so this can't stack loops.
setInterval(() => {
  if (performance.now() - lastTickAt > 50) tick(performance.now());
}, 33);

// dev debug handles
window.__ready = () => readyToDrive();
window.__sink = (d = 15) => { physics.pos.y -= d; };
window.__preload = () => ({ ...preload, worldPos: race.worldPos.length });
window.__scene = scene;
window.__r = { renderer, camera, composer };
window.__teleport = (i) => {
  const p = race.worldPos[i % race.worldPos.length];
  const g = sampleGround(p, 60);
  const pos = p.clone();
  if (g) pos.y = g.y;
  physics.place(pos, 0);
  snapCamera();
};
window.__post = { bloom, cinematic, fxaa };
window.__game = () => ({
  mode, paused, freeRoam, countdownT,
  speed: physics.speed, pos: physics.pos.toArray().map((v) => v.toFixed(1)),
  raceStarted: race.started, raceIdx: race.idx, lap: race.lap,
  world: tiles ? 'tiles' : (demo ? 'demo' : 'none'),
  tilesStats: tiles ? {
    visible: tiles.visibleTiles ? tiles.visibleTiles.size : -1,
    cpWorld0: race.worldPos[0] ? race.worldPos[0].toArray().map((v) => v.toFixed(0)) : null,
    errorTarget: tiles.errorTarget,
    downloading: tiles.stats ? tiles.stats.downloading : null,
    parsing: tiles.stats ? tiles.stats.parsing : null,
    lruUsed: tiles.lruCache ? tiles.lruCache.itemList.length : null,
    camCount: tiles.cameras ? tiles.cameras.length : null,
  } : null,
});
