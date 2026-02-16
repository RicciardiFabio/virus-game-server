const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => { res.end("Server Online"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== VIRUS SERVER V5 STARTING ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    console.log(`[CONN] New client: ${sessionId}`);
    
    ws.send(JSON.stringify({ type: 'init', id: sessionId }));

    ws.on('message', (raw) => {
        console.log(`[DATA] Received from ${ws._id}: ${raw}`);
        try {
            const data = JSON.parse(raw);
            
            if (data.type === 'get_rooms') {
                const list = Array.from(rooms.entries()).map(([id, r]) => ({
                    id, name: id, playerCount: r.size
                }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: list }));
            }

            if (data.type === 'create_room') {
                const rName = data.roomName || "AUTO_" + Math.random().toString(36).slice(2, 5);
                ws._roomId = rName;
                if (!rooms.has(rName)) rooms.set(rName, new Set());
                rooms.get(rName).add(ws);
                
                console.log(`[ROOM] Created/Joined: ${rName}`);
                
                // Risposta multipla per sicurezza
                const resp = JSON.stringify({ type: 'room_created', roomId: rName, id: sessionId });
                ws.send(resp);
                ws.send(JSON.stringify({ type: 'create_room_success', roomId: rName }));
            }
        } catch (e) {
            console.error("[ERR] Parsing error:", e);
        }
    });

    ws.on('close', () => {
        console.log(`[DISC] Client ${ws._id} left`);
        if (ws._roomId && rooms.has(ws._roomId)) {
            rooms.get(ws._roomId).delete(ws);
        }
    });
});

server.listen(PORT, () => console.log(`=== LISTENING ON ${PORT} ===`));
