import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("OK"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== VIRUS SERVER V16 (CLIENT-READY) ===");

wss.on('connection', (ws) => {
    // GENERIAMO IMMEDIATAMENTE L'ID
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    ws._isConnected = true;

    console.log(`[CONN] Client connesso, assegno ID: ${sessionId}`);

    // INVIAMO IMMEDIATAMENTE L'INIT (Il tuo client lo aspetta per sbloccarsi)
    const initPayload = JSON.stringify({
        type: 'init',
        id: sessionId,
        playerId: sessionId,
        data: { id: sessionId, playerId: sessionId }
    });
    ws.send(initPayload);

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            const type = msg.type;
            console.log(`[EVENT] Ricevuto: ${type} da ${ws._id}`);

            // GESTIONE GET_ROOMS
            if (type === 'get_rooms') {
                const roomList = Array.from(rooms.entries()).map(([id, clients]) => ({
                    id: id,
                    roomId: id,
                    name: id,
                    playerCount: clients.size,
                    maxPlayers: 4
                }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: roomList, data: roomList }));
            }

            // GESTIONE CREATE / JOIN
            if (type === 'create_room' || type === 'join_room' || type === 'v2_join') {
                const rName = msg.roomName || msg.roomId || (msg.data && msg.data.roomId) || "SECTOR_1";
                ws._roomId = rName;
                
                if (!rooms.has(rName)) {
                    rooms.set(rName, new Set());
                    ws._isHost = true;
                }
                rooms.get(rName).add(ws);

                // Risposta multipla per sbloccare i listener del client
                const response = {
                    type: ws._isHost ? 'room_created' : 'room_joined',
                    roomId: rName,
                    id: ws._id,
                    success: true,
                    data: { roomId: rName, id: ws._id, isHost: ws._isHost || false }
                };

                ws.send(JSON.stringify(response));
                // Mandiamo anche v2_welcome se è un hello mascherato
                ws.send(JSON.stringify({ ...response, type: 'v2_welcome' }));
            }

            // GESTIONE V2_HELLO
            if (type === 'v2_hello') {
                const rName = ws._roomId || "LOBBY";
                ws.send(JSON.stringify({
                    type: 'v2_welcome',
                    roomId: rName,
                    id: ws._id,
                    playerId: ws._id,
                    isHost: ws._isHost || false,
                    data: { 
                        roomId: rName, 
                        players: Array.from(rooms.get(rName) || []).map(p => ({ id: p._id }))
                    }
                }));
            }

        } catch (e) {
            console.error("Errore nel parsing del messaggio");
        }
    });

    ws.on('close', () => {
        if (ws._roomId && rooms.has(ws._roomId)) {
            rooms.get(ws._roomId).delete(ws);
            if (rooms.get(ws._roomId).size === 0) rooms.delete(ws._roomId);
        }
        console.log(`[DISC] Client ${ws._id} uscito`);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER STABILE SULLA PORTA ${PORT} ===`);
});
