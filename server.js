import { Server } from "socket.io";
import http from "http";

// 1. Usa la porta dinamica di Railway
const PORT = process.env.PORT || 8080;

// 2. Crea un server HTTP (necessario per ES Modules con Socket.io su molte piattaforme)
const httpServer = http.createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const rooms = {};

io.on('connection', (socket) => {
  console.log(`Connesso: ${socket.id}`);

  socket.on('v2_hello', (data) => {
    const { roomId, name } = data;
    if (!roomId) return;
    
    socket.join(roomId);
    console.log(`Giocatore ${name} entrato nella stanza: ${roomId}`);

    if (!rooms[roomId]) {
      rooms[roomId] = { hostId: socket.id };
    }
    
    const isHost = rooms[roomId].hostId === socket.id;
    
    socket.emit('v2_welcome', {
      isHost: isHost,
      myAssignedId: socket.id,
      hostId: rooms[roomId].hostId
    });

    socket.to(roomId).emit('v2_player_joined', {
      id: socket.id,
      name: name
    });
  });

  socket.on('v2_state', (data) => {
    if (!data.roomId) return;
    // Broadcast fondamentale
    socket.to(data.roomId).emit('v2_state', {
      ...data,
      _from: socket.id 
    });
  });

  socket.on('disconnect', () => {
    console.log(`Disconnesso: ${socket.id}`);
    for (const roomId in rooms) {
      if (rooms[roomId].hostId === socket.id) {
        const room = io.sockets.adapter.rooms.get(roomId);
        const remaining = room ? Array.from(room) : [];
        
        if (remaining.length > 0) {
          rooms[roomId].hostId = remaining[0];
          io.to(remaining[0]).emit('v2_welcome', { isHost: true, hostId: remaining[0] });
        } else {
          delete rooms[roomId];
        }
      }
    }
  });
});

// 3. Avvia il server sulla porta corretta
httpServer.listen(PORT, () => {
  console.log(`Server Multiplayer V28 (ESM) attivo sulla porta ${PORT}`);
});
