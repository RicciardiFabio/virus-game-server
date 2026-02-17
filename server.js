import { Server } from "socket.io";
import http from "http";

const PORT = process.env.PORT || 8080;
const httpServer = http.createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'], // Supporta entrambi per sicurezza
  pingTimeout: 60000,
  pingInterval: 25000
});

// Struttura dati: { "ROOM_ID": { hostId: "ID", players: { "ID": { name: "NOME" } } } }
const rooms = {};

console.log("--- Server Multiplayer V28.1 (Full) Online ---");

io.on('connection', (socket) => {
  console.log(`[CONNESSIONE] Client collegato: ${socket.id}`);

  socket.on('v2_hello', (data) => {
    const { roomId, name } = data;
    
    if (!roomId) {
      console.error(`[ERRORE] No roomId da ${socket.id}`);
      return;
    }
    
    socket.join(roomId);

    // 1. Inizializza la stanza se non esiste
    if (!rooms[roomId]) {
      rooms[roomId] = { 
        hostId: socket.id,
        players: {} 
      };
      console.log(`[ROOM] Creata stanza ${roomId}. Host: ${socket.id}`);
    }

    // 2. Aggiungi il giocatore alla lista della stanza
    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: name || `Agent-${socket.id.slice(0,4)}`,
      isHost: rooms[roomId].hostId === socket.id
    };

    console.log(`[JOIN] "${name}" in stanza ${roomId}. Totale: ${Object.keys(rooms[roomId].players).length}`);

    // 3. Prepara la lista aggiornata di TUTTI i giocatori per il v2_welcome
    const playersList = Object.values(rooms[roomId].players);

    // 4. Risposta a chi è appena entrato (Welcome)
    socket.emit('v2_welcome', {
      isHost: rooms[roomId].hostId === socket.id,
      myAssignedId: socket.id,
      hostId: rooms[roomId].hostId,
      roomId: roomId,
      players: playersList // Fondamentale: mandiamo la lista completa!
    });

    // 5. Avvisa gli altri che è entrato qualcuno (Broadcast)
    socket.to(roomId).emit('v2_player_joined', {
      id: socket.id,
      name: name,
      isHost: false
    });
  });

  // Relay dei dati di gioco (Posizioni, Virus, Meteo)
  socket.on('v2_state', (data) => {
    if (!data.roomId) return;
    // Inoltra tutto agli altri, includendo chi l'ha mandato
    socket.to(data.roomId).emit('v2_state', {
      ...data,
      _from: socket.id 
    });
  });

  // Start del gioco (Solo l'Host può farlo)
  socket.on('v2_start', (data) => {
    if (rooms[data.roomId] && rooms[data.roomId].hostId === socket.id) {
        console.log(`[START] Stanza ${data.roomId} inizia la missione!`);
        io.to(data.roomId).emit('v2_start', { startedBy: socket.id });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[DISCONNESSIONE] Client uscito: ${socket.id}`);
    
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        // Rimuovi il giocatore dalla lista
        delete rooms[roomId].players[socket.id];
        
        // Se la stanza è vuota, eliminala
        const remainingIds = Object.keys(rooms[roomId].players);
        
        if (remainingIds.length === 0) {
          delete rooms[roomId];
          console.log(`[ROOM] Stanza ${roomId} chiusa.`);
          continue;
        }

        // Se è uscito l'Host, assegna a un altro
        if (rooms[roomId].hostId === socket.id) {
          const newHostId = remainingIds[0];
          rooms[roomId].hostId = newHostId;
          rooms[roomId].players[newHostId].isHost = true;

          console.log(`[HOST] Nuovo Host per ${roomId}: ${newHostId}`);
          
          // Comunica a tutti il cambio Host
          io.to(roomId).emit('v2_host', { 
            hostId: newHostId,
            players: Object.values(rooms[roomId].players) 
          });
        }

        // Avvisa gli altri che un giocatore è uscito
        io.to(roomId).emit('player_left', { playerId: socket.id });
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[READY] Server attivo sulla porta ${PORT}`);
});
