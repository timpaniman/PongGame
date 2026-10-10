import json
from pathlib import Path

import numpy as np
import tensorflow as tf
from tensorflow import keras

GAMMA = 0.99
EPOCHS = 30
BATCH_SIZE = 64
ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "rl_tuples.json"
MODEL_PATH = ROOT / "q_model.keras"


def load_tuples():
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    rows = data["tuples"]
    states = np.array([row["state"] for row in rows], dtype=np.float32)
    actions = np.array([row["action_index"] for row in rows], dtype=np.int32)
    rewards = np.array([row["reward"] for row in rows], dtype=np.float32)
    next_states = np.array([row["next_state"] for row in rows], dtype=np.float32)
    dones = np.array([row["done"] for row in rows], dtype=np.float32)
    rounds = np.array([row["round"] for row in rows], dtype=np.int32)
    return states, actions, rewards, next_states, dones, rounds


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
    return (previous - following) * (1.0 - dones)


def train():
    states, actions, rewards, next_states, dones, rounds = load_tuples()
    train_index = np.arange(len(states))
    print(f"tuples {len(states)} rounds {int(rounds.min())}-{int(rounds.max())}")

    model = make_model()
    clone_optimizer = keras.optimizers.Adam(learning_rate=1e-3)
    clone_loss = keras.losses.SparseCategoricalCrossentropy(from_logits=True)
    counts = np.bincount(actions, minlength=3).astype(np.float32)
    class_weight = counts.sum() / (3.0 * np.maximum(counts, 1.0))
    sample_weight = class_weight[actions]
    for epoch in range(1, 16):
        np.random.shuffle(train_index)
        losses = []
        for start in range(0, len(train_index), BATCH_SIZE):
            batch = train_index[start : start + BATCH_SIZE]
            with tf.GradientTape() as tape:
                logits = model(states[batch], training=True)
                loss = clone_loss(actions[batch], logits, sample_weight=sample_weight[batch])
            gradients = tape.gradient(loss, model.trainable_weights)
            clone_optimizer.apply_gradients(zip(gradients, model.trainable_weights))
            losses.append(float(loss))
        print(f"clone epoch {epoch:02d} loss {np.mean(losses):.4f}")

    target = make_model()
    target.set_weights(model.get_weights())
    optimizer = keras.optimizers.Adam(learning_rate=1e-4)
    loss_fn = keras.losses.MeanSquaredError()

    for epoch in range(1, EPOCHS + 1):
        np.random.shuffle(train_index)
        losses = []
        for start in range(0, len(train_index), BATCH_SIZE):
            batch = train_index[start : start + BATCH_SIZE]
            state = states[batch]
            action = actions[batch]
            reward = rewards[batch]
            nxt = next_states[batch]
            done = dones[batch]
            next_q = target(nxt, training=False)
            best_next = tf.reduce_max(next_q, axis=1)
            shaped = reward + gap_bonus(state, nxt, done)
            target_value = shaped + GAMMA * best_next * (1.0 - done)

            with tf.GradientTape() as tape:
                q_values = model(state, training=True)
                chosen = tf.gather(q_values, action, batch_dims=1)
                loss = loss_fn(target_value, chosen)
            gradients = tape.gradient(loss, model.trainable_weights)
            optimizer.apply_gradients(zip(gradients, model.trainable_weights))
            losses.append(float(loss))

        if epoch % 5 == 0:
            target.set_weights(model.get_weights())

        predicted = model(states, training=False).numpy().argmax(axis=1)
        match = float((predicted == actions).mean())
        print(f"epoch {epoch:02d} loss {np.mean(losses):.4f} action_match {match:.3f}")

    model.save(MODEL_PATH)
    print(f"saved {MODEL_PATH}")


if __name__ == "__main__":
    train()
