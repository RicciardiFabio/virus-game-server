import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080; 

const server = http.createServer((req, res) => { 
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("VIRUS SERVER OPERATIONAL"); 
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== VIRUS SERVER V9 (HOST-FIX) STARTING ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    
    ws.send(JSON.stringify({ type: 'init', id: sessionId }));

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw.toString());
            console.log(`[${data.type}] da ${ws._id}`);

            if (data.type === 'get_rooms') {
                const list = Array.from(rooms.entries()).map(([id, r]) => ({
                    id, name: id, playerCount: r.size
                }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: list }));
            }

            if (data.type === 'create_room') {
                const rName = data.roomName || "SECTOR_" + Math.random().toString(36).slice(2, 7).toUpperCase();
                ws._roomId = rName;
                ws._isHost = true; // Segniamo che questo utente è l'host
                
                if (!rooms.has(rName)) rooms.set(rName, new Set());
                rooms.get(rName).add(ws);
                
                console.log(`[HOST] Stanza creata: ${rName}`);
                
                // Risposta per confermare all'host che la stanza è pronta
                ws.send(JSON.stringify({ 
                    type: 'room_created', 
                    roomId: rName,
                    success: true 
                }));
                
                // Alcuni client si aspettano anche questo per smettere il caricamento
                ws.send(JSON.stringify({ 
                    type: 'room_joined', 
                    roomId: rName, 
                    isHost: true 
                }));
            }

            if (data.type === 'v2_hello') {
                const rName = data.roomId || ws._roomId;
                console.log(`[HANDSHAKE] Host/Player pronto: ${data.name}`);

                // Risposta completa: il client smette di mandare hello solo se riceve v2_welcome
                ws.send(JSON.stringify({
                    type: 'v2_welcome',
                    roomId: rName,
                    playerId: ws._id,
                    isHost: ws._isHost || false,
                    config: { maxPlayers: 4 }, // Parametri spesso richiesti dai client
                    players: Array.from(rooms.get(rName) || []).map(p => ({ id: p._id }))
                }));
            }

            if (data.type === 'leave_room') {
                console.log(`[LEAVE] ${ws._id} ha lasciato la stanza`);
                handleDisconnect(ws);
            }

        } catch (e) {
            console.error("[ERR]", e);
        }
    });

    ws.on('close', () => handleDisconnect(ws));
});

function handleDisconnect(ws) {
    if (ws._roomId && rooms.has(ws._roomId)) {
        rooms.get(ws._roomId).delete(ws);
        if (rooms.get(ws._roomId).size === 0) {
            rooms.delete(ws._roomId);
            console.log(`[CLEANUP] Stanza ${ws._roomId} eliminata`);
        }
    }
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER ONLINE SULLA PORTA ${PORT} ===`);
});
