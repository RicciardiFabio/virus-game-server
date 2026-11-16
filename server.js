import { Server } from "socket.io";
import http from "http";

const PORT = process.env.PORT || 8080;

// Origini autorizzate: il gioco pubblico e i collaudi locali. Si possono
// ampliare con la variabile CORS_ORIGINS, senza aprire il server a tutti.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || [
  "https://websitedefault.it",
  "https://www.websitedefault.it",
  "https://hobby-game.it",
  "https://www.hobby-game.it",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
].join(","))
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const httpServer = http.createServer((req, res) => {
  // /health serve al client per risvegliare il servizio gratuito dopo la
  // sospensione: risponde appena il processo e' pronto.
  if (req.url === "/health" || req.url === "/healthz") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({
      ok: true,
      servizio: "virus-game-server",
      stanze: Object.keys(rooms).length,
      uptimeSec: Math.round(process.uptime())
    }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("SERVER MULTIPLAYER V30: STATO IN STANZA E RIPRISTINO");
});

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => callback(null, !origin || ALLOWED_ORIGINS.includes(origin)),
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

// Oggetto senza prototipo: un identificativo come "__proto__" non puo' alterare lo stato.
const rooms = Object.create(null);

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const PLAYER_KEY_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const ROOM_IDS_RISERVATI = new Set(["__proto__", "constructor", "prototype"]);
const MAX_PLAYERS = 16;
const MAX_STATE_BYTES = 24576;
const MAX_ROOMS = 200;

// Dopo una caduta di rete la stanza resta in piedi per un minuto: chi rientra
// ritrova il proprio stato, chi non rientra libera il posto.
const RECONNECT_GRACE_MS = 60000;

// Il client invia 20 pacchetti al secondo: il tetto resta piu' alto del normale.
const RATE_WINDOW_MS = 1000;
const MAX_STATE_PER_WINDOW = 60;
const MAX_ABUSE = 40;

const validRoomId = (v) => typeof v === "string"
  && ROOM_ID_PATTERN.test(v)
  && !ROOM_IDS_RISERVATI.has(v.toLowerCase());

// Chiave stabile del giocatore: sopravvive alla riconnessione, cambia con la scheda.
const validPlayerKey = (v) => typeof v === "string" && PLAYER_KEY_PATTERN.test(v);

const cleanName = (v) => {
  const testo = typeof v === "string" ? v : "Player";
  const pulito = testo.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 24);
  return pulito || "Player";
};

const num = (v, min = -10000, max = 10000) => Number.isFinite(v)
  ? Math.min(max, Math.max(min, Math.round(v)))
  : 0;

const sanitizePlayer = (p) => ({
  id: typeof p?.id === "string" ? p.id.slice(0, 64) : "",
  name: cleanName(p?.name),
  x: num(p?.x),
  y: num(p?.y),
  state: typeof p?.state === "string" ? p.state.slice(0, 20) : "HEALTHY",
  activePowerUps: p && typeof p.activePowerUps === "object" && p.activePowerUps !== null
    ? p.activePowerUps
    : {},
  trail: Array.isArray(p?.trail) ? p.trail.slice(0, 40) : []
});

const roomHostId = (room) => {
  const host = room && room.players[room.hostKey];
  return host ? host.id : "";
};

const playerList = (room) => Object.keys(room.players)
  .map((k) => room.players[k])
  .filter((p) => p.connected !== false)
  .map((p) => ({ id: p.id, name: p.name, isHost: p.key === room.hostKey }));

console.log(`[START] Server avviato sulla porta ${PORT}`);

const closeRoom = (roomId, reason = "closed") => {
  const room = rooms[roomId];
  if (!room) return;

  const socketIds = Object.keys(room.players).map((k) => room.players[k].id);
  for (const key of Object.keys(room.players)) {
    const p = room.players[key];
    if (p.timer) { clearTimeout(p.timer); p.timer = null; }
  }

  io.to(roomId).emit("room_closed", { roomId, reason });

  socketIds.forEach((sid) => {
    const s = io.sockets.sockets.get(sid);
    if (!s) return;
    s.leave(roomId);
    if (s.data.currentRoomId === roomId) {
      s.data.currentRoomId = null;
    }
  });

  delete rooms[roomId];
};

// Rimozione definitiva: esce dal gioco, scade il tempo di rientro o l'host chiude.
const removePlayer = (roomId, key, reason = "left", notify = true) => {
  const room = rooms[roomId];
  const player = room && room.players[key];
  if (!room || !player) return;

  if (player.timer) { clearTimeout(player.timer); player.timer = null; }

  delete room.players[key];
  delete room.states[key];

  const s = io.sockets.sockets.get(player.id);
  if (s) {
    s.leave(roomId);
    if (s.data.currentRoomId === roomId) s.data.currentRoomId = null;
  }

  // L'host che esce chiude la stanza: e' il comportamento storico, invariato.
  if (key === room.hostKey) {
    closeRoom(roomId, reason === "timeout" ? "host_timeout" : "host_left");
    return;
  }

  if (notify) io.to(roomId).emit("player_left", { playerId: player.id });

  if (Object.keys(room.players).length === 0) {
    delete rooms[roomId];
  }
};

