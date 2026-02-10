import { WebSocketServer } from "ws";
import http from "http";

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
});

const wss = new WebSocketServer({ server });

// rooms: Map<roomId, { clients:Set<ws>, players:{...} (legacy), bots:{...} (legacy), v2HostId, v2HostName }>
const rooms = new Map();

// per-room broadcast throttle (legacy)
const lastBroadcast = new Map();

function getRoom(roomId) {
  const rid = String(roomId || "");
  if (!rid) return null;

  if (!rooms.has(rid)) {
    rooms.set(rid, {
      clients: new Set(),
      players: {},
      bots: {},
      v2HostId: null,
      v2HostName: null,
    });
  }
  return rooms.get(rid);
}

function roomClientList(room) {
  return Array.from(room.clients).filter((c) => c && c.readyState === 1);
}

function broadcastRaw(roomId, obj) {
  const room = getRoom(roomId);
  if (!room) return;
  const payload = JSON.stringify(obj);
  roomClientList(room).forEach((c) => c.send(payload));
}

function broadcastRoomLegacy(roomId) {
  const room = getRoom(roomId);
  if (!room) return;

  const payload = JSON.stringify({
    type: "state",
    players: room.players,
    bots: room.bots,
    ts: Date.now(),
  });

  roomClientList(room).forEach((c) => c.send(payload));
}

function broadcastRoomThrottled(roomId, minMs = 33) {
  const now = Date.now();
  const last = lastBroadcast.get(roomId) || 0;
  if (now - last < minMs) return;
  lastBroadcast.set(roomId, now);
  broadcastRoomLegacy(roomId);
}

function ensureV2Host(roomId) {
  const room = getRoom(roomId);
  if (!room) return null;

  if (room.v2HostId && roomClientList(room).some((c) => c._id === room.v2HostId)) {
    return { hostId: room.v2HostId, hostName: room.v2HostName };
  }

  const list = roomClientList(room);
  if (list.length === 0) {
    room.v2HostId = null;
    room.v2HostName = null;
    return null;
  }

  // eletto: primo client attivo
  room.v2HostId = list[0]._id;
  room.v2HostName = list[0]._name || null;

  broadcastRaw(roomId, {
    type: "v2_host",
    roomId,
    hostId: room.v2HostId,
    hostName: room.v2HostName,
    ts: Date.now(),
  });

  return { hostId: room.v2HostId, hostName: room.v2HostName };
}

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).slice(2);

  ws._id = id;
  ws._roomId = null;
  ws._name = null;

  ws.send(JSON.stringify({ type: "init", id }));

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      return;
    }

    // ============ V2 PROTOCOL ============
    if (String(data.type || "").startsWith("v2_")) {
      const roomId = String(data.roomId || ws._roomId || "");
      if (!roomId) return;

      // join room if needed
      if (!ws._roomId || ws._roomId !== roomId) {
        // cleanup old
        if (ws._roomId && ws._roomId !== roomId) {
          const oldRoom = getRoom(ws._roomId);
          if (oldRoom) {
            oldRoom.clients.delete(ws);
            if (oldRoom.clients.size === 0) {
              rooms.delete(ws._roomId);
              lastBroadcast.delete(ws._roomId);
            } else {
              ensureV2Host(ws._roomId);
            }
          }
        }

        ws._roomId = roomId;
        const room = getRoom(roomId);
        room.clients.add(ws);
      }

      if (data.type === "v2_hello") {
        ws._name = String(data.name || ws._name || "");
        const room = getRoom(roomId);
        if (room && !room.v2HostId) {
          room.v2HostId = ws._id;
          room.v2HostName = ws._name || null;
        }
        ensureV2Host(roomId);

        // echo to room (ok)
        broadcastRaw(roomId, { ...data, ts: Date.now() });
        return;
      }

      if (data.type === "v2_join") {
        ws._name = String(data.name || ws._name || "");
        const room = getRoom(roomId);
        room.clients.add(ws);
        ensureV2Host(roomId);

        broadcastRaw(roomId, { ...data, ts: Date.now() });
        return;
      }

      if (data.type === "v2_resync") {
        ensureV2Host(roomId);
        broadcastRaw(roomId, { ...data, ts: Date.now() });
        return;
      }

      if (data.type === "v2_input") {
        // manda a tutti: solo host lo userà
        broadcastRaw(roomId, { ...data, _from: ws._id, ts: Date.now() });
        return;
      }

      if (data.type === "v2_init") {
        // static init
        broadcastRaw(roomId, { ...data, _from: ws._id, ts: Date.now() });
        return;
      }

      if (data.type === "v2_snapshot") {
        // snapshot realtime
        broadcastRaw(roomId, { ...data, _from: ws._id, ts: Date.now() });
        return;
      }

      if (data.type === "v2_gameOver") {
        broadcastRaw(roomId, { ...data, _from: ws._id, ts: Date.now() });
        return;
      }

      // default v2: relay
      broadcastRaw(roomId, { ...data, _from: ws._id, ts: Date.now() });
      return;
    }

    // ============ LEGACY PROTOCOL (compat) ============
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
      ws._name = name;
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
    delete room.players[ws._id];

    if (room.clients.size === 0) {
      rooms.delete(roomId);
      lastBroadcast.delete(roomId);
      return;
    }

    // v2 host migration
    ensureV2Host(roomId);

    // legacy broadcast
    broadcastRoomThrottled(roomId, 0);
  });
});

server.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
