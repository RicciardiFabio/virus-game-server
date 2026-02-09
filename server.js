import { WebSocketServer } from "ws";
import http from "http";

const PORT = process.env.PORT || 3000;

// Piccolo HTTP server così / risponde "OK" (utile su Railway)
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
});

const wss = new WebSocketServer({ server });

// players: { [wsId]: { name, x, y, vx, vy, lastUpdate } }
// bots:    { [botId]: { x, y, vx, vy, isInfected, isAlive, lastUpdate } }
const players = {};
const bots = {};

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).slice(2);

  players[id] = {
    name: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    lastUpdate: Date.now(),
  };

  ws.send(JSON.stringify({ type: "init", id }));

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      return;
    }

    // 1) handshake: associa wsId -> playerName
    if (data.type === "hello") {
      players[id].name = String(data.name || "");
      players[id].lastUpdate = Date.now();
      return;
    }

    // 2) movimento player
    if (data.type === "move") {
      if (typeof data.x === "number") players[id].x = data.x;
      if (typeof data.y === "number") players[id].y = data.y;
      if (typeof data.vx === "number") players[id].vx = data.vx;
      if (typeof data.vy === "number") players[id].vy = data.vy;
      players[id].lastUpdate = Date.now();
      return;
    }

    // 3) bot updates (solo host li manda)
    // bot update (solo host, ma qui lo accettiamo e broadcastiamo)
    if (data.type === "bot") {
      const roomId = ws._roomId;
      if (!roomId) return;

      const room = getRoom(roomId);
      const botId = String(data.id || "bot-virus0");

      if (!room.bots) room.bots = {};
      if (!room.bots[botId]) {
        room.bots[botId] = {
          id: botId,
          name: data.name || "VIRUS-0",
          x: 500, y: 500, vx: 0, vy: 0,
          isInfected: true,
          isAlive: true,
          isBot: true,
          lastUpdate: Date.now(),
        };
      }

      const b = room.bots[botId];
      if (typeof data.x === "number") b.x = data.x;
      if (typeof data.y === "number") b.y = data.y;
      if (typeof data.vx === "number") b.vx = data.vx;
      if (typeof data.vy === "number") b.vy = data.vy;
      if (typeof data.isInfected === "boolean") b.isInfected = data.isInfected;
      if (typeof data.isAlive === "boolean") b.isAlive = data.isAlive;
      b.lastUpdate = Date.now();

      broadcastRoom(roomId);
      return;
    }

  });

  ws.on("close", () => {
    delete players[id];
  });
});

// Broadcast state 20 volte/sec
setInterval(() => {
  const payload = JSON.stringify({
    type: "state",
    players,
    bots,
    ts: Date.now(),
  });

  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(payload);
  });
}, 50);

server.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