const leaveRoom = (socket, roomId) => {
  const targetRoomId = roomId || socket.data.currentRoomId;
  if (!targetRoomId) return;

  const room = rooms[targetRoomId];
  const key = socket.data.playerKey;
  const player = room && key ? room.players[key] : null;

  if (room && player && player.id === socket.id) {
    removePlayer(targetRoomId, key, "left", true);
    return;
  }

  socket.leave(targetRoomId);
  if (socket.data.currentRoomId === targetRoomId) {
    socket.data.currentRoomId = null;
  }
};

// Antispam: finestra di un secondo per socket. Oltre il doppio del limite la
// connessione viene chiusa, cosi' un client impazzito non occupa la stanza.
const rateOk = (socket) => {
  const now = Date.now();
  const w = socket.data.txWindow;
  if (!w || now - w.start >= RATE_WINDOW_MS) {
    socket.data.txWindow = { start: now, count: 1 };
    return true;
  }
  w.count++;
  if (w.count <= MAX_STATE_PER_WINDOW) return true;

  socket.data.abuso = (socket.data.abuso || 0) + 1;
  if (socket.data.abuso === MAX_ABUSE) {
    socket.emit("room_error", { code: "rate_limited", message: "Troppi aggiornamenti: rallenta." });
  }
  if (socket.data.abuso > MAX_ABUSE * 2) {
    socket.disconnect(true);
  }
  return false;
};

