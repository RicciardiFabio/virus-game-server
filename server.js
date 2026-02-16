import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("SERVER ONLINE");
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== VIRUS SERVER V19 (CLEAN & STABLE) ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    
    // 1. Mandiamo subito l'init come richiesto dal tuo WebSocketService
    ws.send(JSON.stringify({ type: 'init', id: sessionId }));

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw.toString());
            console.log(`[RECV] ${data.type} from ${ws._id}`);

            switch (data.type) {
                case 'get_rooms':
                    const availableRooms = Array.from(rooms.entries()).map(([id, clients]) => ({
                        id: id,
                        roomId: id,
                        playerCount: clients.size
                    }));
                    ws.send(JSON.stringify({ type: 'rooms_list', rooms: availableRooms }));
                    break;

                case 'create_room':
                    const rName = data.roomName || data.roomId || "ROOM_" + ws._id;
                    ws._roomId = rName;
                    ws._isHost = true;
                    if (!rooms.has(rName)) rooms.set(rName, new Set());
                    rooms.get(rName).add(ws);
                    
                    ws.send(JSON.stringify({
                        type: 'room_created',
                        roomId: rName,
                        id: ws._id,
                        isHost: true
                    }));
                    break;

                case 'v2_hello':
                    // Risposta essenziale per sbloccare la transizione
                    const rId = ws._roomId || data.roomId;
                    ws.send(JSON.stringify({
                        type: 'v2_welcome',
                        roomId: rId,
                        playerId: ws._id,
                        isHost: ws._isHost || false,
                        players: Array.from(rooms.get(rId) || []).map(p => ({ id: p._id }))
                    }));
                    break;

                case 'move':
                    // Broadcast semplice dei movimenti
                    if (ws._roomId && rooms.has(ws._roomId)) {
                        const payload = JSON.stringify({ type: 'player_moved', ...data, id: ws._id });
                        rooms.get(ws._roomId).forEach(client => {
                            if (client !== ws) client.send(payload);
                        });
                    }
                    break;
            }
        } catch (e) {
            console.error("Parsing error", e);
        }
    });

    ws.on('close', () => {
        if (ws._roomId && rooms.has(ws._roomId)) {
            rooms.get(ws._roomId).delete(ws);
            if (rooms.get(ws._roomId).size === 0) rooms.delete(ws._roomId);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
