import { WebSocketServer } from 'ws';
import http from 'http';

// Porta dinamica per Railway (fallback 8080)
const PORT = process.env.PORT || 8080; 

// Server HTTP per Health Check e WebSocket
const server = http.createServer((req, res) => { 
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("VIRUS SERVER STATUS: OPERATIONAL"); 
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

console.log("=== VIRUS SERVER V8 (STABLE) STARTING ===");

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).slice(2, 10);
    ws._id = sessionId;
    
    console.log(`[CONN] Nuovo agente collegato: ${sessionId}`);
    
    // 1. Invio ID iniziale al client
    ws.send(JSON.stringify({ type: 'init', id: sessionId }));

    ws.on('message', (raw) => {
        const messageString = raw.toString();
        
        try {
            const data = JSON.parse(messageString);
            
            // LOG DEL TRAFFICO IN ENTRATA
            console.log(`[DATA] Da ${ws._id}: ${data.type}`);

            // GESTIONE: GET_ROOMS
            if (data.type === 'get_rooms') {
                const list = Array.from(rooms.entries()).map(([id, r]) => ({
                    id, name: id, playerCount: r.size
                }));
                ws.send(JSON.stringify({ type: 'rooms_list', rooms: list }));
            }

            // GESTIONE: CREATE_ROOM / JOIN
            if (data.type === 'create_room') {
                const rName = data.roomName || "SECTOR_" + Math.random().toString(36).slice(2, 7).toUpperCase();
                ws._roomId = rName;
                
                if (!rooms.has(rName)) {
                    rooms.set(rName, new Set());
                }
                rooms.get(rName).add(ws);
                
                console.log(`[ROOM] Inserito in: ${rName} | Totale: ${rooms.get(rName).size}`);
                
                // Conferma al client l'avvenuta creazione/ingresso
                ws.send(JSON.stringify({ 
                    type: 'room_created', 
                    roomId: rName, 
                    id: sessionId 
                }));
            }

            // GESTIONE: V2_HELLO (Il punto dove si bloccava)
            if (data.type === 'v2_hello') {
                const rId = data.roomId || ws._roomId;
                console.log(`[GAME] handshake ricevuto da ${data.name} (${ws._id})`);
                
                // Rispondiamo con WELCOME per sbloccare l'interfaccia del gioco
                ws.send(JSON.stringify({
                    type: 'v2_welcome',
                    roomId: rId,
                    playerId: ws._id,
                    players: [] // Inviabile per inizializzare altri player se necessario
                }));
            }

            // GESTIONE: BROADCAST DEI MOVIMENTI (Facoltativo ma utile)
            // Se invii pacchetti di gioco, puoi girarli a tutti gli altri nella stanza qui

        } catch (e) {
            console.error("[ERR] Errore elaborazione messaggio:", e);
        }
    });

    ws.on('close', () => {
        console.log(`[DISC] Agente ${ws._id} disconnesso`);
        if (ws._roomId && rooms.has(ws._roomId)) {
            rooms.get(ws._roomId).delete(ws);
            if (rooms.get(ws._roomId).size === 0) {
                rooms.delete(ws._roomId);
                console.log(`[ROOM] Settore ${ws._roomId} chiuso (vuoto)`);
            }
        }
    });
});

// Avvio del server su 0.0.0.0
server.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER ONLINE SU PORTA ${PORT} ===`);
    console.log(`=== MONITORAGGIO ATTIVO ===`);
});

// Protezione contro i crash fatali
process.on('uncaughtException', (err) => {
    console.error('[FATAL ERROR]:', err);
});
