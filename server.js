import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("VIRUS-0 V24"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== SERVER V24: EMERGENCY ROOM FIX ===");

// Funzione per inviare la lista stanze a tutti quelli che sono nella Lobby
const broadcastRoomList = () => {
    const list = Array.from(rooms.entries()).map(([id, r]) => ({
        id: id, roomId: id, name: id, playerCount: r.clients.size
    }));
    const payload = JSON.stringify({ type: 'rooms_list', rooms: list, data: list });
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(payload);
    });
};

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    ws.send(JSON.stringify({ type: 'init', id: sessionId }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());

            if (msg.type === 'get_rooms') {
                broadcastRoomList();
            }

            if (msg.type === 'create_room' || msg.type === 'join_room' || msg.type === 'v2_hello') {
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
                    console.log(`[CREATE] Stanza creata: ${rName}`);
                }
                
                const room = rooms.get(rName);
                room.clients.add(ws);

                // Se la stanza non ha un host valido, questo giocatore diventa host
                if (!room.hostId) room.hostId = sessionId;

                ws.send(JSON.stringify({
                    type: 'v2_welcome',
                    roomId: rName,
                    isHost: (ws._id === room.hostId),
                    hostId: room.hostId,
                    players: Array.from(room.clients).map(c => ({ id: c._id, name: c._name })),
                    config: { weather: room.weather, seed: room.seed }
                }));

                broadcastRoomList(); // Aggiorna tutti subito
            }

            if (msg.type === 'v2_start') {
                const room = rooms.get(ws._roomId);
                if (room && ws._id === room.hostId) {
                    const startData = JSON.stringify({ 
                        type: 'v2_start',
                        config: {
                            weather: room.weather,
                            seed: room.seed,
                            powerUps: [
                                { id: 1, type: 'SPEED', x: 400, y: 300 },
                                { id: 2, type: 'SHIELD', x: 600, y: 200 }
                            ]
                        }
                    });
                    room.clients.forEach(c => c.send(startData));
                }
            }

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
            } else if (ws._id === room.hostId) {
                const next = room.clients.values().next().value;
                if (next) {
                    room.hostId = next._id;
                    next.send(JSON.stringify({ type: 'v2_host', hostId: room.hostId }));
                }
            }
            broadcastRoomList();
        }
    });
});

server.listen(PORT, '0.0.0.0');
