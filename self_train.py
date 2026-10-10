import argparse
import json
import math
from pathlib import Path

import numpy as np
import tensorflow as tf
from tensorflow import keras

GAMMA = 0.99
BATCH_SIZE = 64
UPDATES_PER_RALLY = 8
TARGET_EVERY = 10
BC_EPOCHS = 30
EPSILON_EXPLORE = 0.5
EPSILON_EXPLOIT = 0.2
LEARNING_RATE = 1e-4
SHAPING = 1.0
DT = 1 / 60
LOGICAL_W = 800
LOGICAL_H = 520
WIN_SECONDS = 15
SPEED = 300
PADDLE_SPEED = 560
PADDLE_W = 70
PADDLE_H = 16
PADDLE_Y = LOGICAL_H - 42
BALL_SIZE = 12
WALL_Y = 22
WALL_H = 6

ROOT = Path(__file__).resolve().parent
HUMAN_PATH = ROOT / "rl_tuples.json"
MODEL_PATH = ROOT / "q_model.keras"
WEIGHTS_PATH = ROOT / "model_weights.json"
SELF_PLAY_PATH = ROOT / "self_play_tuples.json"


class Court:
    def reset(self, direction=None):
        self.paddle_x = (LOGICAL_W - PADDLE_W) / 2
        self.x = LOGICAL_W / 2
        self.y = 120.0
        if direction is None:
            direction = -1 if np.random.random() < 0.5 else 1
        self.set_velocity(direction * 0.07, 1)
        self.played = 0.0

    def set_velocity(self, x, y):
        length = math.hypot(x, y) or 1.0
        self.vx = (x / length) * SPEED
        self.vy = (y / length) * SPEED

    def state(self):
        return np.array(
            [
                self.x / LOGICAL_W,
                self.y / LOGICAL_H,
                self.vx / SPEED,
                self.vy / SPEED,
                (self.paddle_x + PADDLE_W / 2) / LOGICAL_W,
            ],
            dtype=np.float32,
        )

    def step(self, action):
        prev_vy = self.vy / SPEED
        if action != 1:
            direction = 1 if action == 2 else -1
            self.paddle_x += direction * PADDLE_SPEED * DT
            self.paddle_x = min(max(self.paddle_x, 0), LOGICAL_W - PADDLE_W)

        lost = self.step_ball()
        self.played += DT
        won = not lost and self.played >= WIN_SECONDS
        done = lost or won
        returned = False
        if done:
            reward = 1.0 if won else -1.0
            nxt = np.zeros(5, dtype=np.float32)
            outcome = "win" if won else "loss"
        else:
            nxt = self.state()
            returned = prev_vy > 0.2 and float(nxt[3]) < -0.2 and float(nxt[1]) > 0.75
            reward = 1.0 if returned else 0.0
            outcome = "play"
        return nxt, reward, done, returned, outcome

    def step_ball(self):
        prev_y = self.y
        self.x += self.vx * DT
        self.y += self.vy * DT
        half = BALL_SIZE / 2

        if self.x - half < 0:
            self.x = half
            self.set_velocity(abs(self.vx), self.vy)
        elif self.x + half > LOGICAL_W:
            self.x = LOGICAL_W - half
            self.set_velocity(-abs(self.vx), self.vy)

        wall_line = WALL_Y + WALL_H
        if self.vy < 0 and self.y - half <= wall_line:
            self.y = wall_line + half
            self.set_velocity(self.vx, abs(self.vy))

        prev_bottom = prev_y + half
        bottom = self.y + half
        crossed = self.vy > 0 and prev_bottom <= PADDLE_Y and bottom >= PADDLE_Y
        overlaps = (
            bottom >= PADDLE_Y
            and self.y - half <= PADDLE_Y + PADDLE_H
            and self.x + half > self.paddle_x
            and self.x - half < self.paddle_x + PADDLE_W
        )
        if self.vy > 0 and overlaps and (crossed or bottom <= PADDLE_Y + PADDLE_H):
            offset = (self.x - (self.paddle_x + PADDLE_W / 2)) / (PADDLE_W / 2)
            clamped = max(-1.0, min(1.0, offset))
            self.y = PADDLE_Y - half
            self.set_velocity(clamped * 0.85, -1)
            return False

        return self.y - half > LOGICAL_H


