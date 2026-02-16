import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("VIRUS-0 V23"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== SERVER V23: READY FOR LOBBY & ARENA ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    ws.send(JSON.stringify({ type: 'init', id: sessionId }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());

            // 1. GESTIONE LOBBY (Sempre visibile)
            if (msg.type === 'get_rooms') {
                const list = Array.from(rooms.entries()).map(([id, r]) => ({
                    id: id, 
                    roomId: id,
                    name: id, 
                    playerCount: r.clients.size 
                }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: list, data: list }));
                return;
            }

            // 2. CREAZIONE / JOIN (Unificata e immediata)
            if (msg.type === 'create_room' || msg.type === 'v2_hello' || msg.type === 'v2_join' || msg.type === 'join_room') {
                const rName = msg.roomId || msg.roomName || "SECTOR-1";
                ws._roomId = rName;
                ws._name = msg.name || "Agent";

                if (!rooms.has(rName)) {
                    rooms.set(rName, { 
                        clients: new Set(), 
                        hostId: sessionId,
                        weather: ['CLEAR', 'STORM', 'ACID_RAIN'][Math.floor(Math.random() * 3)],
                        seed: Math.random()
                    });
                    ws._isHost = true;
                }
                
                const room = rooms.get(rName);
                room.clients.add(ws);

                // Conferma al giocatore
                ws.send(JSON.stringify({
                    type: 'v2_welcome',
                    roomId: rName,
                    isHost: ws._id === room.hostId,
                    hostId: room.hostId,
                    players: Array.from(room.clients).map(c => ({ id: c._id, name: c._name })),
                    // Mandiamo anche i dati meteo già ora per sicurezza
                    config: { weather: room.weather, seed: room.seed }
                }));

                // Notifica agli altri
                const announce = JSON.stringify({ type: 'v2_join', _from: ws._id, name: ws._name });
                room.clients.forEach(c => { if(c !== ws) c.send(announce); });
            }

            // 3. START GAME (Solo l'host e con almeno 2 giocatori)
            if (msg.type === 'v2_start') {
                const room = rooms.get(ws._roomId);
                if (room && ws._id === room.hostId) {
                    const startData = JSON.stringify({ 
                        type: 'v2_start',
                        config: {
                            weather: room.weather,
                            seed: room.seed,
                            powerUps: [
                                { id: 1, type: 'SPEED', x: Math.random() * 800, y: Math.random() * 600 },
                                { id: 2, type: 'SHIELD', x: Math.random() * 800, y: Math.random() * 600 }
                            ]
                        }
                    });
                    room.clients.forEach(c => c.send(startData));
                }
            }

            // 4. MOVIMENTI & STATO
            if (msg.type === 'v2_state' || msg.type === 'move') {
                const room = rooms.get(ws._roomId);
                if (room) {
                    const payload = JSON.stringify({ ...msg, _from: ws._id });
                    room.clients.forEach(c => { if(c !== ws) c.send(payload); });
                }
            }

        } catch (e) { console.error("Error:", e); }
    });

    ws.on('close', () => {
        if (ws._roomId && rooms.has(ws._roomId)) {
            const room = rooms.get(ws._roomId);
            room.clients.delete(ws);
            if (room.clients.size === 0) rooms.delete(ws._roomId);
            else if (ws._id === room.hostId) {
                // Passa l'host al prossimo se l'host esce
                const nextHost = room.clients.values().next().value;
                if (nextHost) {
                    room.hostId = nextHost._id;
                    nextHost.send(JSON.stringify({ type: 'v2_host', hostId: room.hostId }));
                }
            }
        }
    });
});

server.listen(PORT, '0.0.0.0');
