// Synth engine/wind/skid/nitro audio — no external assets.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
  }

  init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    // Engine: saw + sub square through lowpass.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const engineLp = ctx.createBiquadFilter();
    engineLp.type = 'lowpass';
    engineLp.frequency.value = 900;
    this.engineLp = engineLp;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const sub = ctx.createGain();
    sub.gain.value = 0.4;
    this.osc1.connect(this.engineGain);
    this.osc2.connect(sub).connect(this.engineGain);
    this.engineGain.connect(engineLp).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // Shared noise buffer.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const mkNoise = (type, freq, q = 1) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = type;
      filt.frequency.value = freq;
      filt.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filt).connect(gain).connect(this.master);
      src.start();
      return { filt, gain };
    };

    this.wind = mkNoise('bandpass', 700, 0.6);
    this.skid = mkNoise('bandpass', 2200, 2.5);
    this.nitroN = mkNoise('bandpass', 300, 1.2);
  }

  // speedNorm 0..1, throttle 0..1
  update(speedNorm, throttle, drifting, nitroActive) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    // 6 fake gears.
    const gearPos = Math.min(speedNorm, 0.999) * 6;
    const rpm = gearPos % 1;
    const freq = 50 + rpm * 170 + speedNorm * 40;
    this.osc1.frequency.setTargetAtTime(freq, t, 0.03);
    this.osc2.frequency.setTargetAtTime(freq * 0.5, t, 0.03);
    this.engineGain.gain.setTargetAtTime(0.05 + throttle * 0.11 + speedNorm * 0.04, t, 0.05);
    this.engineLp.frequency.setTargetAtTime(500 + throttle * 900 + rpm * 800, t, 0.06);

    this.wind.gain.gain.setTargetAtTime(speedNorm * speedNorm * 0.30, t, 0.1);
    this.wind.filt.frequency.setTargetAtTime(400 + speedNorm * 1600, t, 0.1);
    this.skid.gain.gain.setTargetAtTime(drifting ? 0.13 : 0, t, 0.05);
    this.nitroN.gain.gain.setTargetAtTime(nitroActive ? 0.22 : 0, t, 0.08);
    this.nitroN.filt.frequency.setTargetAtTime(nitroActive ? 900 + speedNorm * 900 : 300, t, 0.1);
  }

  beep(freq = 880, dur = 0.12, vol = 0.25) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  checkpoint() { this.beep(1320, 0.1, 0.2); }
  countdown() { this.beep(440, 0.18, 0.3); }
  go() { this.beep(880, 0.4, 0.32); }
  crash(intensity = 1) { this.beep(90, 0.15, Math.min(0.4, 0.18 * intensity)); }

  setPaused(p) {
    if (!this.ctx) return;
    if (p) this.ctx.suspend();
    else this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  }
}
