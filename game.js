const LOGICAL_W = 800;
const LOGICAL_H = 520;
const WIN_SECONDS = 20;
const SPEED = 300;
const PADDLE_SPEED = 560;

const canvas = document.getElementById("court");
const ctx = canvas.getContext("2d");

const ui = {
  clock: document.getElementById("clock"),
  dashboard: document.getElementById("dashboard"),
  won: document.getElementById("won"),
  lost: document.getElementById("lost"),
  again: document.getElementById("again"),
  live: document.getElementById("live"),
};

const wall = { y: 22, size: 14, gap: 12 };
const paddle = { x: 0, y: LOGICAL_H - 42, w: 140, h: 16, speed: PADDLE_SPEED };
const ball = { x: LOGICAL_W / 2, y: 150, size: 12, vx: 0, vy: 0 };

const game = {
  state: "play",
  played: 0,
  won: 0,
  lost: 0,
};

const keys = new Set();
let lastFrame = 0;

ui.again.addEventListener("click", startGame);
window.addEventListener("keydown", (event) => {
  if (event.code === "KeyK" || event.code === "KeyL") event.preventDefault();
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());
new ResizeObserver(() => fit()).observe(canvas);

startGame();
requestAnimationFrame(frame);

function startGame() {
  game.state = "play";
  game.played = 0;
  paddle.x = (LOGICAL_W - paddle.w) / 2;
  ball.x = LOGICAL_W / 2;
  ball.y = 120;
  const direction = Math.random() < 0.5 ? -1 : 1;
  setVelocity(direction * 0.16, 1);
  ui.dashboard.hidden = true;
  ui.clock.textContent = `${WIN_SECONDS}s`;
  canvas.focus();
  announce("New game. Last 20 seconds.");
}

function frame(now) {
  const dt = Math.min(0.032, lastFrame ? (now - lastFrame) / 1000 : 0);
  lastFrame = now;
  if (dt > 0 && game.state === "play") {
    movePaddle(dt);
    stepBall(dt);
    game.played += dt;
    const remaining = Math.max(0, WIN_SECONDS - game.played);
    ui.clock.textContent = `${Math.ceil(remaining)}s`;
    if (game.played >= WIN_SECONDS) finish(true);
  }
  fit();
  draw();
  requestAnimationFrame(frame);
}

function movePaddle(dt) {
  const left = keys.has("KeyK");
  const right = keys.has("KeyL");
  if (left === right) return;
  paddle.x += (right ? 1 : -1) * paddle.speed * dt;
  paddle.x = Math.max(0, Math.min(LOGICAL_W - paddle.w, paddle.x));
}

function stepBall(dt) {
  const prevY = ball.y;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  const half = ball.size / 2;

  if (ball.x - half < 0) {
    ball.x = half;
    setVelocity(Math.abs(ball.vx), ball.vy);
  } else if (ball.x + half > LOGICAL_W) {
    ball.x = LOGICAL_W - half;
    setVelocity(-Math.abs(ball.vx), ball.vy);
  }

  const wallLine = wall.y + wall.size;
  if (ball.vy < 0 && ball.y - half <= wallLine) {
    ball.y = wallLine + half;
    setVelocity(ball.vx, Math.abs(ball.vy));
  }

  const prevBottom = prevY + half;
  const bottom = ball.y + half;
  const crossedPaddle = ball.vy > 0 && prevBottom <= paddle.y && bottom >= paddle.y;
  const overlapsPaddle = bottom >= paddle.y
    && ball.y - half <= paddle.y + paddle.h
    && ball.x + half > paddle.x
    && ball.x - half < paddle.x + paddle.w;

  if (ball.vy > 0 && overlapsPaddle && (crossedPaddle || bottom <= paddle.y + paddle.h)) {
    const offset = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
    const clamped = Math.max(-1, Math.min(1, offset));
    ball.y = paddle.y - half;
    setVelocity(clamped * 0.85, -1);
    return;
  }

  if (ball.y - half > LOGICAL_H) finish(false);
}

function setVelocity(x, y) {
  const length = Math.hypot(x, y) || 1;
  ball.vx = (x / length) * SPEED;
  ball.vy = (y / length) * SPEED;
}

function finish(won) {
  if (game.state !== "play") return;
  game.state = "over";
  ball.vx = 0;
  ball.vy = 0;
  if (won) game.won += 1;
  else game.lost += 1;
  ui.won.textContent = String(game.won);
  ui.lost.textContent = String(game.lost);
  ui.dashboard.hidden = false;
  ui.again.focus();
  announce(won
    ? `You win. Games won ${game.won}. Games lost ${game.lost}.`
    : `You lose. Games won ${game.won}. Games lost ${game.lost}.`);
}

function announce(text) {
  ui.live.textContent = text;
}

function fit() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform((rect.width / LOGICAL_W) * dpr, 0, 0, (rect.height / LOGICAL_H) * dpr, 0, 0);
}

function draw() {
  ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(255, 255, 255, 0.9)";
  ctx.shadowBlur = 8;

  const span = wall.size + wall.gap;
  const count = Math.floor((LOGICAL_W - 8) / span);
  const total = count * wall.size + (count - 1) * wall.gap;
  let x = (LOGICAL_W - total) / 2;
  for (let i = 0; i < count; i += 1) {
    ctx.fillRect(x, wall.y, wall.size, wall.size);
    x += span;
  }

  ctx.fillRect(ball.x - ball.size / 2, ball.y - ball.size / 2, ball.size, ball.size);

  const radius = paddle.h / 2;
  ctx.beginPath();
  ctx.roundRect(paddle.x, paddle.y, paddle.w, paddle.h, radius);
  ctx.fill();

  ctx.shadowBlur = 0;
}
