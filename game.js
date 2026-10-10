const LOGICAL_W = 800;
const LOGICAL_H = 520;
const WIN_SECONDS = 15;
const SESSION_GAMES = 10;
const SPEED = 300;
const PADDLE_SPEED = 560;

const canvas = document.getElementById("court");
const ctx = canvas.getContext("2d");

const ui = {
  clock: document.getElementById("clock"),
  dashboard: document.getElementById("dashboard"),
  won: document.getElementById("won"),
  lost: document.getElementById("lost"),
  sessionWon: document.getElementById("session-won"),
  sessionLost: document.getElementById("session-lost"),
  again: document.getElementById("again"),
  download: document.getElementById("download"),
  rallyPanel: document.getElementById("rally-panel"),
  sessionPanel: document.getElementById("session-panel"),
  resultRallies: document.getElementById("result-rallies"),
  resultHits: document.getElementById("result-hits"),
  resultMisses: document.getElementById("result-misses"),
  newSession: document.getElementById("new-session"),
  watch: document.getElementById("watch"),
  controls: document.getElementById("controls"),
  live: document.getElementById("live"),
};

const wall = { y: 22, h: 6 };
const paddle = { x: 0, y: LOGICAL_H - 42, w: 70, h: 16, speed: PADDLE_SPEED };
const ball = { x: LOGICAL_W / 2, y: 150, size: 12, vx: 0, vy: 0 };

const game = {
  state: "play",
  played: 0,
  won: 0,
  lost: 0,
  hits: 0,
  misses: 0,
};

const keys = new Set();
let modelMode = false;
let modelWeights = null;
let modelHits = 0;
let modelRestart = 0;
let sessionClosed = false;
let lastFrame = 0;
let framesSinceFlush = 0;
let flushBusy = false;
let flushAgain = false;

const telemetry = {
  session: new Date().toISOString(),
  features: ["state.x", "state.y", "state.vx", "state.vy", "state.paddleX"],
  normalization: {
    x: "ball center x / court width",
    y: "ball center y / court height, 0 at the top",
    vx: "ball vx / 300",
    vy: "ball vy / 300",
    paddleX: "paddle center x / court width",
  },
  rounds: [],
};

