import { Server } from "socket.io";
import http from "http";

const PORT = process.env.PORT || 8080;

// CREIAMO IL SERVER CON UNA RISPOSTA HTTP PER TEST
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('SERVER MULTIPLAYER V28.2: ONLINE E FUNZIONANTE');
});

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  allowEIO3: true, // Compatibilità per versioni vecchie
  transports: ['websocket', 'polling'] 
});

const rooms = {};

io.on('connection', (socket) => {
  console.log(`[CONN] Connesso: ${socket.id}`);

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

    // Mandiamo subito la lista a CHI ENTRA
    socket.emit('v2_welcome', {
      isHost: rooms[roomId].hostId === socket.id,
      myAssignedId: socket.id,
      hostId: rooms[roomId].hostId,
      players: Object.values(rooms[roomId].players)
    });

    // Avvisiamo GLI ALTRI
    socket.to(roomId).emit('v2_player_joined', rooms[roomId].players[socket.id]);
  });

  socket.on('v2_start', (data) => {
    if (rooms[data.roomId]?.hostId === socket.id) {
      io.to(data.roomId).emit('v2_start');
    }
  });

  socket.on('disconnect', () => {
    console.log(`[DISC] Uscito: ${socket.id}`);
    // Logica pulizia stanze (quella di prima)
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[READY] Porta: ${PORT}`);
});
