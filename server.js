import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("OK"); });
const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== VIRUS SERVER V18 (ANTI-BLACK-SCREEN) ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    
    // 1. INIT IMMEDIATO
    ws.send(JSON.stringify({ type: 'init', id: sessionId, data: { id: sessionId } }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            const type = msg.type;
            
            if (type === 'get_rooms') {
                const list = Array.from(rooms.entries()).map(([id, c]) => ({ id, roomId: id, playerCount: c.size }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: list }));
            }

            if (type === 'create_room' || type === 'join_room' || type === 'v2_join') {
                const rName = msg.roomName || msg.roomId || msg.data?.roomId || "SECTOR_1";
                ws._roomId = rName;
                if (!rooms.has(rName)) {
                    rooms.set(rName, new Set());
                    ws._isHost = true;
                }
                rooms.get(rName).add(ws);

                // CREIAMO UN PLAYER OBJECT COMPLETO (Per evitare lo schermo nero)
                const playerObj = {
                    id: ws._id,
                    playerId: ws._id,
                    name: "Survivor",
                    x: 100, // Posizione iniziale
                    y: 100,
                    health: 100,
                    isHost: ws._isHost || false
                };

                const playersInRoom = Array.from(rooms.get(rName)).map(p => ({
                    id: p._id,
                    playerId: p._id,
                    name: "Survivor",
                    x: 100,
                    y: 100,
                    isHost: p._isHost || false
                }));

                const handshake = {
                    type: 'v2_welcome',
                    roomId: rName,
                    id: ws._id,
                    playerId: ws._id,
                    isHost: ws._isHost || false,
                    players: playersInRoom,
                    data: {
                        roomId: rName,
                        player: playerObj,
                        players: playersInRoom
                    }
                };
                
                ws.send(JSON.stringify(handshake));
                ws.send(JSON.stringify({ ...handshake, type: 'room_joined' }));
                console.log(`[GAME] Handshake inviato a ${ws._id}.`);
            }

            // Gestione dei movimenti per non far stare fermi i giocatori
            if (type === 'move') {
                // Inoltra il movimento a tutti gli altri nella stanza
                if (ws._roomId && rooms.has(ws._roomId)) {
                    const moveData = JSON.stringify({ type: 'player_moved', ...msg });
                    rooms.get(ws._roomId).forEach(client => {
                        if (client !== ws) client.send(moveData);
                    });
                }
            }

        } catch (e) { console.error("Errore"); }
    });

    ws.on('close', () => {
        if (ws._roomId && rooms.has(ws._roomId)) {
            rooms.get(ws._roomId).delete(ws);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => console.log("V18 ONLINE - PRONTO AL GIOCO"));
