import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080; 
const server = http.createServer((req, res) => { res.writeHead(200); res.end("OK"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            const type = msg.type || msg.data?.type;
            console.log(`[EVENTO] ${type} da ${ws._id}`);

            // 1. GESTIONE STANZE (Create/Join/Hello)
            if (type === 'create_room' || type === 'v2_join' || type === 'v2_hello') {
                const rName = msg.roomName || msg.roomId || msg.data?.roomId || ws._roomId || "MASTER";
                ws._roomId = rName;
                
                if (!rooms.has(rName)) {
                    rooms.set(rName, new Set());
                    ws._isHost = true;
                }
                rooms.get(rName).add(ws);

                // CREIAMO UN PAYLOAD UNIVERSALE (Sia piatto che nidificato)
                const payload = {
                    type: type === 'create_room' ? 'room_created' : 'v2_welcome',
                    roomId: rName,
                    id: sessionId,
                    playerId: sessionId,
                    isHost: ws._isHost || false,
                    success: true,
                    players: Array.from(rooms.get(rName)).map(p => ({ id: p._id })),
                    data: {
                        type: type === 'create_room' ? 'room_created' : 'v2_welcome',
                        roomId: rName,
                        playerId: sessionId,
                        isHost: ws._isHost || false,
                        success: true,
                        players: Array.from(rooms.get(rName)).map(p => ({ id: p._id }))
                    }
                };

                // SPARIAMO TUTTI I TIPI DI RISPOSTA POSSIBILI
                const jsonResponse = JSON.stringify(payload);
                ws.send(jsonResponse);
                ws.send(JSON.stringify({ ...payload, type: 'room_joined' }));
                ws.send(JSON.stringify({ ...payload, type: 'create_room_success' }));
                ws.send(JSON.stringify({ ...payload, type: 'v2_welcome' }));
                
                // Se siamo in due, avvisa l'altro!
                if (rooms.get(rName).size > 1) {
                    rooms.get(rName).forEach(client => {
                        if (client !== ws) {
                            client.send(JSON.stringify({ type: 'player_joined', newPlayer: sessionId }));
                        }
                    });
                }
            }

        } catch (e) { console.log("Errore:", e); }
    });

    ws.on('close', () => { /* cleanup */ });
});

server.listen(PORT, '0.0.0.0', () => console.log("SERVER V15 ONLINE"));