def layer_weights(model):
    layers = []
    for layer in model.layers:
        weights = layer.get_weights()
        if len(weights) == 2:
            layers.append((weights[0], weights[1]))
    return layers


def forward(layers, state):
    values = state
    for index, (kernel, bias) in enumerate(layers):
        values = values @ kernel + bias
        if index < len(layers) - 1:
            values = np.maximum(values, 0)
    return values


def choose_action(layers, state, epsilon):
    if np.random.random() < epsilon:
        return int(np.random.randint(0, 3))
    return int(forward(layers, state).argmax())


def play_rally(layers, epsilon, force_action=None, direction=None):
    court = Court()
    court.reset(direction)
    states = []
    actions = []
    rewards = []
    next_states = []
    dones = []
    returns = 0
    outcome = "play"
    for _ in range(int(WIN_SECONDS / DT) + 5):
        state = court.state()
        action = force_action if force_action is not None else choose_action(layers, state, epsilon)
        nxt, reward, done, returned, outcome = court.step(action)
        states.append(state)
        actions.append(action)
        rewards.append(reward)
        next_states.append(nxt)
        dones.append(1.0 if done else 0.0)
        if returned:
            returns += 1
        if done:
            break
    return {
        "states": np.asarray(states, dtype=np.float32),
        "actions": np.asarray(actions, dtype=np.int32),
        "rewards": np.asarray(rewards, dtype=np.float32),
        "next_states": np.asarray(next_states, dtype=np.float32),
        "dones": np.asarray(dones, dtype=np.float32),
        "returns": returns,
        "outcome": outcome,
        "seconds": court.played,
    }


def summarize(rallies):
    count = len(rallies)
    returns = sum(rally["returns"] for rally in rallies) / count
    wins = sum(rally["outcome"] == "win" for rally in rallies)
    seconds = sum(rally["seconds"] for rally in rallies) / count
    return returns, wins, count, seconds


def load_human():
    rows = json.loads(HUMAN_PATH.read_text(encoding="utf-8"))["tuples"]
    return {
        "states": np.array([row["state"] for row in rows], dtype=np.float32),
        "actions": np.array([row["action_index"] for row in rows], dtype=np.int32),
        "rewards": np.array([row["reward"] for row in rows], dtype=np.float32),
        "next_states": np.array([row["next_state"] for row in rows], dtype=np.float32),
        "dones": np.array([1.0 if row["done"] else 0.0 for row in rows], dtype=np.float32),
    }


def append_rows(store, rally):
    if store["states"].shape[0] == 0:
        return {key: rally[key] for key in ("states", "actions", "rewards", "next_states", "dones")}
    return {
        key: np.concatenate([store[key], rally[key]])
        for key in ("states", "actions", "rewards", "next_states", "dones")
    }


def sample_batch(human, self_play):
    if self_play["states"].shape[0] == 0:
        index = np.random.randint(0, human["actions"].shape[0], size=BATCH_SIZE)
        return tuple(human[key][index] for key in ("states", "actions", "rewards", "next_states", "dones"))
    human_count = BATCH_SIZE // 2
    self_count = BATCH_SIZE - human_count
    human_index = np.random.randint(0, human["actions"].shape[0], size=human_count)
    self_index = np.random.randint(0, self_play["actions"].shape[0], size=self_count)
    rows = []
    for key in ("states", "actions", "rewards", "next_states", "dones"):
        rows.append(np.concatenate([human[key][human_index], self_play[key][self_index]]))
    return tuple(rows)


def make_model():
    return keras.Sequential(
        [
            keras.layers.Input(shape=(5,)),
            keras.layers.Dense(64, activation="relu"),
            keras.layers.Dense(64, activation="relu"),
            keras.layers.Dense(3),
        ]
    )


def gap_bonus(states, nxt, dones):
    previous = np.abs(states[:, 0] - states[:, 4])
    following = np.abs(nxt[:, 0] - nxt[:, 4])
    return (previous - following) * SHAPING * (1.0 - dones)


