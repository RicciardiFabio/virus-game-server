import { Server } from "socket.io";
import http from "http";

const PORT = process.env.PORT || 8080;

// Server HTTP per test e health-check
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('SERVER MULTIPLAYER V28.3: ONLINE E FUNZIONANTE');
});

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

// Memoria del server: stanze e giocatori
const rooms = {};

console.log(`[START] Server avviato sulla porta ${PORT}`);

io.on('connection', (socket) => {
  console.log(`[CONN] Nuovo client connesso: ${socket.id}`);

  // 1. GESTIONE LOBBY: Invia la lista delle stanze attive
  socket.on('get_rooms', () => {
    const activeRooms = Object.keys(rooms).map(id => ({
      id: id,
      playerCount: Object.keys(rooms[id].players).length
    }));
    socket.emit('rooms_list', activeRooms);
    // console.log(`[LOBBY] Inviata lista stanze a ${socket.id}`);
  });

  // 2. ENTRATA NELLA STANZA
  socket.on('v2_hello', (data) => {
    const { roomId, name } = data;
    if (!roomId) return;

    socket.join(roomId);
    console.log(`[JOIN] Player "${name}" (${socket.id}) -> Stanza: ${roomId}`);

    // Se la stanza non esiste, creala e nomina questo socket come Host
    if (!rooms[roomId]) {
      rooms[roomId] = { 
        hostId: socket.id, 
        players: {} 
      };
    }

    // Aggiungi il giocatore alla memoria del server
    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: name || "Player",
      isHost: rooms[roomId].hostId === socket.id
    };

    // Rispondi al giocatore con tutti i dati necessari
    socket.emit('v2_welcome', {
      isHost: rooms[roomId].hostId === socket.id,
      myAssignedId: socket.id,
      hostId: rooms[roomId].hostId,
      players: Object.values(rooms[roomId].players)
    });

    // Avvisa gli altri che qualcuno è entrato
    socket.to(roomId).emit('v2_player_joined', rooms[roomId].players[socket.id]);
  });

  // 3. RELAY DELLO STATO (Movimenti, virus, ecc.)
  socket.on('v2_state', (data) => {
    if (data.roomId) {
      socket.to(data.roomId).emit('v2_state', { ...data, _from: socket.id });
    }
  });

  // 4. AVVIO PARTITA
  socket.on('v2_start', (data) => {
    if (rooms[data.roomId] && rooms[data.roomId].hostId === socket.id) {
      console.log(`[GAME_START] La stanza ${data.roomId} sta iniziando!`);
      io.to(data.roomId).emit('v2_start');
    }
  });

  // 5. DISCONNESSIONE E PULIZIA
  socket.on('disconnect', () => {
    console.log(`[DISC] Client disconnesso: ${socket.id}`);
    
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        
        const remainingPlayers = Object.keys(rooms[roomId].players);
        
        if (remainingPlayers.length === 0) {
          // Se la stanza è vuota, eliminala
          delete rooms[roomId];
          console.log(`[ROOM_DELETE] Stanza ${roomId} eliminata perché vuota.`);
        } else if (rooms[roomId].hostId === socket.id) {
          // Se l'Host se n'è andato, nomina il prossimo giocatore come Host
          const newHostId = remainingPlayers[0];
          rooms[roomId].hostId = newHostId;
          rooms[roomId].players[newHostId].isHost = true;
          
          console.log(`[NEW_HOST] Nuovo Host per ${roomId}: ${newHostId}`);
          
          io.to(roomId).emit('v2_host', { 
            hostId: newHostId, 
            players: Object.values(rooms[roomId].players) 
          });
        }
        
        // Avvisa i rimasti che qualcuno è uscito
        io.to(roomId).emit('player_left', { playerId: socket.id });
      }
    }
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[READY] Server pienamente operativo sulla porta ${PORT}`);
});
