import { Server } from "socket.io";
import http from "http";

const PORT = process.env.PORT || 8080;

// Risposta HTTP per verificare se il server è vivo
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
  console.log(`[CONN] Client connesso: ${socket.id}`);

  socket.on('v2_hello', (data) => {
    const { roomId, name } = data;
    if (!roomId) return;

    socket.join(roomId);
    console.log(`[JOIN] ${name} è entrato nella stanza ${roomId}`);

    if (!rooms[roomId]) {
      rooms[roomId] = { hostId: socket.id, players: {} };
    }

    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: name || "Player",
      isHost: rooms[roomId].hostId === socket.id
    };

    // Risposta immediata al client che è appena entrato
    socket.emit('v2_welcome', {
      isHost: rooms[roomId].hostId === socket.id,
      myAssignedId: socket.id,
      hostId: rooms[roomId].hostId,
      players: Object.values(rooms[roomId].players)
    });

    // Avvisa tutti gli altri nella stanza
    socket.to(roomId).emit('v2_player_joined', rooms[roomId].players[socket.id]);
  });

  socket.on('v2_state', (data) => {
    if (!data.roomId) return;
    socket.to(data.roomId).emit('v2_state', { ...data, _from: socket.id });
  });

  socket.on('v2_start', (data) => {
    if (rooms[data.roomId]?.hostId === socket.id) {
      io.to(data.roomId).emit('v2_start');
    }
  });

  socket.on('disconnect', () => {
    console.log(`[DISC] Client disconnesso: ${socket.id}`);
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        const remaining = Object.keys(rooms[roomId].players);
        
        if (remaining.length === 0) {
          delete rooms[roomId];
        } else if (rooms[roomId].hostId === socket.id) {
          const newHostId = remaining[0];
          rooms[roomId].hostId = newHostId;
          rooms[roomId].players[newHostId].isHost = true;
          io.to(roomId).emit('v2_host', { 
            hostId: newHostId, 
            players: Object.values(rooms[roomId].players) 
          });
        }
        io.to(roomId).emit('player_left', { playerId: socket.id });
      }
    }
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[READY] Server in ascolto sulla porta ${PORT}`);
});
