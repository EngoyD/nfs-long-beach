// Keyboard state → normalized input axes.
const keys = new Set();

export const input = {
  throttle: 0,
  brake: 0,
  steer: 0,       // -1..1, positive = left
  handbrake: false,
  nitro: false,
};

// One-shot key events consumed by the game loop.
export const pressed = new Set();

const TRACKED = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'KeyR', 'KeyC', 'KeyM', 'KeyN', 'Escape',
]);

let firstInteractionCbs = [];
export function onFirstInteraction(cb) { firstInteractionCbs.push(cb); }

function fireFirst() {
  if (firstInteractionCbs.length) {
    const cbs = firstInteractionCbs;
    firstInteractionCbs = [];
    cbs.forEach((cb) => cb());
  }
}

window.addEventListener('keydown', (e) => {
  fireFirst();
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (!TRACKED.has(e.code)) return;
  if (e.code === 'Space') e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
});

window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});

window.addEventListener('blur', () => keys.clear());
window.addEventListener('pointerdown', fireFirst);

export function updateInput() {
  input.throttle = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
  input.brake = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
  const left = keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0;
  const right = keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0;
  input.steer = left - right;
  input.handbrake = keys.has('Space');
  input.nitro = keys.has('ShiftLeft') || keys.has('ShiftRight');
}
