import { Server } from "socket.io";
import http from "http";

const PORT = process.env.PORT || 8080;

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('SERVER MULTIPLAYER V28.4: SYNC ACTIVE');
});

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling']
});

const rooms = {};

console.log(`[START] Server avviato sulla porta ${PORT}`);

const leaveRoom = (socket, roomId) => {
  if (!roomId || !rooms[roomId]) return;
  if (!rooms[roomId].players[socket.id]) {
    socket.leave(roomId);
    return;
  }

  delete rooms[roomId].players[socket.id];
  socket.leave(roomId);

  const remainingPlayers = Object.keys(rooms[roomId].players);

  if (remainingPlayers.length === 0) {
    delete rooms[roomId];
    return;
  }

  if (rooms[roomId].hostId === socket.id) {
    const newHostId = remainingPlayers[0];
    rooms[roomId].hostId = newHostId;
    rooms[roomId].players[newHostId].isHost = true;
    io.to(roomId).emit('v2_host', {
      hostId: newHostId,
      players: Object.values(rooms[roomId].players)
    });
  }

  io.to(roomId).emit('player_left', { playerId: socket.id });
};

io.on('connection', (socket) => {
  console.log(`[CONN] ${socket.id}`);

  socket.on('get_rooms', () => {
    const activeRooms = Object.keys(rooms).map(id => ({
      id: id,
      playerCount: Object.keys(rooms[id].players).length
    }));
    socket.emit('rooms_list', activeRooms);
  });

  socket.on('v2_hello', (data) => {
    const { roomId, name } = data;
    if (!roomId) return;
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = { hostId: socket.id, players: {} };
    }

    const existing = rooms[roomId].players[socket.id];
    const isHost = rooms[roomId].hostId === socket.id;
    rooms[roomId].players[socket.id] = existing
      ? { ...existing, name: name || existing.name || "Player", isHost }
      : { id: socket.id, name: name || "Player", isHost };

    socket.emit('v2_welcome', {
      isHost,
      myAssignedId: socket.id,
      hostId: rooms[roomId].hostId,
      players: Object.values(rooms[roomId].players)
    });

    if (!existing) {
      socket.to(roomId).emit('v2_player_joined', rooms[roomId].players[socket.id]);
    }
  });

  socket.on('v2_state', (data) => {
    if (data.roomId && rooms[data.roomId]) {
      const payload = {
        ...data,
        _from: socket.id
      };

      // I collect devono arrivare anche al sender per conferma visiva immediata.
      if (data.type === 'v2_collect_item') {
        io.to(data.roomId).emit('v2_state', payload);
      } else {
        socket.to(data.roomId).emit('v2_state', payload);
      }
    }
  });

  socket.on('v2_start', (data) => {
    if (rooms[data.roomId] && rooms[data.roomId].hostId === socket.id) {
      console.log(`[GAME_START] Stanza ${data.roomId}`);
      io.to(data.roomId).emit('v2_start');
    }
  });

  socket.on('leave_room', (data) => {
    leaveRoom(socket, data?.roomId);
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        leaveRoom(socket, roomId);
      }
    }
  });
});

httpServer.listen(PORT, "0.0.0.0");
