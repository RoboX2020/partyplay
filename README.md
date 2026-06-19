# 🎉 PartyPlay

A **Kahoot-style live party game system**. Host a game night on the big screen,
and players join instantly from their phones by scanning a QR code — no app
install needed. Everyone competes in fast, friendly mini-games while live
scores update on the host screen, and a winner is crowned at the end.

## ✨ How it works

1. Open the **Host** screen on a TV / laptop / projector. It shows a **4‑letter
   room code** and a **QR code**.
2. Players **scan the QR code** (or open the join page and type the code) on
   their phones. Multiple players can join the same room.
3. The host picks one of the mini‑games and hits **Start**.
4. Everyone plays on their phone. The host screen shows the question, a live
   "answered" counter, and a **live leaderboard** after every round.
5. When the game ends, the **podium + winner** is displayed with confetti. 🏆

## 🎮 The games

| Game | Emoji | What you do |
|------|-------|-------------|
| **Trivia Quiz** | 🧠 | Answer general-knowledge questions — fast + correct scores big |
| **Math Blitz** | ➗ | Solve arithmetic faster than everyone else |
| **Color Trap** | 🎨 | Tap the *ink color* of the word, not what it spells (Stroop test) |
| **Reaction Rush** | ⚡ | Wait for GREEN, then tap as fast as you can |
| **Tap Battle** | 👆 | Tap as many times as possible before time runs out |

Scoring is cumulative across all rounds; correct + speedy answers earn the most.

## 🚀 Run it

```bash
npm install
npm start
```

Then:

- **Host screen:** open `http://localhost:3000` and click **Host a Game**.
- **Players:** on phones connected to the **same Wi‑Fi**, scan the QR code shown
  on the host screen, or open `http://<your-computer-ip>:3000/play` and enter the
  room code.

> The server auto-detects your LAN IP for the QR link. If detection fails, set it
> manually: `HOST_IP=192.168.1.42 npm start`. Change the port with `PORT=4000`.

## 🧱 Tech

- **Node.js + Express** static server
- **Socket.IO** for real-time host ↔ player communication
- **qrcode** for generating the join QR code
- Vanilla HTML/CSS/JS clients (no build step)

## 📁 Structure

```
server.js          # Express + Socket.IO server, room & game orchestration
src/games.js       # Mini-game definitions, round generation & scoring
public/
  index.html       # Landing page (Host / Join)
  host.html        # Big-screen host UI
  play.html        # Mobile player UI
  css/style.css    # Shared styling
  js/host.js       # Host client logic
  js/play.js       # Player client logic
  js/confetti.js   # Confetti effect
```
