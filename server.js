import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("VIRUS-0 SERVER OPTIMIZED"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== SERVER AVVIATO (V21 - FINAL SYNC) ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    ws.send(JSON.stringify({ type: 'init', id: sessionId }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());

            // --- LISTA STANZE (Fix per la Lobby) ---
            if (msg.type === 'get_rooms') {
                const list = Array.from(rooms.entries()).map(([id, r]) => ({
                    id: id, 
                    roomId: id,
                    name: id, 
                    playerCount: r.clients.size 
                }));
                // Mandiamo sia 'rooms' che 'data' per massima compatibilità
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: list, data: list }));
                return;
            }

            // --- CREAZIONE STANZA ---
            if (msg.type === 'create_room') {
                const rName = msg.roomName || msg.roomId || "ROOM_" + sessionId;
                ws._roomId = rName;
                ws._isHost = true;
                
                if (!rooms.has(rName)) {
                    rooms.set(rName, { clients: new Set() });
                }
                rooms.get(rName).clients.add(ws);
                
                ws.send(JSON.stringify({ 
                    type: 'room_created', 
                    roomId: rName, 
                    id: ws._id, 
                    isHost: true 
                }));
                return;
            }

            // --- HANDSHAKE V2 (Sblocca WaitingRoom) ---
            if (msg.type === 'v2_hello' || msg.type === 'v2_join') {
                const rName = ws._roomId || msg.roomId;
                if (rName && rooms.has(rName)) {
                    ws._roomId = rName;
                    ws._name = msg.name || "Agent";
                    const room = rooms.get(rName);
                    
                    if (!room.clients.has(ws)) room.clients.add(ws);

                    ws.send(JSON.stringify({
                        type: 'v2_welcome',
                        roomId: rName,
                        isHost: ws._isHost || false,
                        players: Array.from(room.clients).map(c => ({ id: c._id, name: c._name }))
                    }));

                    const joinMsg = JSON.stringify({
                        type: 'v2_join',
                        _from: ws._id, // Fondamentale per il tuo client!
                        name: ws._name
                    });
                    
                    room.clients.forEach(client => {
                        if (client !== ws && client.readyState === 1) client.send(joinMsg);
                    });
                }
            }

            // --- START GAME (Sblocca schermo nero) ---
            if (msg.type === 'v2_start') {
                if (ws._roomId && rooms.has(ws._roomId)) {
                    const startSignal = JSON.stringify({ type: 'v2_start' });
                    rooms.get(ws._roomId).clients.forEach(client => {
                        if(client.readyState === 1) client.send(startSignal);
                    });
                }
            }
            
            // --- MOVIMENTI ---
            if (msg.type === 'v2_state') {
                 const rId = msg.roomId || ws._roomId;
                 if (rId && rooms.has(rId)) {
                     const payload = JSON.stringify({ ...msg, _from: ws._id });
                     rooms.get(rId).clients.forEach(client => {
                         if (client !== ws && client.readyState === 1) client.send(payload);
                     });
                 }
            }

        } catch (e) { console.error("Errore:", e); }
    });

    ws.on('close', () => {
        if (ws._roomId && rooms.has(ws._roomId)) {
            rooms.get(ws._roomId).clients.delete(ws);
            if (rooms.get(ws._roomId).clients.size === 0) rooms.delete(ws._roomId);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`PORT: ${PORT}`));
