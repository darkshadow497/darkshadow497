const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;

const WIDTH = 900;
const HEIGHT = 500;
const PADDLE_H = 90;
const PADDLE_W = 12;
const BALL_SIZE = 12;
const PADDLE_SPEED = 6;
const INITIAL_BALL_SPEED = 5;

const clients = new Set();
const sessions = new Map();

const game = {
  width: WIDTH,
  height: HEIGHT,
  paddles: {
    left: { y: HEIGHT / 2 - PADDLE_H / 2, dy: 0 },
    right: { y: HEIGHT / 2 - PADDLE_H / 2, dy: 0 },
  },
  ball: {
    x: WIDTH / 2,
    y: HEIGHT / 2,
    vx: INITIAL_BALL_SPEED,
    vy: INITIAL_BALL_SPEED,
  },
  score: { left: 0, right: 0 },
};

function sendEvent(client, payload) {
  client.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(payload) {
  for (const client of clients) {
    sendEvent(client, payload);
  }
}

function resetBall(direction = 1) {
  game.ball.x = WIDTH / 2;
  game.ball.y = HEIGHT / 2;
  const randomY = (Math.random() * 2 - 1) * 3;
  game.ball.vx = INITIAL_BALL_SPEED * direction;
  game.ball.vy = randomY;
}

function clampPaddle(y) {
  return Math.max(0, Math.min(HEIGHT - PADDLE_H, y));
}

function stepGame() {
  game.paddles.left.y = clampPaddle(game.paddles.left.y + game.paddles.left.dy * PADDLE_SPEED);
  game.paddles.right.y = clampPaddle(game.paddles.right.y + game.paddles.right.dy * PADDLE_SPEED);

  game.ball.x += game.ball.vx;
  game.ball.y += game.ball.vy;

  if (game.ball.y <= BALL_SIZE / 2 || game.ball.y >= HEIGHT - BALL_SIZE / 2) {
    game.ball.vy *= -1;
  }

  const leftPaddleX = 20 + PADDLE_W;
  const rightPaddleX = WIDTH - 20 - PADDLE_W;

  const leftHit =
    game.ball.x - BALL_SIZE / 2 <= leftPaddleX &&
    game.ball.x > 20 &&
    game.ball.y >= game.paddles.left.y &&
    game.ball.y <= game.paddles.left.y + PADDLE_H;

  const rightHit =
    game.ball.x + BALL_SIZE / 2 >= rightPaddleX &&
    game.ball.x < WIDTH - 20 &&
    game.ball.y >= game.paddles.right.y &&
    game.ball.y <= game.paddles.right.y + PADDLE_H;

  if (leftHit && game.ball.vx < 0) {
    game.ball.vx = Math.abs(game.ball.vx) + 0.2;
    const offset = (game.ball.y - (game.paddles.left.y + PADDLE_H / 2)) / (PADDLE_H / 2);
    game.ball.vy += offset * 1.5;
  }

  if (rightHit && game.ball.vx > 0) {
    game.ball.vx = -(Math.abs(game.ball.vx) + 0.2);
    const offset = (game.ball.y - (game.paddles.right.y + PADDLE_H / 2)) / (PADDLE_H / 2);
    game.ball.vy += offset * 1.5;
  }

  if (game.ball.x < 0) {
    game.score.right += 1;
    resetBall(1);
  }

  if (game.ball.x > WIDTH) {
    game.score.left += 1;
    resetBall(-1);
  }

  broadcast({
    type: 'state',
    game,
    players: {
      left: [...sessions.values()].filter((s) => s.role === 'left').length,
      right: [...sessions.values()].filter((s) => s.role === 'right').length,
    },
    timestamp: Date.now(),
  });
}

setInterval(stepGame, 1000 / 60);

function chooseRole() {
  const hasLeft = [...sessions.values()].some((s) => s.role === 'left');
  const hasRight = [...sessions.values()].some((s) => s.role === 'right');
  if (!hasLeft) return 'left';
  if (!hasRight) return 'right';
  return 'spectator';
}

function serveFile(res, filePath, contentType = 'text/plain') {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function parseJSON(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    return serveFile(res, path.join(__dirname, 'public', 'index.html'), 'text/html');
  }

  if (req.method === 'GET' && url.pathname === '/game.js') {
    return serveFile(res, path.join(__dirname, 'public', 'game.js'), 'application/javascript');
  }

  if (req.method === 'GET' && url.pathname === '/style.css') {
    return serveFile(res, path.join(__dirname, 'public', 'style.css'), 'text/css');
  }

  if (req.method === 'POST' && url.pathname === '/join') {
    const id = randomUUID();
    const role = chooseRole();
    sessions.set(id, { role, up: false, down: false });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ id, role }));
  }

  if (req.method === 'POST' && url.pathname === '/input') {
    try {
      const { id, up, down } = await parseJSON(req);
      const session = sessions.get(id);
      if (!session) {
        res.writeHead(404);
        return res.end('Session not found');
      }

      session.up = Boolean(up);
      session.down = Boolean(down);

      if (session.role === 'left' || session.role === 'right') {
        game.paddles[session.role].dy = session.down ? 1 : session.up ? -1 : 0;
      }

      res.writeHead(200);
      res.end('ok');
    } catch (error) {
      res.writeHead(400);
      res.end(error.message);
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    clients.add(res);
    sendEvent(res, { type: 'hello' });

    req.on('close', () => {
      clients.delete(res);
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/leave') {
    try {
      const { id } = await parseJSON(req);
      const session = sessions.get(id);
      if (session && (session.role === 'left' || session.role === 'right')) {
        game.paddles[session.role].dy = 0;
      }
      sessions.delete(id);
      res.writeHead(200);
      res.end('bye');
    } catch {
      res.writeHead(400);
      res.end('bad request');
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Ping Pong server running at http://localhost:${PORT}`);
});
