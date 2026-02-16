import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("VIRUS-0 V25"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== SERVER V25: STARTING CLEANUP & SYNC PROTOCOL ===");

// 1. PULIZIA AUTOMATICA OGNI 30 SECONDI
setInterval(() => {
    rooms.forEach((room, roomId) => {
        if (room.clients.size === 0) {
            rooms.delete(roomId);
            console.log(`[CLEANUP] Stanza inattiva rimossa: ${roomId}`);
        }
    });
    broadcastRoomList();
}, 30000);

const broadcastRoomList = () => {
    const list = Array.from(rooms.entries()).map(([id, r]) => ({
        id: id, roomId: id, name: id, playerCount: r.clients.size
    }));
    const payload = JSON.stringify({ type: 'rooms_list', rooms: list });
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(payload); });
};

wss.on('connection', (ws) => {
    // Usiamo un ID univoco per questa connessione
    ws._id = Math.random().toString(36).slice(2, 10);
    ws.send(JSON.stringify({ type: 'init', id: ws._id }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());

            if (msg.type === 'get_rooms') broadcastRoomList();

            if (msg.type === 'v2_hello' || msg.type === 'create_room' || msg.type === 'join_room') {
                const rId = msg.roomId || "SECTOR-1";
                ws._roomId = rId;
                ws._name = msg.name || "Agent";

                if (!rooms.has(rId)) {
                    rooms.set(rId, { 
                        clients: new Set(), 
                        hostId: ws._id,
                        weather: ['CLEAR', 'STORM', 'ACID_RAIN'][Math.floor(Math.random() * 3)]
                    });
                    console.log(`[HOST] ${ws._name} ha creato la stanza ${rId}`);
                }
                
                const room = rooms.get(rId);
                room.clients.add(ws);

                // Se l'host originale è andato via, il primo che arriva prende il posto
                if (!Array.from(room.clients).some(c => c._id === room.hostId)) {
                    room.hostId = ws._id;
                }

                // MANDIAMO IL WELCOME CON L'ID HOST CHIARO
                ws.send(JSON.stringify({
                    type: 'v2_welcome',
                    roomId: rId,
                    isHost: (ws._id === room.hostId),
                    hostId: room.hostId,
                    players: Array.from(room.clients).map(c => ({ id: c._id, name: c._name })),
                    config: { weather: room.weather }
                }));

                broadcastRoomList();
            }

            if (msg.type === 'v2_start') {
                const room = rooms.get(ws._roomId);
                if (room && ws._id === room.hostId) {
                    console.log(`[GAME_START] Stanza ${ws._roomId} avviata dall'host ${ws._name}`);
                    const startData = JSON.stringify({ 
                        type: 'v2_start', 
                        config: { weather: room.weather, powerUps: [{id:1, type:'SPEED', x:300, y:300}] } 
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
            console.log(`[LEAVE] ${ws._name} è uscito da ${ws._roomId}. Rimasti: ${room.clients.size}`);
            if (room.clients.size === 0) rooms.delete(ws._roomId);
            broadcastRoomList();
        }
    });
});
server.listen(PORT, '0.0.0.0');
