// Live slippy-map minimap: Google 2D map tiles (using the game's existing
// Map Tiles API key via a session token) with OpenStreetMap raster fallback.
// The canvas is display-only (never read back), so cross-origin tiles are fine.
const TILE = 256;

export class SlippyMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.zoom = 16;
    this.mode = 'osm';
    this.session = null;
    this.key = null;
    this.cache = new Map(); // "z/x/y" → HTMLImageElement
    this.pending = 0;
  }

  // Try to establish a Google 2D roadmap tile session; silently keep OSM on failure.
  async initGoogle(key) {
    if (!key) return;
    try {
      const r = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapType: 'roadmap', language: 'en-US', region: 'US' }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (!j.session) throw new Error('no session');
      this.session = j.session;
      this.key = key;
      this.mode = 'google';
      this.cache.clear();
    } catch {
      this.mode = 'osm';
    }
  }

  tileUrl(z, x, y) {
    return this.mode === 'google'
      ? `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${this.session}&key=${this.key}`
      : `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  }

  getTile(z, x, y) {
    const n = 2 ** z;
    if (x < 0 || y < 0 || x >= n || y >= n) return null;
    const id = `${this.mode}/${z}/${x}/${y}`;
    let img = this.cache.get(id);
    if (!img) {
      if (this.pending > 12) return null; // don't stampede the tile server
      img = new Image();
      this.pending++;
      img.onload = () => { this.pending--; };
      img.onerror = () => { this.pending--; };
      img.src = this.tileUrl(z, x, y);
      this.cache.set(id, img);
      if (this.cache.size > 220) {
        // drop oldest third
        const keys = [...this.cache.keys()].slice(0, 80);
        for (const k of keys) this.cache.delete(k);
      }
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  // North-up map centered on lat/lon; bearing = compass heading of travel
  // (radians, clockwise from north) for the car arrow.
  draw(lat, lon, bearing) {
    const { ctx, canvas } = this;
    const z = this.zoom;
    const n = 2 ** z;
    const xt = ((lon + 180) / 360) * n;
    const latR = (lat * Math.PI) / 180;
    const yt = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#10141c';
    ctx.fillRect(0, 0, w, h);
    const x0 = Math.floor(xt);
    const y0 = Math.floor(yt);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const img = this.getTile(z, x0 + dx, y0 + dy);
        if (!img) continue;
        ctx.drawImage(img, Math.round(w / 2 + (x0 + dx - xt) * TILE), Math.round(h / 2 + (y0 + dy - yt) * TILE), TILE, TILE);
      }
    }
    // subtle HUD tint so the map sits with the rest of the UI
    ctx.fillStyle = 'rgba(10,16,30,0.18)';
    ctx.fillRect(0, 0, w, h);

    // car arrow (north-up map: yaw 0 = north = up)
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(bearing);
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(9, 11);
    ctx.lineTo(0, 6);
    ctx.lineTo(-9, 11);
    ctx.closePath();
    ctx.fillStyle = '#2ee6ff';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#2ee6ff';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
