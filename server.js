// 1. USA LA PORTA DI RAILWAY (QUESTO È IL SEGRETO)
const PORT = process.env.PORT || 8080;

const io = require('socket.io')(PORT, {
  cors: {
    origin: "*", // Permette al gioco di connettersi
    methods: ["GET", "POST"],
    credentials: true
  },
  // Aggiungi queste per stabilità su Railway
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
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
    // Rimbalza i dati a tutti gli altri (fondamentale per vedere Virus e Player)
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
          console.log(`Nuovo host per ${roomId}: ${remaining[0]}`);
        } else {
          delete rooms[roomId];
        }
      }
    }
  });
});

console.log(`Server Multiplayer V28 attivo sulla porta ${PORT}`);
