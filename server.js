import { Server } from "socket.io";
import http from "http";

const PORT = process.env.PORT || 8080;

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("SERVER MULTIPLAYER V29.1: ROOM LIFECYCLE FIX");
});

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"]
});

const rooms = {};

console.log(`[START] Server avviato sulla porta ${PORT}`);

const closeRoom = (roomId, reason = "closed") => {
  if (!roomId || !rooms[roomId]) return;

  const socketIds = Object.keys(rooms[roomId].players);

  io.to(roomId).emit("room_closed", { roomId, reason });

  socketIds.forEach((sid) => {
    const s = io.sockets.sockets.get(sid);
    if (!s) return;
    s.leave(roomId);
    if (s.data.currentRoomId === roomId) {
      s.data.currentRoomId = null;
    }
  });

  delete rooms[roomId];
};

const leaveRoom = (socket, roomId) => {
  const targetRoomId = roomId || socket.data.currentRoomId;
  if (!targetRoomId) return;

  if (!rooms[targetRoomId]) {
    socket.leave(targetRoomId);
    if (socket.data.currentRoomId === targetRoomId) {
      socket.data.currentRoomId = null;
    }
    return;
  }

  const room = rooms[targetRoomId];
  const wasHost = room.hostId === socket.id;

  if (!room.players[socket.id]) {
    socket.leave(targetRoomId);
    if (socket.data.currentRoomId === targetRoomId) {
      socket.data.currentRoomId = null;
    }
    return;
  }

  delete room.players[socket.id];
  socket.leave(targetRoomId);
  if (socket.data.currentRoomId === targetRoomId) {
    socket.data.currentRoomId = null;
  }

  if (wasHost) {
    closeRoom(targetRoomId, "host_left");
    return;
  }

  const remainingPlayers = Object.keys(room.players);
  if (remainingPlayers.length === 0) {
    delete rooms[targetRoomId];
    return;
  }

  io.to(targetRoomId).emit("player_left", { playerId: socket.id });
};

io.on("connection", (socket) => {
  socket.data.currentRoomId = null;
  console.log(`[CONN] ${socket.id}`);

  socket.on("get_rooms", () => {
    const activeRooms = Object.keys(rooms).map((id) => ({
      id,
      playerCount: Object.keys(rooms[id].players).length
    }));
    socket.emit("rooms_list", activeRooms);
  });

  socket.on("v2_hello", (data) => {
    const roomId = data?.roomId;
    const name = data?.name;
    if (!roomId) return;

    if (socket.data.currentRoomId && socket.data.currentRoomId !== roomId) {
      leaveRoom(socket, socket.data.currentRoomId);
    }

    socket.join(roomId);
    socket.data.currentRoomId = roomId;

    if (!rooms[roomId]) {
      rooms[roomId] = { hostId: socket.id, players: {} };
    }

    const existing = rooms[roomId].players[socket.id];
    const isHost = rooms[roomId].hostId === socket.id;

    rooms[roomId].players[socket.id] = existing
      ? { ...existing, name: name || existing.name || "Player", isHost }
      : { id: socket.id, name: name || "Player", isHost };

    socket.emit("v2_welcome", {
      isHost,
      myAssignedId: socket.id,
      hostId: rooms[roomId].hostId,
      players: Object.values(rooms[roomId].players)
    });

    if (!existing) {
      socket.to(roomId).emit("v2_player_joined", rooms[roomId].players[socket.id]);
    }
  });

  socket.on("v2_state", (data) => {
    const roomId = data?.roomId;
    if (!roomId || !rooms[roomId] || !rooms[roomId].players[socket.id]) return;

    const payload = { ...data, _from: socket.id };

    if (data.type === "v2_collect_item") {
      io.to(roomId).emit("v2_state", payload);
    } else {
      socket.to(roomId).emit("v2_state", payload);
    }
  });

  socket.on("v2_start", (data) => {
    const roomId = data?.roomId;
    if (roomId && rooms[roomId] && rooms[roomId].hostId === socket.id) {
      console.log(`[GAME_START] Stanza ${roomId}`);
      io.to(roomId).emit("v2_start");
    }
  });

  socket.on("v2_end", (data) => {
    const roomId = data?.roomId || socket.data.currentRoomId;
    if (roomId && rooms[roomId] && rooms[roomId].hostId === socket.id) {
      closeRoom(roomId, data?.reason || "game_finished");
    }
  });

  socket.on("leave_room", (data) => {
    leaveRoom(socket, data?.roomId || socket.data.currentRoomId);
  });

  socket.on("disconnect", () => {
    leaveRoom(socket, socket.data.currentRoomId);
  });
});

httpServer.listen(PORT, "0.0.0.0");
