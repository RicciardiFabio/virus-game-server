import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("VIRUS-0 SERVER OPTIMIZED"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== SERVER AVVIATO (OPTIMIZED HANDSHAKE) ===");

wss.on('connection', (ws) => {
    // 1. Assegnazione ID e INIT immediato
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    ws.send(JSON.stringify({ type: 'init', id: sessionId }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());

            // --- GESTIONE LOBBY (NECESSARIA) ---
            if (msg.type === 'get_rooms') {
                const list = Array.from(rooms.entries()).map(([id, r]) => ({
                    id, 
                    name: id, 
                    playerCount: r.clients.size 
                }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: list, id: ws._id }));
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

            // --- HANDSHAKE V2 (IL TUO CODICE MIGLIORATO) ---
            if (msg.type === 'v2_hello' || msg.type === 'v2_join') {
                const rName = ws._roomId || msg.roomId;
                if (rName && rooms.has(rName)) {
                    ws._roomId = rName; // Assicuriamoci che il socket sappia dove si trova
                    ws._name = msg.name || "Agent";
                    const room = rooms.get(rName);
                    
                    if (!room.clients.has(ws)) room.clients.add(ws);

                    // RISPOSTA WELCOME
                    ws.send(JSON.stringify({
                        type: 'v2_welcome',
                        roomId: rName,
                        isHost: ws._isHost || false,
                        players: Array.from(room.clients).map(c => ({ 
                            id: c._id, 
                            name: c._name 
                        }))
                    }));

                    // ANNUNCIO AGLI ALTRI
                    const joinMsg = JSON.stringify({
                        type: 'v2_join',
                        _from: ws._id,
                        name: ws._name
                    });
                    
                    for(let client of room.clients) {
                        if (client !== ws && client.readyState === 1) {
                            client.send(joinMsg);
                        }
                    }
                }
            }

            // --- START GAME (SBLOCCO SCHERMATA NERA) ---
            if (msg.type === 'v2_start') {
                if (ws._roomId && rooms.has(ws._roomId)) {
                    console.log(`[START] Stanza ${ws._roomId}`);
                    const startSignal = JSON.stringify({ type: 'v2_start' });
                    rooms.get(ws._roomId).clients.forEach(client => {
                        if(client.readyState === 1) client.send(startSignal);
                    });
                }
            }
            
            // --- RELAY POSIZIONI (PVP) ---
            if (msg.type === 'v2_state') {
                 const rId = msg.roomId || ws._roomId;
                 if (rId && rooms.has(rId)) {
                     const payload = JSON.stringify({ ...msg, _from: ws._id });
                     rooms.get(rId).clients.forEach(client => {
                         if (client !== ws && client.readyState === 1) client.send(payload);
                     });
                 }
            }

            // --- USCITA ---
            if (msg.type === 'leave_room') {
                const rId = msg.roomId || ws._roomId;
                if (rId && rooms.has(rId)) {
                    rooms.get(rId).clients.delete(ws);
                    if (rooms.get(rId).clients.size === 0) rooms.delete(rId);
                }
            }

        } catch (e) {
            console.error("Errore socket:", e);
        }
    });

    ws.on('close', () => {
        if (ws._roomId && rooms.has(ws._roomId)) {
            rooms.get(ws._roomId).clients.delete(ws);
            if (rooms.get(ws._roomId).clients.size === 0) rooms.delete(ws._roomId);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`SERVER LISTENING ON PORT ${PORT}`));
