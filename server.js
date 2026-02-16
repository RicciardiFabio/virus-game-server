import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080; 
const server = http.createServer((req, res) => { res.writeHead(200); res.end("OK"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== VIRUS SERVER V12 (DEBUG MODE) ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    
    // Mandiamo un init che copre ogni possibile struttura
    const initMsg = { type: 'init', id: sessionId, playerId: sessionId, data: { id: sessionId } };
    ws.send(JSON.stringify(initMsg));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            console.log(`[${msg.type}] da ${ws._id}`);

            // Risposta automatica universale per ogni messaggio
            // Se il client manda 'create_room', noi rispondiamo con 'room_created' + i suoi stessi dati
            if (msg.type === 'create_room' || msg.type === 'join_room') {
                const rName = msg.roomName || msg.data?.roomName || "ROOM_X";
                ws._roomId = rName;
                if (!rooms.has(rName)) rooms.set(rName, new Set());
                rooms.get(rName).add(ws);

                const res = {
                    type: msg.type === 'create_room' ? 'room_created' : 'room_joined',
                    roomId: rName,
                    success: true,
                    data: { ...msg.data, roomId: rName, id: sessionId, isHost: msg.type === 'create_room' }
                };
                ws.send(JSON.stringify(res));
                // Mandiamo anche la versione senza 'data' per sicurezza
                ws.send(JSON.stringify({ ...res, ...res.data }));
            }

            if (msg.type === 'v2_hello') {
                // COPIAMO ESATTAMENTE IL FORMATO DEL CLIENT
                const welcome = {
                    type: 'v2_welcome',
                    ...msg, // Copia roomId, name, ecc dal messaggio originale
                    playerId: ws._id,
                    data: { 
                        ...msg.data, 
                        playerId: ws._id, 
                        isHost: true,
                        players: Array.from(rooms.get(ws._roomId) || []).map(p => ({ id: p._id }))
                    }
                };
                ws.send(JSON.stringify(welcome));
                console.log(`-> Welcome inviato a ${ws._id}`);
            }

        } catch (e) { console.log("Errore JSON"); }
    });

    ws.on('close', () => {
        if (ws._roomId && rooms.has(ws._roomId)) rooms.get(ws._roomId).delete(ws);
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`=== SERVER ONLINE ===`));