io.on("connection", (socket) => {
  socket.data.currentRoomId = null;
  socket.data.playerKey = null;
  console.log(`[CONN] ${socket.id}`);

  socket.on("get_rooms", () => {
    const activeRooms = Object.keys(rooms).map((id) => ({
      id,
      playerCount: Object.values(rooms[id].players).filter((p) => p.connected !== false).length
    }));
    socket.emit("rooms_list", activeRooms);
  });

  socket.on("v2_hello", (data) => {
    const roomId = data?.roomId;
    if (!validRoomId(roomId)) {
      socket.emit("room_error", { code: "invalid_room", message: "Identificativo stanza non valido." });
      return;
    }
    const name = cleanName(data?.name);
    // I client vecchi non mandano la chiave: restano identificati dal socket.
    const key = validPlayerKey(data?.playerKey) ? data.playerKey : socket.id;

    const stanzaEsistente = rooms[roomId];
    const giocatoreEsistente = stanzaEsistente ? stanzaEsistente.players[key] : null;

    if (stanzaEsistente && !giocatoreEsistente && Object.keys(stanzaEsistente.players).length >= MAX_PLAYERS) {
      socket.emit("room_error", { code: "room_full", message: "La stanza e' piena." });
      return;
    }
    if (!stanzaEsistente && Object.keys(rooms).length >= MAX_ROOMS) {
      socket.emit("room_error", { code: "server_full", message: "Troppe stanze attive, riprova tra poco." });
      return;
    }

    if (socket.data.currentRoomId && socket.data.currentRoomId !== roomId) {
      leaveRoom(socket, socket.data.currentRoomId);
    }

    socket.join(roomId);
    socket.data.currentRoomId = roomId;
    socket.data.playerKey = key;

    let room = rooms[roomId];
    if (!room) {
      room = rooms[roomId] = {
        id: roomId,
        hostKey: key,
        players: Object.create(null),
        states: Object.create(null),
        world: null,
        started: false
      };
    }
    if (Object.keys(room.players).length === 0) {
      room.hostKey = key;
    }

    const vecchioId = giocatoreEsistente ? giocatoreEsistente.id : null;
    const rientro = !!giocatoreEsistente
      && (giocatoreEsistente.connected === false || vecchioId !== socket.id);

    if (giocatoreEsistente && giocatoreEsistente.timer) {
      clearTimeout(giocatoreEsistente.timer);
      giocatoreEsistente.timer = null;
    }

    room.players[key] = giocatoreEsistente
      ? { ...giocatoreEsistente, id: socket.id, name: name || giocatoreEsistente.name, connected: true, isHost: key === room.hostKey, lastSeen: Date.now() }
      : { key, id: socket.id, name: name || "Player", connected: true, isHost: key === room.hostKey, lastSeen: Date.now() };

    const isHost = key === room.hostKey;

    // Se la stessa chiave arriva da un secondo socket, il vecchio non conta piu'.
    if (vecchioId && vecchioId !== socket.id) {
      const vecchio = io.sockets.sockets.get(vecchioId);
      if (vecchio) {
        vecchio.leave(roomId);
        if (vecchio.data.currentRoomId === roomId) vecchio.data.currentRoomId = null;
      }
      socket.to(roomId).emit("player_left", { playerId: vecchioId });
    }

    socket.emit("v2_welcome", {
      isHost,
      myAssignedId: socket.id,
      hostId: roomHostId(room),
      players: playerList(room),
      playerKey: key
    });

    if (rientro) {
      socket.to(roomId).emit("v2_player_joined", {
        id: socket.id,
        name: room.players[key].name,
        isHost
      });
      if (isHost) {
        socket.to(roomId).emit("v2_host", { hostId: socket.id, players: playerList(room) });
      }

      // Ripristino: ultimo stato del giocatore e ultimo mondo dell'host.
      const stato = room.states[key];
      socket.emit("v2_snapshot", {
        roomId,
        started: room.started,
        hostId: roomHostId(room),
        players: playerList(room),
        you: { key, id: socket.id, name: room.players[key].name },
        player: stato ? stato.player : null,
        world: room.world
      });
    } else if (!giocatoreEsistente) {
      socket.to(roomId).emit("v2_player_joined", room.players[key]);
    }
  });

  socket.on("v2_state", (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return;

    const roomId = data?.roomId;
    const key = socket.data.playerKey;
    // Si aggiorna solo la stanza in cui si e' entrati, non una qualsiasi.
    if (!validRoomId(roomId) || socket.data.currentRoomId !== roomId) return;

    const room = rooms[roomId];
    const player = room && key ? room.players[key] : null;
    if (!player || player.id !== socket.id || player.connected === false) return;
    if (typeof data.type !== "string" || data.type.length > 40) return;
    if (!rateOk(socket)) return;

    // Un pacchetto di stato ragionevole resta sotto i 24 KB: oltre e' spam o errore.
    let serializzato = "";
    try { serializzato = JSON.stringify(data); } catch { return; }
    if (serializzato.length > MAX_STATE_BYTES) return;

    player.lastSeen = Date.now();

    if (data.type === "v2_collect_item") {
      // Solo chi raccoglie puo' annunciare la raccolta.
      if (data.id !== socket.id) return;
      // La raccolta arriva anche a chi l'ha fatta: il client la ignora se e' sua.
      io.to(roomId).emit("v2_state", { ...data, _from: socket.id });
      return;
    }

    if (data.player && typeof data.player === "object") {
      room.states[key] = {
        player: sanitizePlayer({ ...data.player, id: socket.id }),
        at: Date.now()
      };
    }

    const payload = { ...data, _from: socket.id };
    if (room.states[key]) payload.player = room.states[key].player;

    if (key === room.hostKey && data.isHostSync) {
      room.world = {
        bots: Array.isArray(data.bots) ? data.bots.slice(0, 32) : [],
        powerUps: Array.isArray(data.powerUps) ? data.powerUps.slice(0, 150) : [],
        events: Array.isArray(data.events) ? data.events.slice(0, 30) : [],
        hazards: Array.isArray(data.hazards) ? data.hazards.slice(0, 60) : [],
        at: Date.now()
      };
    } else {
      delete payload.isHostSync;
      delete payload.bots;
      delete payload.powerUps;
      delete payload.events;
      delete payload.hazards;
    }

    socket.to(roomId).emit("v2_state", payload);
  });

  socket.on("v2_start", (data) => {
    const roomId = data?.roomId;
    if (roomId && rooms[roomId] && rooms[roomId].hostKey === socket.data.playerKey) {
      rooms[roomId].started = true;
      console.log(`[GAME_START] Stanza ${roomId}`);
      io.to(roomId).emit("v2_start");
    }
  });

  socket.on("v2_end", (data) => {
    const roomId = data?.roomId || socket.data.currentRoomId;
    if (roomId && rooms[roomId] && rooms[roomId].hostKey === socket.data.playerKey) {
      closeRoom(roomId, data?.reason || "game_finished");
    }
  });

  socket.on("leave_room", (data) => {
    leaveRoom(socket, data?.roomId || socket.data.currentRoomId);
  });

  // Caduta di rete: il giocatore resta in stanza per il tempo di rientro.
  socket.on("disconnect", () => {
    const roomId = socket.data.currentRoomId;
    const key = socket.data.playerKey;
    const room = roomId && key ? rooms[roomId] : null;
    const player = room ? room.players[key] : null;
    if (!room || !player || player.id !== socket.id) return;

    player.connected = false;
    player.lastSeen = Date.now();
    socket.data.currentRoomId = null;

    io.to(roomId).emit("player_left", { playerId: player.id });

    player.timer = setTimeout(() => {
      const r = rooms[roomId];
      const p = r && r.players[key];
      if (!r || !p || p.connected) return;
      removePlayer(roomId, key, "timeout", false);
    }, RECONNECT_GRACE_MS);
    if (player.timer.unref) player.timer.unref();
  });
});

httpServer.listen(PORT, "0.0.0.0");

// Render invia SIGTERM a ogni riavvio o sospensione: chiudiamo le connessioni
// in modo ordinato invece di lasciare il processo appeso.
const spegni = (segnale) => {
  console.log(`[STOP] Ricevuto ${segnale}: chiusura del server`);
  io.close(() => httpServer.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", () => spegni("SIGTERM"));
process.on("SIGINT", () => spegni("SIGINT"));