def behavior_clone(model, human):
    actions = human["actions"]
    counts = np.bincount(actions, minlength=3).astype(np.float32)
    class_weight = counts.sum() / (3.0 * np.maximum(counts, 1.0))
    sample_weight = class_weight[actions]
    optimizer = keras.optimizers.Adam(learning_rate=1e-3)
    loss_fn = keras.losses.SparseCategoricalCrossentropy(from_logits=True)
    index = np.arange(actions.shape[0])
    for epoch in range(1, BC_EPOCHS + 1):
        np.random.shuffle(index)
        losses = []
        for start in range(0, len(index), BATCH_SIZE):
            batch = index[start : start + BATCH_SIZE]
            with tf.GradientTape() as tape:
                logits = model(human["states"][batch], training=True)
                loss = loss_fn(actions[batch], logits, sample_weight=sample_weight[batch])
            gradients = tape.gradient(loss, model.trainable_weights)
            optimizer.apply_gradients(zip(gradients, model.trainable_weights))
            losses.append(float(loss))
        if epoch % 5 != 0 and epoch != BC_EPOCHS:
            continue
        predicted = model(human["states"], training=False).numpy().argmax(axis=1)
        match = float((predicted == actions).mean())
        per_class = []
        for action in range(3):
            mask = actions == action
            per_class.append(float((predicted[mask] == action).mean()) if mask.any() else 0.0)
        print(
            f"clone epoch {epoch:02d} loss {np.mean(losses):.4f} match {match:.3f} "
            f"left {per_class[0]:.2f} idle {per_class[1]:.2f} right {per_class[2]:.2f}",
            flush=True,
        )


def train_batch(model, target, optimizer, loss_fn, batch):
    states, actions, rewards, nxt, dones = batch
    next_q = target(nxt, training=False)
    best_next = tf.reduce_max(next_q, axis=1)
    shaped = rewards + gap_bonus(states, nxt, dones)
    target_value = shaped + GAMMA * best_next * (1.0 - dones)
    with tf.GradientTape() as tape:
        q_values = model(states, training=True)
        chosen = tf.gather(q_values, actions, batch_dims=1)
        loss = loss_fn(target_value, chosen)
    gradients = tape.gradient(loss, model.trainable_weights)
    optimizer.apply_gradients(zip(gradients, model.trainable_weights))
    return float(loss)


def export_weights(model):
    layers = []
    for layer in model.layers:
        weights = layer.get_weights()
        if len(weights) != 2:
            continue
        kernel, bias = weights
        layers.append({"kernel": kernel.tolist(), "bias": bias.tolist()})
    WEIGHTS_PATH.write_text(json.dumps({"layers": layers}), encoding="utf-8")


def write_self_play(store, rallies):
    lines = []
    frame_returns = 0
    wins = 0
    losses = 0
    for round_number, rally in enumerate(rallies, start=1):
        count = len(rally["actions"])
        for index in range(count):
            done = bool(rally["dones"][index])
            reward = float(rally["rewards"][index])
            if done and reward > 0:
                wins += 1
            elif done:
                losses += 1
            elif reward > 0:
                frame_returns += 1
            state = ",".join(f"{value:.5f}" for value in rally["states"][index])
            nxt = "0,0,0,0,0" if done else ",".join(f"{value:.5f}" for value in rally["next_states"][index])
            action_index = int(rally["actions"][index])
            action = (-1, 0, 1)[action_index]
            lines.append(
                '{"round":%d,"state":[%s],"action":%d,"action_index":%d,"reward":%s,"next_state":[%s],"done":%s}'
                % (
                    round_number,
                    state,
                    action,
                    action_index,
                    f"{reward:.5f}".rstrip("0").rstrip("."),
                    nxt,
                    "true" if done else "false",
                )
            )
    body = {
        "task": "self-play reinforcement learning transitions",
        "epsilon": {"explore": EPSILON_EXPLORE, "after_greedy_return": EPSILON_EXPLOIT},
        "gap_shaping": SHAPING,
        "state_features": ["x", "y", "vx", "vy", "paddleX"],
        "counts": {
            "tuples": len(lines),
            "paddle_returns": frame_returns,
            "wins": wins,
            "losses": losses,
        },
    }
    text = json.dumps(body, indent=2)
    text = text[:-2] + ',\n  "tuples": [\n    ' + ",\n    ".join(lines) + "\n  ]\n}\n"
    SELF_PLAY_PATH.write_text(text, encoding="utf-8")
    return body["counts"]


