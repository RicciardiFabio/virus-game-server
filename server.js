const io = require('socket.io')(3001, {
  cors: { origin: "*" } // Permette al tuo gioco di connettersi
});

const rooms = {};

io.on('connection', (socket) => {
  console.log(`Utente connesso: ${socket.id}`);

  socket.on('v2_hello', (data) => {
    const { roomId, name } = data;
    socket.join(roomId);
    
    // Gestione Stanze e Host
    if (!rooms[roomId]) {
      rooms[roomId] = { hostId: socket.id, players: [] };
    }
    
    const isHost = rooms[roomId].hostId === socket.id;
    
    // 1. Risposta al giocatore che entra
    socket.emit('v2_welcome', {
      isHost: isHost,
      myAssignedId: socket.id,
      hostId: rooms[roomId].hostId
    });

    // 2. Avvisa TUTTI gli altri (incluso l'Host) che è entrato qualcuno
    socket.to(roomId).emit('v2_player_joined', {
      id: socket.id,
      name: name
    });
    
    console.log(`Giocatore ${name} entrato nella stanza ${roomId}. Host: ${isHost}`);
  });

  // IL CUORE DELLA SINCRONIZZAZIONE
  socket.on('v2_state', (data) => {
    // Il server prende il pacchetto (posizione, bot, meteo) 
    // e lo rimanda a tutti gli ALTRI nella stanza
    socket.to(data.roomId).emit('v2_state', {
      ...data,
      _from: socket.id // Fondamentale: dice al client chi ha mandato il dato
    });
  });

  socket.on('disconnecting', () => {
    // Se l'host esce, dobbiamo nominare un nuovo host o chiudere la stanza
    for (const roomId of socket.rooms) {
      if (rooms[roomId] && rooms[roomId].hostId === socket.id) {
        const remaining = Array.from(io.sockets.adapter.rooms.get(roomId) || []).filter(id => id !== socket.id);
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

console.log("Server Multiplayer V28 attivo sulla porta 3001");
