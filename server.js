const io = require('socket.io')(8080, {
  cors: { origin: "*" } 
});

const rooms = {};

io.on('connection', (socket) => {
  console.log(`Connesso: ${socket.id}`);

  socket.on('v2_hello', (data) => {
    const { roomId, name } = data;
    socket.join(roomId);
    
    // Gestione della stanza
    if (!rooms[roomId]) {
      rooms[roomId] = { hostId: socket.id };
    }
    
    const isHost = rooms[roomId].hostId === socket.id;
    
    // 1. Rispondi a chi è appena entrato
    socket.emit('v2_welcome', {
      isHost: isHost,
      myAssignedId: socket.id,
      hostId: rooms[roomId].hostId
    });

    // 2. Avvisa l'Host (e gli altri) che un nuovo player è entrato
    socket.to(roomId).emit('v2_player_joined', {
      id: socket.id,
      name: name
    });
  });

  // IL CUORE DEL MULTIPLAYER: Inoltro dati
  socket.on('v2_state', (data) => {
    // Rispedisce il messaggio a tutti gli altri nella stanza
    // Aggiunge il campo _from fondamentale per la sincronizzazione
    socket.to(data.roomId).emit('v2_state', {
      ...data,
      _from: socket.id 
    });
  });

  socket.on('disconnect', () => {
    // Se l'host esce, nomina un nuovo host
    for (const roomId in rooms) {
      if (rooms[roomId].hostId === socket.id) {
        const remaining = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
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

console.log("Server Multiplayer V28 pronto sulla porta 8080");
