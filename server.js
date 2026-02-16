import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("VIRUS-0 SERVER V22"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== SERVER V22: METEO & SYNC READY ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    ws.send(JSON.stringify({ type: 'init', id: sessionId }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());

            // --- LOBBY: Solo stanze con giocatori ---
            if (msg.type === 'get_rooms') {
                const list = Array.from(rooms.entries())
                    .filter(([_, r]) => r.clients.size > 0)
                    .map(([id, r]) => ({
                        id, name: id, playerCount: r.clients.size
                    }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: list, data: list }));
                return;
            }

            // --- CREAZIONE / JOIN ---
            if (msg.type === 'create_room' || msg.type === 'v2_hello' || msg.type === 'v2_join') {
                const rName = msg.roomId || msg.roomName || "SECTOR-1";
                ws._roomId = rName;
                ws._name = msg.name || "Agent";

                if (!rooms.has(rName)) {
                    rooms.set(rName, { 
                        clients: new Set(), 
                        hostId: sessionId,
                        gameStarted: false,
                        weather: ['CLEAR', 'STORM', 'ACID_RAIN'][Math.floor(Math.random() * 3)]
                    });
                    ws._isHost = true;
                }
                
                const room = rooms.get(rName);
                room.clients.add(ws);

                // Aggiorniamo l'host se quello vecchio se n'è andato
                if (!Array.from(room.clients).some(c => c._id === room.hostId)) {
                    room.hostId = sessionId;
                    ws._isHost = true;
                }

                ws.send(JSON.stringify({
                    type: 'v2_welcome',
                    roomId: rName,
                    isHost: ws._id === room.hostId,
                    hostId: room.hostId,
                    players: Array.from(room.clients).map(c => ({ id: c._id, name: c._name }))
                }));

                // Notifica agli altri
                const joinAnnounce = JSON.stringify({ type: 'v2_join', _from: ws._id, name: ws._name });
                room.clients.forEach(c => { if(c !== ws) c.send(joinAnnounce); });
            }

            // --- START PARTITA (SINCRONIZZATA) ---
            if (msg.type === 'v2_start') {
                const room = rooms.get(ws._roomId);
                if (room && ws._id === room.hostId && room.clients.size >= 2) {
                    console.log(`[START] Stanza ${ws._roomId} avviata con meteo: ${room.weather}`);
                    
                    const startData = JSON.stringify({ 
                        type: 'v2_start',
                        config: {
                            weather: room.weather,
                            seed: Math.random(),
                            powerUps: [
                                { id: 1, type: 'SPEED', x: 200, y: 300 },
                                { id: 2, type: 'SHIELD', x: 500, y: 100 }
                            ]
                        }
                    });
                    
                    room.gameStarted = true;
                    room.clients.forEach(c => c.send(startData));
                }
            }

            // --- RELAY STATO ---
            if (msg.type === 'v2_state') {
                const room = rooms.get(ws._roomId);
                if (room) {
                    const payload = JSON.stringify({ ...msg, _from: ws._id });
                    room.clients.forEach(c => { if(c !== ws) c.send(payload); });
                }
            }

        } catch (e) { console.error(e); }
    });

    ws.on('close', () => {
        if (ws._roomId && rooms.has(ws._roomId)) {
            const room = rooms.get(ws._roomId);
            room.clients.delete(ws);
            if (room.clients.size === 0) {
                rooms.delete(ws._roomId);
                console.log(`[CLEANUP] Stanza ${ws._roomId} eliminata.`);
            }
        }
    });
});

server.listen(PORT, '0.0.0.0');
