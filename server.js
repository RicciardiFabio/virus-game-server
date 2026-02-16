import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("VIRUS-0 V28"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

// Funzione che urla a TUTTI la lista aggiornata
const broadcastRoomList = () => {
    const list = Array.from(rooms.entries())
        .map(([id, r]) => ({ id, name: id, playerCount: r.clients.size }));
    
    const payload = JSON.stringify({ type: 'rooms_list', rooms: list });
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(payload); });
};

wss.on('connection', (ws) => {
    ws._id = Math.random().toString(36).slice(2, 10);
    ws.send(JSON.stringify({ type: 'init', id: ws._id }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());

            if (msg.type === 'get_rooms') broadcastRoomList();

            if (msg.type === 'v2_hello' || msg.type === 'join_room' || msg.type === 'create_room') {
                const rId = msg.roomId || msg.roomName || "SECTOR-1";
                ws._roomId = rId;
                ws._name = msg.name || "Agent";

                if (!rooms.has(rId)) {
                    rooms.set(rId, { 
                        clients: new Set(), 
                        hostId: ws._id, 
                        weather: ['CLEAR', 'STORM', 'ACID_RAIN'][Math.floor(Math.random() * 3)] 
                    });
                }
                
                const room = rooms.get(rId);
                room.clients.add(ws);

                ws.send(JSON.stringify({
                    type: 'v2_welcome',
                    roomId: rId,
                    isHost: (ws._id === room.hostId),
                    hostId: room.hostId,
                    myAssignedId: ws._id,
                    players: Array.from(room.clients).map(c => ({ id: c._id, name: c._name })),
                    config: { weather: room.weather }
                }));
                broadcastRoomList();
            }

            if (msg.type === 'v2_start' && rooms.has(ws._roomId)) {
                const room = rooms.get(ws._roomId);
                if (ws._id === room.hostId) {
                    room.clients.forEach(c => c.send(JSON.stringify({ type: 'v2_start', config: { weather: room.weather } })));
                }
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        if (ws._roomId && rooms.has(ws._roomId)) {
            const room = rooms.get(ws._roomId);
            room.clients.delete(ws);

            // LOGICA DI KILL: Se la stanza è vuota O se chi è uscito era l'Host
            if (room.clients.size === 0 || ws._id === room.hostId) {
                console.log(`[CLEANUP] Stanza ${ws._roomId} rimossa.`);
                rooms.delete(ws._roomId);
            }
            broadcastRoomList();
        }
    });
});
server.listen(PORT, '0.0.0.0');
