import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => { 
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Virus Server Online"); 
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== VIRUS SERVER V6 (ESM) STARTING ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    console.log(`[CONN] Client connesso: ${sessionId}`);
    
    // Mandiamo l'ID iniziale
    ws.send(JSON.stringify({ type: 'init', id: sessionId }));

    ws.on('message', (raw) => {
        const messageString = raw.toString();
        console.log(`[DATA] Ricevuto da ${ws._id}: ${messageString}`);
        
        try {
            const data = JSON.parse(messageString);
            
            // Gestione GET_ROOMS
            if (data.type === 'get_rooms') {
                const list = Array.from(rooms.entries()).map(([id, r]) => ({
                    id, name: id, playerCount: r.size
                }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: list }));
                console.log(`[INFO] Inviata lista stanze a ${ws._id}`);
            }

            // Gestione CREATE_ROOM / JOIN
            if (data.type === 'create_room') {
                const rName = data.roomName || "SECTOR_" + Math.random().toString(36).slice(2, 7).toUpperCase();
                ws._roomId = rName;
                
                if (!rooms.has(rName)) {
                    rooms.set(rName, new Set());
                }
                rooms.get(rName).add(ws);
                
                console.log(`[ROOM] Stanza creata/unita: ${rName} (Totale player: ${rooms.get(rName).size})`);
                
                // Inviamo conferme multiple per sbloccare il client
                const payload = { 
                    type: 'room_created', 
                    roomId: rName, 
                    id: sessionId,
                    data: { roomId: rName } 
                };
                
                ws.send(JSON.stringify(payload));
                ws.send(JSON.stringify({ ...payload, type: 'create_room_success' }));
                ws.send(JSON.stringify({ ...payload, type: 'room_joined' }));
            }
        } catch (e) {
            console.error("[ERR] Errore nel parsing del messaggio:", e);
        }
    });

    ws.on('close', () => {
        console.log(`[DISC] Client ${ws._id} disconnesso`);
        if (ws._roomId && rooms.has(ws._roomId)) {
            rooms.get(ws._roomId).delete(ws);
            if (rooms.get(ws._roomId).size === 0) {
                rooms.delete(ws._roomId);
                console.log(`[ROOM] Stanza ${ws._roomId} eliminata (vuota)`);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`=== SERVER IN ASCOLTO SULLA PORTA ${PORT} ===`);
});
