import { WebSocketServer } from "ws";
import http from "http";

const PORT = process.env.PORT || 3000;

// HTTP server: / -> OK
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
});

const wss = new WebSocketServer({ server });

// rooms: Map<roomId, { clients:Set<ws>, players:{[wsId]:player}, bots:{[botId]:bot} }>
const rooms = new Map();

function getRoom(roomId) {
  const rid = String(roomId || "");
  if (!rid) return null;

  if (!rooms.has(rid)) {
    rooms.set(rid, {
      clients: new Set(),
      players: {},
      bots: {},
    });
  }
  return rooms.get(rid);
}

function broadcastRoom(roomId) {
  const room = getRoom(roomId);
  if (!room) return;

  const payload = JSON.stringify({
    type: "state",
    players: room.players, // object (wsId -> {name,x,y,...})
    bots: room.bots,       // object (botId -> {x,y,...})
    ts: Date.now(),
  });

  room.clients.forEach((c) => {
    if (c.readyState === 1) c.send(payload);
  });
}

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).slice(2);

  ws._id = id;
  ws._roomId = null;

  ws.send(JSON.stringify({ type: "init", id }));

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      return;
    }

    // 1) hello: join room + set name
    if (data.type === "hello") {
      const roomId = String(data.roomId || "");
      const name = String(data.name || "");

      if (!roomId) return;

      // se cambia room, rimuovi da quella vecchia
      if (ws._roomId && ws._roomId !== roomId) {
        const oldRoom = getRoom(ws._roomId);
        if (oldRoom) {
          oldRoom.clients.delete(ws);
          delete oldRoom.players[id];
        }
      }

      ws._roomId = roomId;

      const room = getRoom(roomId);
      room.clients.add(ws);

      room.players[id] = {
        id,
        name,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        isAlive: true,
        isInfected: false,
        lastUpdate: Date.now(),
      };

      // (opzionale) broadcast subito
      broadcastRoom(roomId);
      return;
    }

    // se non è in una room, ignora
    const roomId = ws._roomId;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return;

    // 2) movimento player
    if (data.type === "move") {
      const p = room.players[id];
      if (!p) return;

      if (typeof data.name === "string" && data.name) p.name = data.name;
      if (typeof data.x === "number") p.x = data.x;
      if (typeof data.y === "number") p.y = data.y;
      if (typeof data.vx === "number") p.vx = data.vx;
      if (typeof data.vy === "number") p.vy = data.vy;

      // se in futuro mandi anche infection/alive via WS:
      if (typeof data.isInfected === "boolean") p.isInfected = data.isInfected;
      if (typeof data.isAlive === "boolean") p.isAlive = data.isAlive;

      p.lastUpdate = Date.now();
      return;
    }

    // 3) bot updates (host)
    if (data.type === "bot") {
      const botId = String(data.id || "bot-virus0");

      if (!room.bots[botId]) {
        room.bots[botId] = {
          id: botId,
          name: String(data.name || "VIRUS-0"),
          x: 500,
          y: 500,
          vx: 0,
          vy: 0,
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

      // broadcast realtime bot
      broadcastRoom(roomId);
      return;
    }
  });

  ws.on("close", () => {
    const roomId = ws._roomId;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return;

    room.clients.delete(ws);
    delete room.players[id];

    // se room vuota, pulisci
    if (room.clients.size === 0) {
      rooms.delete(roomId);
      return;
    }

    broadcastRoom(roomId);
  });
});

// Broadcast periodico (20/sec) per ogni room
setInterval(() => {
  rooms.forEach((_, roomId) => broadcastRoom(roomId));
}, 33);

server.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
