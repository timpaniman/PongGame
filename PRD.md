# Pong PRD

## 1. Document Control

| Field | Value |
| :--- | :--- |
| Author | Kevin Lee |
| Status | Draft, describing the build as of 2026-10-09 |
| Product | One-player Pong web app |
| Files | `index.html`, `styles.css`, `game.js` |

This document records what the current app does. It is not a plan for later reinforcement-learning work.

## 2. Summary

A person plays a single rally in the browser. A paddle sits on the bottom of a black court and moves left and right. A ball travels around the court, bounces off the side edges and a bar across the top, and must be returned by the paddle.

The rally lasts 20 seconds. Lasting the full 20 seconds wins the game. Letting the ball pass the bottom of the court loses it. After each game, the page shows how many games have been won and lost in this visit, and offers another game.

Anyone can open the page and play. There is no account, server, or saved history.

## 3. Who it is for

The player is one person at the keyboard. The paddle is always controlled by that person. There is no computer opponent and no second human player.

## 4. User story

| ID | As a... | I want to... | So that... | Priority |
| :--- | :--- | :--- | :--- | :--- |
| US-01 | Human player | Move the bottom paddle and keep the ball in play | I can win by lasting 20 seconds, or see a loss when I miss | P0 |

## 5. What the app does

### 5.1 Start a game

- The game starts as soon as the page loads.
- The paddle begins centered on the bottom.
- The ball begins in the upper half of the court and moves downward, with a small random drift to the left or right.
- A countdown in the header starts at `20s`.
- The court is a canvas that fills the play area and stays sharp on high-density screens.

### 5.2 Move the paddle

- `K` moves the paddle left.
- `L` moves the paddle right.
- Holding a key keeps the paddle moving. Pressing both keys at once leaves it still.
- The paddle cannot leave the left or right edge of the court.
- The same controls are written beside the title and again under the court.

### 5.3 Ball and court

- The court background is black.
- The top boundary is a solid red horizontal bar. When the ball hits it, the ball is sent back down. Its horizontal direction stays the same.
- The ball is a small white square with a soft white glow.
- The paddle is a short white rounded bar, also glowing, sitting near the bottom.
- The ball bounces off the left and right edges. Those edges are not drawn.
- Ball speed stays constant. Where the ball meets the paddle changes its horizontal angle: a hit near the center sends it more straight up, and a hit near either end sends it out toward that side.
- If the ball passes the bottom of the court without a return, the game is a loss.

### 5.4 Win, loss, and the tally

- The header countdown shows the remaining whole seconds.
- If the ball is still in play when 20 seconds have elapsed, the game is a win.
- The tally counts games in the current page visit only. Refreshing the page starts the counts again at zero.
- At the end of a game the court is covered by a panel with:
  1. `Games won: N`
  2. `Games lost: N`
  3. A `Play again` button
- `Play again` starts a new rally and keeps the running tally.
- A screen-reader announcement reports the new game, and whether the last game was a win or a loss, including both counts.

## 6. How it looks and feels

- Black page, white type, white ball, and white paddle.
- The top wall is red (`#ff2a2a`), which is the one colored element on the court.
- The countdown sits at the right of the header.
- The end panel is centered on the court, with white text and a white `Play again` button.
- The layout fits a narrow window: the title and control line wrap, and the type gets slightly smaller.

## 7. How it runs

- Static files only. Open `index.html` in a browser, or serve the folder with any static file server.
- No install step, no build, and no network calls.
- The animation loop is capped so a paused tab does not send the ball through the paddle in one jump.
- Leaving the browser window releases the movement keys so the paddle does not stick.

## 8. Explicitly not in this build

- Accounts or sign-in
- A second paddle, a computer opponent, or two-player controls
- Sound
- A saved tally after refresh
- Recording rallies, or any model training
- A right-hand scoreboard or a second on-screen panel during play

## 9. Later, if the learning goal continues

The reason for this game is to have a simple human rally that can later supply examples to a feed-forward model. That work is not started. A later phase would need a defined record of each moment (paddle position, ball position and velocity, and the key being held) and a way to store those records beyond the browser tab.
