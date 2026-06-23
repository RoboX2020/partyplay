# PartyPlay Live Showcase

One player at a time, projected live on the big screen — like an arcade cabinet
everyone gathers around.

Players scan a QR code, join a **queue**, and whoever is **first in line** plays
on their phone. Their game is **streamed live** to the host screen so the whole
room can watch, cheer, and compare scores.

> The previous **multiplayer Kahoot-style** version is backed up in
> [`backup/partyplay-multiplayer/`](backup/partyplay-multiplayer/).

## How it works

1. Open **Host** on a TV / projector. A QR code and room code appear.
2. Players scan and join the **queue** on their phones.
3. Host picks an arcade game and clicks **Open the floor**.
4. The **first player in line** plays on their phone — the host screen shows their
   game **live** (score + video feed).
5. When their run ends, scores flash on screen and the **next player** goes
   automatically.

## Arcade games

| Game | Emoji | What you do |
|------|-------|-------------|
| **Street Racer** | 🏎️ | Dodge traffic — one crash ends your run |
| **Power Cricket** | 🏏 | Time your taps to bat |
| **Sky Hopper** | 🐤 | Tap to fly through gaps |
| **Gravity Run** | 🌀 | Flip gravity to dodge blocks |
| **Stack Tower** | 🧱 | Drop blocks and stack high |
| **Brick Breaker** | 🧊 | Bounce the ball, smash bricks |

Best scores are tracked on a **hall of fame** for the session.

## Run it

```bash
npm install
npm start
```

- **Host:** `http://localhost:3000/host`
- **Players:** scan the QR or open `http://<your-ip>:3000/play`

Set `HOST_IP=192.168.1.42 npm start` if LAN detection fails.

## Tech

- Node.js + Express + Socket.IO
- Live projection via JPEG frame streaming (~8 fps) from player canvas → host screen
- Vanilla HTML/CSS/JS (no build step)

## Structure

```
server.js              # Queue, turns, live frame relay
src/games.js           # Arcade game definitions
public/js/host.js      # Projection + queue UI
public/js/play.js      # Queue, play, frame capture
public/js/arcade.js    # Canvas mini-games
backup/                # Snapshot of old multiplayer version
```