ui.again.addEventListener("click", () => {
  if (sessionClosed) return;
  modelMode = false;
  ui.watch.textContent = "Watch model";
  startGame();
});
ui.newSession.addEventListener("click", startNewSession);
ui.download.addEventListener("click", downloadTelemetry);
ui.watch.addEventListener("click", () => {
  if (sessionClosed) return;
  if (modelMode) {
    modelMode = false;
    ui.watch.textContent = "Watch model";
    startGame();
    return;
  }
  startModelPlay();
});
window.addEventListener("keydown", (event) => {
  if (event.code === "KeyK" || event.code === "KeyL") event.preventDefault();
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());
window.addEventListener("pagehide", () => {
  if (modelMode) return;
  const body = JSON.stringify({
    session: telemetry.session,
    features: telemetry.features,
    normalization: telemetry.normalization,
    rounds: telemetry.rounds,
  });
  navigator.sendBeacon("/telemetry", new Blob([body], { type: "application/json" }));
});
new ResizeObserver(() => fit()).observe(canvas);

if (new URLSearchParams(location.search).get("model") === "1") {
  startModelPlay();
} else {
  startGame();
}
requestAnimationFrame(frame);

function startNewSession() {
  window.clearTimeout(modelRestart);
  sessionClosed = false;
  modelMode = false;
  ui.watch.textContent = "Watch model";
  game.won = 0;
  game.lost = 0;
  game.hits = 0;
  game.misses = 0;
  showTally();
  telemetry.session = new Date().toISOString();
  telemetry.rounds = [];
  ui.sessionPanel.hidden = true;
  ui.rallyPanel.hidden = false;
  ui.dashboard.hidden = true;
  startGame();
}

function startGame() {
  if (sessionClosed) return;
  game.state = "play";
  game.played = 0;
  modelHits = 0;
  paddle.x = (LOGICAL_W - paddle.w) / 2;
  ball.x = LOGICAL_W / 2;
  ball.y = 120;
  const direction = Math.random() < 0.5 ? -1 : 1;
  setVelocity(direction * 0.07, 1);
  if (!modelMode) {
    telemetry.rounds.push({
      round: telemetry.rounds.length + 1,
      result: "playing",
      tuples: [],
    });
    framesSinceFlush = 0;
    ui.controls.textContent = "Use K to move left, L to move right";
    announce("New game. Last 15 seconds.");
  } else {
    ui.controls.textContent = "Model is playing";
    announce("Model is playing.");
  }
  ui.dashboard.hidden = true;
  ui.clock.textContent = `${WIN_SECONDS}s`;
  canvas.focus();
}

function startModelPlay() {
  const begin = () => {
    modelMode = true;
    ui.watch.textContent = "Play yourself";
    startGame();
  };
  if (modelWeights) {
    begin();
    return;
  }
  fetch("model_weights.json")
    .then((response) => response.json())
    .then((data) => {
      modelWeights = data;
      begin();
    })
    .catch(() => {
      ui.controls.textContent = "Model weights did not load.";
    });
}

function frame(now) {
  try {
    const dt = Math.min(0.032, lastFrame ? (now - lastFrame) / 1000 : 0);
    lastFrame = now;
    if (dt > 0 && game.state === "play") {
      if (!modelMode) recordTuple();
      movePaddle(dt);
      stepBall(dt);
      game.played += dt;
      const remaining = Math.max(0, WIN_SECONDS - game.played);
      ui.clock.textContent = `${Math.ceil(remaining)}s`;
      if (game.state === "play" && game.played >= WIN_SECONDS) finish(true);
      if (!modelMode) {
        framesSinceFlush += 1;
        if (framesSinceFlush >= 30 || game.state !== "play") flushTelemetry();
      }
    }
    fit();
    draw();
  } catch (error) {
    console.error(error);
  }
  requestAnimationFrame(frame);
}

function movePaddle(dt) {
  if (modelMode) {
    const action = modelAction();
    if (action === 1) return;
    paddle.x += (action === 2 ? 1 : -1) * paddle.speed * dt;
    paddle.x = Math.max(0, Math.min(LOGICAL_W - paddle.w, paddle.x));
    return;
  }
  const left = keys.has("KeyK");
  const right = keys.has("KeyL");
  if (left === right) return;
  paddle.x += (right ? 1 : -1) * paddle.speed * dt;
  paddle.x = Math.max(0, Math.min(LOGICAL_W - paddle.w, paddle.x));
}

function modelAction() {
  const state = [
    ball.x / LOGICAL_W,
    ball.y / LOGICAL_H,
    ball.vx / SPEED,
    ball.vy / SPEED,
    (paddle.x + paddle.w / 2) / LOGICAL_W,
  ];
  let values = state;
  modelWeights.layers.forEach((layer, index) => {
    values = dense(values, layer.kernel, layer.bias, index < modelWeights.layers.length - 1);
  });
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[best]) best = i;
  }
  return best;
}

function dense(input, kernel, bias, relu) {
  const output = new Array(bias.length);
  for (let column = 0; column < bias.length; column += 1) {
    let sum = bias[column];
    for (let row = 0; row < input.length; row += 1) {
      sum += input[row] * kernel[row][column];
    }
    output[column] = relu ? Math.max(0, sum) : sum;
  }
  return output;
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

  const wallLine = wall.y + wall.h;
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
    game.hits += 1;
    if (modelMode) modelHits += 1;
    return;
  }

  if (ball.y - half > LOGICAL_H) finish(false);
}

function setVelocity(x, y) {
  const length = Math.hypot(x, y) || 1;
  ball.vx = (x / length) * SPEED;
  ball.vy = (y / length) * SPEED;
}

