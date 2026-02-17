import { Server } from "socket.io";
import http from "http";

const PORT = process.env.PORT || 8080;

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('SERVER MULTIPLAYER V28.2: ONLINE');
});

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ['websocket', 'polling']
});

const rooms = {};

io.on('connection', (socket) => {
  console.log(`[CONN] Connected: ${socket.id}`);

  socket.on('v2_hello', (data) => {
    const { roomId, name } = data;
    if (!roomId) return;

    socket.join(roomId);
    console.log(`[JOIN] Player ${name} joined room ${roomId}`);

    if (!rooms[roomId]) {
      rooms[roomId] = { hostId: socket.id, players: {} };
    }

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: name || "Player",
      isHost: rooms[roomId].hostId === socket.id
    };

    socket.emit('v2_welcome', {
      isHost: rooms[roomId].hostId === socket.id,
      myAssignedId: socket.id,
      hostId: rooms[roomId].hostId,
      players: Object.values(rooms[roomId].players)
    });

    socket.to(roomId).emit('v2_player_joined', rooms[roomId].players[socket.id]);
  });

  socket.on('disconnect', () => {
    console.log(`[DISC] Disconnected: ${socket.id}`);
    
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        
        const remaining = Object.keys(rooms[roomId].players);
        if (remaining.length === 0) {
          delete rooms[roomId];
          console.log(`[ROOM] Room ${roomId} deleted (empty)`);
        } else if (rooms[roomId].hostId === socket.id) {
          const newHostId = remaining[0];
          rooms[roomId].hostId = newHostId;
          rooms[roomId].players[newHostId].isHost = true;
          io.to(roomId).emit('v2_host', { 
            hostId: newHostId, 
            players: Object.values(rooms[roomId].players) 
          });
          console.log(`[HOST] New host for ${roomId}: ${newHostId}`);
        }
        io.to(roomId).emit('player_left', { playerId: socket.id });
      }
    }
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[READY] Server running on port ${PORT}`);
});