def serve_check(layers):
    rallies = []
    parts = []
    for direction, name in ((-1, "left"), (1, "right")):
        rally = play_rally(layers, 0, direction=direction)
        rallies.append(rally)
        parts.append(
            f"{name} {rally['outcome']} {rally['seconds']:.1f}s returns {rally['returns']}"
        )
    return rallies, " | ".join(parts)


def keep_if_both_return(model, rallies, best):
    if any(rally["returns"] < 1 for rally in rallies):
        return False
    total = sum(rally["returns"] for rally in rallies)
    seconds = sum(rally["seconds"] for rally in rallies) / len(rallies)
    if total < best["returns"] or (total == best["returns"] and seconds <= best["seconds"]):
        return False
    best["returns"] = total
    best["seconds"] = seconds
    best["weights"] = model.get_weights()
    model.save(MODEL_PATH)
    export_weights(model)
    print(f"saved weights, greedy returns {total}, mean {seconds:.1f}s", flush=True)
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rallies", type=int, default=80)
    args = parser.parse_args()

    human = load_human()
    human_returns = int(((human["rewards"] > 0) & (human["dones"] == 0)).sum())
    print(
        f"human tuples {human['actions'].shape[0]} returns {human_returns} rounds 1-3",
        flush=True,
    )
    model = make_model()
    behavior_clone(model, human)
    target = keras.models.clone_model(model)
    target.set_weights(model.get_weights())
    optimizer = keras.optimizers.Adam(learning_rate=LEARNING_RATE)
    loss_fn = keras.losses.MeanSquaredError()

    layers = layer_weights(model)
    cloned, cloned_text = serve_check(layers)
    print(f"after clone {cloned_text}", flush=True)
    best = {"returns": -1, "seconds": 0.0, "weights": None}
    keep_if_both_return(model, cloned, best)

    self_play = {
        "states": np.zeros((0, 5), dtype=np.float32),
        "actions": np.zeros((0,), dtype=np.int32),
        "rewards": np.zeros((0,), dtype=np.float32),
        "next_states": np.zeros((0, 5), dtype=np.float32),
        "dones": np.zeros((0,), dtype=np.float32),
    }
    played = []
    epsilon = EPSILON_EXPLORE if best["weights"] is None else EPSILON_EXPLOIT
    for rally_number in range(1, args.rallies + 1):
        layers = layer_weights(model)
        rally = play_rally(layers, epsilon)
        played.append(rally)
        self_play = append_rows(self_play, rally)
        losses = []
        for _ in range(UPDATES_PER_RALLY):
            losses.append(train_batch(model, target, optimizer, loss_fn, sample_batch(human, self_play)))
        if rally_number % TARGET_EVERY == 0:
            target.set_weights(model.get_weights())
        recent = played[-20:]
        recent_returns = sum(item["returns"] for item in recent) / len(recent)
        print(
            f"rally {rally_number:03d} {rally['outcome']} {rally['seconds']:.1f}s "
            f"returns {rally['returns']} recent20 {recent_returns:.2f} "
            f"epsilon {epsilon:.1f} loss {np.mean(losses):.4f}",
            flush=True,
        )
        if rally_number % 5 == 0:
            layers = layer_weights(model)
            check, text = serve_check(layers)
            print(f"greedy check {text}", flush=True)
            if keep_if_both_return(model, check, best):
                epsilon = EPSILON_EXPLOIT

    if best["weights"] is not None:
        model.set_weights(best["weights"])
        export_weights(model)
        model.save(MODEL_PATH)
        _, text = serve_check(layer_weights(model))
        print(f"best weights {text}", flush=True)
    else:
        print("no greedy rally returned the ball, weights left unchanged", flush=True)
    if played:
        counts = write_self_play(self_play, played)
        print(
            f"saved {SELF_PLAY_PATH} tuples {counts['tuples']} "
            f"returns {counts['paddle_returns']} wins {counts['wins']} losses {counts['losses']}"
        )


if __name__ == "__main__":
    main()