function currentRound() {
  return telemetry.rounds[telemetry.rounds.length - 1];
}

function recordTuple() {
  const round = currentRound();
  if (!round || round.result !== "playing") return;
  const left = keys.has("KeyK");
  const right = keys.has("KeyL");
  let action = 0;
  if (left !== right) action = right ? 1 : -1;
  round.tuples.push({
    state: {
      x: scale(ball.x / LOGICAL_W),
      y: scale(ball.y / LOGICAL_H),
      vx: scale(ball.vx / SPEED),
      vy: scale(ball.vy / SPEED),
      paddleX: scale((paddle.x + paddle.w / 2) / LOGICAL_W),
    },
    action,
  });
}

function scale(value) {
  return Math.round(value * 100000) / 100000;
}

function flushTelemetry() {
  framesSinceFlush = 0;
  if (flushBusy) {
    flushAgain = true;
    return;
  }
  flushBusy = true;
  fetch("/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session: telemetry.session,
      features: telemetry.features,
      normalization: telemetry.normalization,
      rounds: telemetry.rounds,
    }, null, 2),
  }).finally(() => {
    flushBusy = false;
    if (flushAgain) {
      flushAgain = false;
      flushTelemetry();
    }
  });
}

function downloadTelemetry() {
  const blob = new Blob([JSON.stringify(telemetry, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "telemetry.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

function showTally() {
  const won = String(game.won);
  const lost = String(game.lost);
  ui.won.textContent = won;
  ui.lost.textContent = lost;
  ui.sessionWon.textContent = won;
  ui.sessionLost.textContent = lost;
}

function finish(won) {
  if (game.state !== "play") return;
  game.state = "over";
  ball.vx = 0;
  ball.vy = 0;
  if (won) game.won += 1;
  else {
    game.lost += 1;
    game.misses += 1;
  }
  showTally();
  if (!modelMode) {
    const round = currentRound();
    if (round) round.result = won ? "win" : "loss";
  }
  if (game.won + game.lost >= SESSION_GAMES) {
    window.clearTimeout(modelRestart);
    sessionClosed = true;
    showSessionResult();
    return;
  }
  if (modelMode) {
    const outcome = won ? "win" : "loss";
    ui.controls.textContent = `Model ${outcome} after ${game.played.toFixed(1)}s. Returns ${modelHits}.`;
    announce(`Model ${outcome} after ${game.played.toFixed(1)} seconds. ${modelHits} returns.`);
    window.clearTimeout(modelRestart);
    modelRestart = window.setTimeout(() => {
      if (modelMode) startGame();
    }, 1200);
    return;
  }
  ui.sessionPanel.hidden = true;
  ui.rallyPanel.hidden = false;
  ui.dashboard.hidden = false;
  ui.again.focus();
  announce(won
    ? `You win. Games won ${game.won}. Games lost ${game.lost}.`
    : `You lose. Games won ${game.won}. Games lost ${game.lost}.`);
}

function showSessionResult() {
  const rallies = game.won + game.lost;
  ui.resultRallies.textContent = String(rallies);
  ui.resultHits.textContent = String(game.hits);
  ui.resultMisses.textContent = String(game.misses);
  ui.rallyPanel.hidden = true;
  ui.sessionPanel.hidden = false;
  ui.dashboard.hidden = false;
  ui.newSession.focus();
  announce(`Session complete. ${rallies} rallies. ${game.hits} hits. ${game.misses} misses.`);
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

  ctx.fillStyle = "#ff2a2a";
  ctx.fillRect(0, wall.y, LOGICAL_W, wall.h);

  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(255, 255, 255, 0.9)";
  ctx.shadowBlur = 8;
  ctx.fillRect(ball.x - ball.size / 2, ball.y - ball.size / 2, ball.size, ball.size);

  const radius = paddle.h / 2;
  ctx.beginPath();
  ctx.roundRect(paddle.x, paddle.y, paddle.w, paddle.h, radius);
  ctx.fill();

  ctx.shadowBlur = 0;
}
