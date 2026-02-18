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

  // --- CORREZIONE SYNC QUI ---
socket.on('v2_state', (data) => {
    if (data.roomId && rooms[data.roomId]) {
      // Inoltriamo tutto, assicurandoci che _from sia l'ID univoco del socket
      socket.to(data.roomId).emit('v2_state', { 
        ...data, 
        _from: socket.id 
      });
    }
  });

  socket.on('v2_start', (data) => {
    if (rooms[data.roomId] && rooms[data.roomId].hostId === socket.id) {
      console.log(`[GAME_START] Stanza ${data.roomId}`);
      // Usiamo io.to per essere sicuri che arrivi a TUTTI, compreso l'host
      io.to(data.roomId).emit('v2_start');
    }
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        const remainingPlayers = Object.keys(rooms[roomId].players);
        
        if (remainingPlayers.length === 0) {
          delete rooms[roomId];
        } else if (rooms[roomId].hostId === socket.id) {
          const newHostId = remainingPlayers[0];
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

httpServer.listen(PORT, "0.0.0.0");
