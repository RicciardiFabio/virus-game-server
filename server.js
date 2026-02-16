import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080; 
const server = http.createServer((req, res) => { 
    res.writeHead(200); res.end("OK"); 
});
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== VIRUS SERVER V11 (PRODUCTION READY) ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    
    // Primo contatto
    ws.send(JSON.stringify({ 
        type: 'init', 
        id: sessionId, 
        data: { id: sessionId, sessionId: sessionId } 
    }));

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
                
                const responsePayload = {
                    type: 'room_created',
                    roomId: rName,
                    id: sessionId,
                    data: {
                        roomId: rName,
                        id: sessionId,
                        isHost: true
                    }
                };
                
                // Inviamo tutto il necessario per sbloccare il client
                ws.send(JSON.stringify(responsePayload));
                ws.send(JSON.stringify({ ...responsePayload, type: 'room_joined' }));
                ws.send(JSON.stringify({ ...responsePayload, type: 'create_room_success' }));
                console.log(`[HOST] Stanza ${rName} pronta.`);
            }

            if (msg.type === 'v2_hello') {
                const rName = msg.roomId || msg.data?.roomId || ws._roomId;
                
                // Risposta WELCOME ultra-nidificata
                const welcome = {
                    type: 'v2_welcome',
                    roomId: rName,
                    id: sessionId,
                    playerId: sessionId,
                    isHost: true,
                    data: {
                        roomId: rName,
                        playerId: sessionId,
                        isHost: true,
                        roomConfig: { maxPlayers: 4 },
                        players: Array.from(rooms.get(rName) || []).map(p => ({ 
                            id: p._id, 
                            playerId: p._id, 
                            name: "Survivor" 
                        }))
                    }
                };
                ws.send(JSON.stringify(welcome));
            }

            if (msg.type === 'leave_room') {
                cleanup(ws);
            }

        } catch (e) { console.error("Error:", e); }
    });

    ws.on('close', () => cleanup(ws));
});

function cleanup(ws) {
    if (ws._roomId && rooms.has(ws._roomId)) {
        rooms.get(ws._roomId).delete(ws);
        if (rooms.get(ws._roomId).size === 0) rooms.delete(ws._roomId);
        console.log(`[CLEANUP] Uscita da ${ws._roomId}`);
    }
}

server.listen(PORT, '0.0.0.0', () => console.log(`=== SERVER RUNNING ON PORT ${PORT} ===`));
