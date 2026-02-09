import { WebSocketServer } from "ws";
import http from "http";

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
});

const wss = new WebSocketServer({ server });

// rooms: Map<roomId, { clients:Set<ws>, players:{[wsId]:player}, bots:{[botId]:bot} }>
const rooms = new Map();

// per-room broadcast throttle
const lastBroadcast = new Map();

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
    players: room.players, // wsId -> {name,x,y,vx,vy,isAlive,isInfected}
    bots: room.bots,       // botId -> {x,y,vx,vy,isAlive,isInfected,isBot}
    ts: Date.now(),
  });

  room.clients.forEach((c) => {
    if (c.readyState === 1) c.send(payload);
  });
}

function broadcastRoomThrottled(roomId, minMs = 33) {
  const now = Date.now();
  const last = lastBroadcast.get(roomId) || 0;
  if (now - last < minMs) return;
  lastBroadcast.set(roomId, now);
  broadcastRoom(roomId);
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

      // switch room cleanup
      if (ws._roomId && ws._roomId !== roomId) {
        const oldRoom = getRoom(ws._roomId);
        if (oldRoom) {
          oldRoom.clients.delete(ws);
          delete oldRoom.players[id];
          if (oldRoom.clients.size === 0) rooms.delete(ws._roomId);
          else broadcastRoomThrottled(ws._roomId, 0);
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

      broadcastRoomThrottled(roomId, 0);
      return;
    }

    const roomId = ws._roomId;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return;

    // 2) player move
    if (data.type === "move") {
      const p = room.players[id];
      if (!p) return;

      if (typeof data.x === "number") p.x = data.x;
      if (typeof data.y === "number") p.y = data.y;
      if (typeof data.vx === "number") p.vx = data.vx;
      if (typeof data.vy === "number") p.vy = data.vy;

      if (typeof data.isInfected === "boolean") p.isInfected = data.isInfected;
      if (typeof data.isAlive === "boolean") p.isAlive = data.isAlive;

      p.lastUpdate = Date.now();

      broadcastRoomThrottled(roomId, 33);
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

      broadcastRoomThrottled(roomId, 33);
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

    if (room.clients.size === 0) {
      rooms.delete(roomId);
      lastBroadcast.delete(roomId);
      return;
    }

    broadcastRoomThrottled(roomId, 0);
  });
});

server.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
