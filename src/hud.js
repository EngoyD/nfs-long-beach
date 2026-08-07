// DOM HUD + circular minimap.
import { formatTime, LAPS } from './race.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), speedVal: $('speedVal'), nitroBar: $('nitroBar'),
      timer: $('timer'), lapLine: $('lapLine'), bestLine: $('bestLine'),
      wrongWay: $('wrongWay'), centerMsg: $('centerMsg'), centerSub: $('centerSub'),
      minimap: $('minimap'),
    };
    this.mm = this.el.minimap.getContext('2d');
    this.msgTimer = null;
    this.subTimer = null;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  message(text, ms = 1600) {
    const el = this.el.centerMsg;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.msgTimer);
    if (ms > 0) this.msgTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  sub(text, ms = 2400) {
    const el = this.el.centerSub;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.subTimer);
    if (ms > 0) this.subTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  clearMessages() {
    this.el.centerMsg.classList.remove('show');
    this.el.centerSub.classList.remove('show');
  }

  update({ speedMph, nitro, race, now, freeRoam }) {
    this.el.speedVal.textContent = String(Math.round(Math.abs(speedMph)));
    this.el.nitroBar.style.transform = `scaleX(${(nitro / 100).toFixed(3)})`;

    if (freeRoam || !race.started) {
      this.el.timer.textContent = freeRoam ? 'FREE ROAM' : '0:00.0';
      this.el.lapLine.textContent = freeRoam ? 'LONG BEACH, CA' : `LAP 1/${LAPS}`;
      this.el.bestLine.textContent = race.best ? `BEST LAP ${formatTime(race.best)}` : '';
      this.el.wrongWay.classList.add('hidden');
      return;
    }

    this.el.timer.textContent = formatTime(race.totalTime(now));
    this.el.lapLine.textContent = race.finished
      ? 'RACE COMPLETE'
      : `LAP ${race.lap}/${LAPS} · CP ${race.idx === 0 ? race.worldPos.length : race.idx}/${race.worldPos.length}`;
    const parts = [];
    if (race.lastLap) parts.push(`LAST ${formatTime(race.lastLap)}`);
    if (race.best) parts.push(`BEST ${formatTime(race.best)}`);
    this.el.bestLine.textContent = parts.join('  ·  ');
    this.el.wrongWay.classList.toggle('hidden', !race.wrongWay || race.finished);
  }

  // Minimap: fixed north-up projection of circuit + car.
  drawMinimap(worldPos, carPos, carYaw, nextIdx) {
    const ctx = this.mm;
    const w = this.el.minimap.width;
    const h = this.el.minimap.height;
    ctx.clearRect(0, 0, w, h);
    if (!worldPos.length) return;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of worldPos) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    // include car so it never leaves the map
    minX = Math.min(minX, carPos.x); maxX = Math.max(maxX, carPos.x);
    minZ = Math.min(minZ, carPos.z); maxZ = Math.max(maxZ, carPos.z);

    const pad = 64; // keeps the car triangle inside the circular mask
    const scale = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxZ - minZ || 1));
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const px = (p) => w / 2 + (p.x - cx) * scale;
    const py = (p) => h / 2 + (p.z - cz) * scale;

    // circuit path
    ctx.beginPath();
    for (let i = 0; i <= worldPos.length; i++) {
      const p = worldPos[i % worldPos.length];
      if (i === 0) ctx.moveTo(px(p), py(p));
      else ctx.lineTo(px(p), py(p));
    }
    ctx.strokeStyle = 'rgba(46,230,255,0.7)';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // checkpoints
    for (let i = 0; i < worldPos.length; i++) {
      const p = worldPos[i];
      ctx.beginPath();
      ctx.arc(px(p), py(p), i === nextIdx ? 9 : 5, 0, Math.PI * 2);
      ctx.fillStyle = i === nextIdx ? '#ff2ea6' : 'rgba(46,230,255,0.9)';
      ctx.fill();
    }

    // car
    ctx.save();
    ctx.translate(px(carPos), py(carPos));
    ctx.rotate(-carYaw);
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(8, 10);
    ctx.lineTo(-8, 10);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();
  }
}
