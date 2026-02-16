import { WebSocketServer } from 'ws';
import http from 'http';

// Usiamo la porta 8080 come indicato dal tuo pannello Railway
const PORT = process.env.PORT || 8080; 

const server = http.createServer((req, res) => { 
    // Risposta per l'Health Check di Railway
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("OK"); 
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== VIRUS SERVER V7 STARTING ===");

wss.on('connection', (ws) => {
    // LOG FONDAMENTALE PER VEDERE SE IL CLIENT ARRIVA
    console.log("!!! QUALCUNO SI È CONNESSO !!!");
    
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    
    // Mandiamo l'ID iniziale immediatamente
    ws.send(JSON.stringify({ type: 'init', id: sessionId }));

    ws.on('message', (raw) => {
        const messageString = raw.toString();
        console.log(`[DATA] Ricevuto da ${ws._id}: ${messageString}`);
        
        try {
            const data = JSON.parse(messageString);
            
            if (data.type === 'get_rooms') {
                const list = Array.from(rooms.entries()).map(([id, r]) => ({
                    id, name: id, playerCount: r.size
                }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: list }));
            }

            if (data.type === 'create_room') {
                const rName = data.roomName || "SECTOR_" + Math.random().toString(36).slice(2, 7).toUpperCase();
                ws._roomId = rName;
                
                if (!rooms.has(rName)) {
                    rooms.set(rName, new Set());
                }
                rooms.get(rName).add(ws);
                
                console.log(`[ROOM] Stanza: ${rName} | Player: ${rooms.get(rName).size}`);
                
                const payload = JSON.stringify({ 
                    type: 'room_created', 
                    roomId: rName, 
                    id: sessionId 
                });
                
                ws.send(payload);
                ws.send(JSON.stringify({ type: 'create_room_success', roomId: rName }));
            }
        } catch (e) {
            console.error("[ERR] Parsing error:", e);
        }
    });

    ws.on('close', () => {
        console.log(`[DISC] Client ${ws._id} uscito`);
        if (ws._roomId && rooms.has(ws._roomId)) {
            rooms.get(ws._roomId).delete(ws);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER ONLINE SU PORTA ${PORT} ===`);
});

process.on('uncaughtException', (err) => {
    console.error('[FATAL] Exception:', err);
});
