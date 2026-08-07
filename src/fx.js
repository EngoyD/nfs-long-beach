// Drift smoke, nitro flames, speed lines, screen shake.
import * as THREE from 'three';

function makeRadialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class SmokePool {
  constructor(scene, count = 140) {
    this.tex = makeRadialTexture('rgba(230,230,240,0.55)', 'rgba(230,230,240,0)');
    this.sprites = [];
    this.free = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.tex, transparent: true, opacity: 0, depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.userData = { life: 0, maxLife: 1, vel: new THREE.Vector3() };
      scene.add(sprite);
      this.sprites.push(sprite);
      this.free.push(sprite);
    }
  }

  spawn(pos, vel, scale = 1) {
    const s = this.free.pop();
    if (!s) return;
    s.visible = true;
    s.position.copy(pos);
    s.userData.life = 0;
    s.userData.maxLife = 0.8 + Math.random() * 0.5;
    s.userData.vel.copy(vel).multiplyScalar(0.25);
    s.userData.vel.x += (Math.random() - 0.5) * 2;
    s.userData.vel.y = 1.2 + Math.random() * 1.2;
    s.userData.vel.z += (Math.random() - 0.5) * 2;
    s.scale.setScalar(0.7 * scale);
    s.userData.baseScale = scale;
  }

  update(dt) {
    for (const s of this.sprites) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life += dt;
      if (u.life >= u.maxLife) {
        s.visible = false;
        s.material.opacity = 0;
        this.free.push(s);
        continue;
      }
      const t = u.life / u.maxLife;
      s.position.addScaledVector(u.vel, dt);
      s.scale.setScalar((0.7 + t * 2.6) * u.baseScale);
      s.material.opacity = 0.5 * (1 - t);
    }
  }
}

export class NitroFlames {
  constructor(carGroup, exhausts) {
    this.flames = [];
    const geo = new THREE.ConeGeometry(0.09, 0.7, 8);
    geo.rotateX(-Math.PI / 2); // point +Z (backwards)
    for (const anchor of exhausts) {
      const inner = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x9fd8ff, transparent: true, opacity: 0.95,
      }));
      inner.material.color.multiplyScalar(5);
      const outer = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x3d7bff, transparent: true, opacity: 0.6,
      }));
      outer.material.color.multiplyScalar(3);
      outer.scale.set(1.7, 1.7, 1.35);
      inner.position.copy(anchor).z += 0.35;
      outer.position.copy(anchor).z += 0.42;
      inner.visible = outer.visible = false;
      carGroup.add(inner, outer);
      this.flames.push(inner, outer);
    }
  }

  update(active) {
    for (const f of this.flames) {
      f.visible = active;
      if (active) {
        const jitter = 0.75 + Math.random() * 0.5;
        f.scale.z = jitter * (f.scale.x > 1.2 ? 1.35 : 1);
      }
    }
  }
}

export class SpeedLines {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  // intensity 0..1
  draw(intensity, nitro) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (intensity < 0.05) return;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const count = Math.floor(intensity * 26) + (nitro ? 18 : 0);
    const maxR = Math.hypot(cx, cy);
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r0 = maxR * (0.42 + Math.random() * 0.3);
      const len = maxR * (0.1 + Math.random() * 0.28) * intensity;
      const x0 = cx + Math.cos(ang) * r0;
      const y0 = cy + Math.sin(ang) * r0;
      const x1 = cx + Math.cos(ang) * (r0 + len);
      const y1 = cy + Math.sin(ang) * (r0 + len);
      ctx.strokeStyle = nitro
        ? `rgba(120,210,255,${0.10 + Math.random() * 0.22})`
        : `rgba(255,255,255,${0.05 + Math.random() * 0.12})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
}

export class ScreenShake {
  constructor() { this.trauma = 0; }
  add(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  update(dt) { this.trauma = Math.max(0, this.trauma - dt * 1.8); }
  offset(target) {
    const s = this.trauma * this.trauma;
    target.set(
      (Math.random() - 0.5) * 0.5 * s,
      (Math.random() - 0.5) * 0.35 * s,
      0,
    );
    return target;
  }
}
