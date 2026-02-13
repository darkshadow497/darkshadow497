const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('status');

const state = {
  id: null,
  role: 'spectator',
  game: null,
  players: { left: 0, right: 0 },
  input: { up: false, down: false },
};

function draw() {
  if (!state.game) return;

  const { width, height, paddles, ball, score } = state.game;

  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = '#f8fbff';
  for (let y = 0; y < height; y += 24) {
    ctx.fillRect(width / 2 - 2, y, 4, 14);
  }

  ctx.fillStyle = '#64d2ff';
  ctx.fillRect(20, paddles.left.y, 12, 90);

  ctx.fillStyle = '#fca5a5';
  ctx.fillRect(width - 32, paddles.right.y, 12, 90);

  ctx.fillStyle = '#f8fbff';
  ctx.fillRect(ball.x - 6, ball.y - 6, 12, 12);

  ctx.font = 'bold 52px Arial';
  ctx.fillText(String(score.left), width * 0.25, 60);
  ctx.fillText(String(score.right), width * 0.75, 60);
}

async function sendInput() {
  if (!state.id) return;
  await fetch('/input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: state.id,
      up: state.input.up,
      down: state.input.down,
    }),
  });
}

function updateStatus() {
  const roleLabel = state.role === 'spectator' ? 'Spectator' : `Player (${state.role})`;
  statusText.textContent = `${roleLabel} • Left: ${state.players.left} Right: ${state.players.right}`;
}

function onKey(key, pressed) {
  if (['w', 'ArrowUp'].includes(key)) {
    state.input.up = pressed;
  }
  if (['s', 'ArrowDown'].includes(key)) {
    state.input.down = pressed;
  }
  sendInput().catch(() => {
    statusText.textContent = 'Connection issue';
  });
}

document.addEventListener('keydown', (event) => onKey(event.key, true));
document.addEventListener('keyup', (event) => onKey(event.key, false));

window.addEventListener('beforeunload', () => {
  if (state.id) {
    navigator.sendBeacon('/leave', JSON.stringify({ id: state.id }));
  }
});

(async function init() {
  const join = await fetch('/join', { method: 'POST' });
  const session = await join.json();
  state.id = session.id;
  state.role = session.role;
  updateStatus();

  const events = new EventSource('/events');
  events.onmessage = (message) => {
    const payload = JSON.parse(message.data);
    if (payload.type === 'state') {
      state.game = payload.game;
      state.players = payload.players;
      updateStatus();
      draw();
    }
  };
})();
