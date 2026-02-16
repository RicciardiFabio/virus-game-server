import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080; 
const server = http.createServer((req, res) => { 
    res.writeHead(200); res.end("OK"); 
});
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== VIRUS SERVER V10 (FINAL STRUCTURE) ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    
    // Alcuni client si aspettano l'init dentro un oggetto 'data'
    ws.send(JSON.stringify({ type: 'init', id: sessionId, data: { id: sessionId } }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            console.log(`[${msg.type}] da ${ws._id}`);

            if (msg.type === 'get_rooms') {
                const list = Array.from(rooms.entries()).map(([id, r]) => ({
                    id, name: id, playerCount: r.size
                }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: list, data: list }));
            }

            if (msg.type === 'create_room') {
                const rName = msg.roomName || msg.data?.roomName || "ROOM_" + Math.random().toString(36).slice(2, 5).toUpperCase();
                ws._roomId = rName;
                ws._isHost = true;
                
                if (!rooms.has(rName)) rooms.set(rName, new Set());
                rooms.get(rName).add(ws);
                
                // MANDIAMO TUTTE LE POSSIBILI CONFERME
                const response = { type: 'room_created', roomId: rName, id: sessionId, data: { roomId: rName, id: sessionId } };
                ws.send(JSON.stringify(response));
                ws.send(JSON.stringify({ ...response, type: 'room_joined' }));
                ws.send(JSON.stringify({ ...response, type: 'create_room_success' }));
            }

            if (msg.type === 'v2_hello') {
                const rName = msg.roomId || msg.data?.roomId || ws._roomId;
                
                // STRUTTURA WELCOME COMPLETA (Spesso necessaria per sbloccare l'host)
                ws.send(JSON.stringify({
                    type: 'v2_welcome',
                    roomId: rName,
                    id: sessionId,
                    playerId: sessionId,
                    isHost: true,
                    data: {
                        roomId: rName,
                        playerId: sessionId,
                        isHost: true,
                        players: Array.from(rooms.get(rName) || []).map(p => ({ id: p._id, name: "Player" }))
                    }
                }));
                console.log(`[HANDSHAKE] Inviato Welcome a Host`);
            }

        } catch (e) { console.error(e); }
    });

    ws.on('close', () => {
        if (ws._roomId && rooms.has(ws._roomId)) {
            rooms.get(ws._roomId).delete(ws);
            if (rooms.get(ws._roomId).size === 0) rooms.delete(ws._roomId);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`=== ONLINE SULLA ${PORT} ===`));
