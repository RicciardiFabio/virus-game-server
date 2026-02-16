import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080; 
const server = http.createServer((req, res) => { res.writeHead(200); res.end("OK"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== VIRUS SERVER V13 (ROOM VISIBILITY FIX) ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    
    ws.send(JSON.stringify({ type: 'init', id: sessionId, data: { id: sessionId } }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            console.log(`[${msg.type}] da ${ws._id}`);

            // 1. LISTA STANZE (Formato esteso per la visibilità)
            if (msg.type === 'get_rooms') {
                const roomList = Array.from(rooms.entries()).map(([id, clients]) => ({
                    id: id,
                    roomId: id,
                    name: `Sector ${id}`,
                    playerCount: clients.size,
                    maxPlayers: 4,
                    status: 'waiting'
                }));
                
                ws.send(JSON.stringify({ 
                    type: 'rooms_list', 
                    rooms: roomList, 
                    data: roomList // Mandiamo sia come radice che come data
                }));
                console.log(`-> Inviate ${roomList.length} stanze a ${ws._id}`);
            }

            // 2. CREAZIONE STANZA
            if (msg.type === 'create_room') {
                const rName = msg.roomName || msg.data?.roomName || "ROOM_" + Math.random().toString(36).slice(2, 5).toUpperCase();
                ws._roomId = rName;
                ws._isHost = true;
                
                if (!rooms.has(rName)) rooms.set(rName, new Set());
                rooms.get(rName).add(ws);

                const response = {
                    type: 'room_created',
                    roomId: rName,
                    data: { roomId: rName, isHost: true }
                };
                ws.send(JSON.stringify(response));
                console.log(`[STAZIONE] Creato settore ${rName}`);
            }

            // 3. GESTIONE JOIN (Per fermare il loop v2_join)
            if (msg.type === 'v2_join' || msg.type === 'join_room') {
                const rName = msg.roomId || msg.data?.roomId || ws._roomId;
                if (rooms.has(rName)) {
                    rooms.get(rName).add(ws);
                    ws._roomId = rName;
                    
                    const joinRes = {
                        type: 'v2_joined', // O v2_welcome_back
                        roomId: rName,
                        success: true,
                        data: { roomId: rName, success: true }
                    };
                    ws.send(JSON.stringify(joinRes));
                    ws.send(JSON.stringify({ ...joinRes, type: 'room_joined' }));
                    console.log(`[JOIN] ${ws._id} è entrato in ${rName}`);
                }
            }

            // 4. HANDSHAKE V2 (Sblocca l'interfaccia)
            if (msg.type === 'v2_hello') {
                const rName = ws._roomId || "LOBBY";
                const welcome = {
                    type: 'v2_welcome',
                    roomId: rName,
                    id: ws._id,
                    data: { 
                        roomId: rName, 
                        isHost: ws._isHost || false,
                        players: Array.from(rooms.get(rName) || []).map(p => ({ id: p._id }))
                    }
                };
                ws.send(JSON.stringify(welcome));
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
