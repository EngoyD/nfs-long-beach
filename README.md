# NFS: Long Beach

Browser street-racing game set in the real Long Beach, CA — streamed as Google **Photorealistic 3D Tiles** (actual photogrammetry of the city: Shoreline Drive, the Aquarium, Queen Mary, downtown towers). Race a 3-lap sprint around the Grand Prix of Long Beach street circuit, or free-roam the city.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Google Maps API key

The photorealistic city needs a Google Maps Platform key:

1. [Google Cloud Console](https://console.cloud.google.com/google/maps-apis) → create/pick a project
2. Enable **Map Tiles API**
3. Create an API key, paste it on the start screen

The key is stored in your browser's localStorage only and sent only to Google's tile endpoint. Free monthly tier covers casual play.

No key? **Demo Mode** runs the same game on a synthwave placeholder city.

## Controls

| Key | Action |
|-----|--------|
| W / S | Throttle / brake–reverse |
| A / D | Steer |
| Space | Handbrake (drift) |
| Shift | Nitro |
| R | Reset to track |
| C | Camera (chase far / near / hood) |
| M | Mute |
| Esc | Pause menu (restart, free roam, quality, key) |

## Credits

- Ferrari 458 Italia model from the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) (`ferrari.glb`)

## Tech

- [three.js](https://threejs.org) + [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) (Google Photorealistic 3D Tiles)
- Arcade drift physics, raycast ground-follow + building collision against live photogrammetry
- Checkpoints placed by real WGS84 coordinates on the GP circuit streets
- UnrealBloom + FXAA post, synth engine audio (WebAudio, no assets)
