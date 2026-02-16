import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("OK"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    
    // 1. INIT IMMEDIATO
    ws.send(JSON.stringify({ type: 'init', id: sessionId, data: { id: sessionId } }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            const type = msg.type || (msg.data && msg.data.type);
            
            if (type === 'get_rooms') {
                const list = Array.from(rooms.entries()).map(([id, c]) => ({ id, roomId: id, playerCount: c.size }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: list, data: list }));
            }

            if (type === 'create_room' || type === 'v2_join' || type === 'join_room') {
                const rName = msg.roomName || msg.roomId || msg.data?.roomId || "MASTER";
                ws._roomId = rName;
                if (!rooms.has(rName)) { rooms.set(rName, new Set()); ws._isHost = true; }
                rooms.get(rName).add(ws);

                // MANDIAMO UN "BOMBARDAMENTO" DI CONFERME
                const handshake = {
                    type: 'v2_welcome',
                    roomId: rName,
                    id: sessionId,
                    isHost: ws._isHost || false,
                    players: Array.from(rooms.get(rName)).map(p => ({ id: p._id })),
                    data: { roomId: rName, isHost: ws._isHost || false }
                };
                
                ws.send(JSON.stringify(handshake));
                ws.send(JSON.stringify({ ...handshake, type: 'room_created' }));
                ws.send(JSON.stringify({ ...handshake, type: 'room_joined' }));
            }

            if (type === 'v2_hello') {
                // Risposta standard al loop
                ws.send(JSON.stringify({
                    type: 'v2_welcome',
                    roomId: ws._roomId,
                    id: ws._id,
                    data: { roomId: ws._roomId, isHost: ws._isHost || false }
                }));
            }
        } catch (e) {}
    });
});

server.listen(PORT, '0.0.0.0', () => console.log("V17 ONLINE"));
