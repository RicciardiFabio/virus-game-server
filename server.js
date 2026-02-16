import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080; 
const server = http.createServer((req, res) => { res.writeHead(200); res.end("OK"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== VIRUS SERVER V14 (SYNC FIX) ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    ws.send(JSON.stringify({ type: 'init', id: sessionId, data: { id: sessionId } }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            console.log(`[${msg.type}] da ${ws._id}`);

            // 1. LISTA STANZE - Formato ancora più compatibile
            if (msg.type === 'get_rooms') {
                const list = Array.from(rooms.entries()).map(([id, clients]) => ({
                    id: id, roomId: id, name: id, 
                    playerCount: clients.size, maxPlayers: 4
                }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: list, data: list }));
            }

            // 2. CREATE / JOIN - Gestiamoli insieme per evitare conflitti
            if (msg.type === 'create_room' || msg.type === 'v2_join' || msg.type === 'join_room') {
                const rName = msg.roomName || msg.roomId || msg.data?.roomId || "AUTO";
                ws._roomId = rName;
                
                if (!rooms.has(rName)) {
                    rooms.set(rName, new Set());
                    ws._isHost = true;
                }
                rooms.get(rName).add(ws);

                // Risposta "Tutto in uno" per sbloccare qualsiasi client
                const res = {
                    type: ws._isHost ? 'room_created' : 'room_joined',
                    roomId: rName,
                    id: sessionId,
                    data: { roomId: rName, id: sessionId, isHost: ws._isHost || false, success: true }
                };
                
                ws.send(JSON.stringify(res));
                ws.send(JSON.stringify({ ...res, type: 'v2_joined' }));
                ws.send(JSON.stringify({ ...res, type: 'create_room_success' }));
                console.log(`[ROOM] ${ws._id} -> ${rName} (Host: ${ws._isHost || false})`);
            }

            // 3. HANDSHAKE V2 - Forza lo stato di "In Gioco"
            if (msg.type === 'v2_hello') {
                const rName = ws._roomId || "LOBBY";
                const playersInRoom = Array.from(rooms.get(rName) || []).map(p => ({
                    id: p._id,
                    name: "Survivor",
                    isHost: p._isHost || false
                }));

                ws.send(JSON.stringify({
                    type: 'v2_welcome',
                    roomId: rName,
                    id: ws._id,
                    data: { 
                        roomId: rName, 
                        isHost: ws._isHost || false,
                        players: playersInRoom,
                        gameState: 'waiting'
                    }
                }));
                
                // Se ci sono 2 o più persone, mandiamo un segnale di START facoltativo
                if (playersInRoom.length >= 2) {
                    ws.send(JSON.stringify({ type: 'v2_start_game', roomId: rName }));
                }
            }

        } catch (e) { console.error("Errore"); }
    });

    ws.on('close', () => {
        if (ws._roomId && rooms.has(ws._roomId)) {
            rooms.get(ws._roomId).delete(ws);
            if (rooms.get(ws._roomId).size === 0) rooms.delete(ws._roomId);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`=== ONLINE PORT ${PORT} ===`));
