import { Server } from "socket.io";
import http from "http";

// 1. Configurazione porta dinamica per Railway
const PORT = process.env.PORT || 8080;

// 2. Creazione server HTTP (necessario per Socket.io in modalità ESM)
const httpServer = http.createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "*", // Permette la connessione dal tuo sito web
    methods: ["GET", "POST"]
  },
  // Ottimizzazioni per la stabilità della connessione su cloud
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const rooms = {};

console.log("--- Avvio Server Multiplayer V28 ---");

io.on('connection', (socket) => {
  console.log(`[CONNESSIONE] Nuovo client collegato: ${socket.id}`);

  // GESTIONE INGRESSO NELLA STANZA
  socket.on('v2_hello', (data) => {
    const { roomId, name } = data;
    
    if (!roomId) {
      console.error(`[ERRORE] Hello ricevuto senza roomId da ${socket.id}`);
      return;
    }
    
    // Il socket entra nella stanza specifica
    socket.join(roomId);
    console.log(`[ROOM] Giocatore "${name}" (${socket.id}) entrato in: ${roomId}`);

    // Se la stanza non esiste, il primo che entra è l'Host
    if (!rooms[roomId]) {
      rooms[roomId] = { hostId: socket.id };
      console.log(`[HOST] ${socket.id} è il nuovo Host della stanza ${roomId}`);
    }
    
    const isHost = rooms[roomId].hostId === socket.id;
    
    // RISPOSTA AL CLIENT: Questo sblocca il caricamento nel gioco
    socket.emit('v2_welcome', {
      isHost: isHost,
      myAssignedId: socket.id,
      hostId: rooms[roomId].hostId,
      roomId: roomId
    });

    // Avvisa gli altri giocatori già presenti nella stanza
    socket.to(roomId).emit('v2_player_joined', {
      id: socket.id,
      name: name
    });
  });

  // IL CUORE DEL MULTIPLAYER: Rimbalzo delle posizioni (Player, Virus, Meteo)
  socket.on('v2_state', (data) => {
    if (!data.roomId) return;

    // Inoltra i dati a tutti gli altri membri della stanza
    // Aggiungiamo _from per permettere al client di distinguere i propri messaggi
    socket.to(data.roomId).emit('v2_state', {
      ...data,
      _from: socket.id 
    });
  });

  // GESTIONE DISCONNESSIONE E CAMBIO HOST
  socket.on('disconnect', () => {
    console.log(`[DISCONNESSIONE] Client uscito: ${socket.id}`);
    
    for (const roomId in rooms) {
      if (rooms[roomId].hostId === socket.id) {
        // Se l'Host se ne va, cerchiamo un sostituto nella stanza
        const room = io.sockets.adapter.rooms.get(roomId);
        const remainingPlayers = room ? Array.from(room) : [];
        
        if (remainingPlayers.length > 0) {
          const newHostId = remainingPlayers[0];
          rooms[roomId].hostId = newHostId;
          
          // Comunichiamo al nuovo eletto che ora comanda lui il mondo (Virus/Meteo)
          io.to(newHostId).emit('v2_welcome', { 
            isHost: true, 
            hostId: newHostId,
            roomId: roomId 
          });
          console.log(`[HOST] Nuovo Host per ${roomId}: ${newHostId}`);
        } else {
          // Stanza vuota, la cancelliamo dalla memoria
          delete rooms[roomId];
          console.log(`[ROOM] Stanza ${roomId} eliminata perché vuota.`);
        }
      }
    }
  });
});

// Avvio effettivo
httpServer.listen(PORT, () => {
  console.log(`[READY] Server Multiplayer V28 (ESM) attivo sulla porta ${PORT}`);
});
