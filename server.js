import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;

// 1) Server HTTP "vero" (Railway lo vuole)
const server = http.createServer((req, res) => {
  // healthcheck semplice
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  // se qualcuno apre la pagina nel browser
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket server: use /ws");
});

// 2) WebSocket attaccato al server HTTP su path /ws
const wss = new WebSocketServer({ server, path: "/ws" });

const players = {};

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).slice(2);
  players[id] = { x: 0, y: 0 };

  ws.send(JSON.stringify({ type: "init", id }));

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      return;
    }

    if (data.type === "move") {
      players[id].x = data.x;
      players[id].y = data.y;
    }
  });

  ws.on("close", () => {
    delete players[id];
  });
});

setInterval(() => {
  const payload = JSON.stringify({ type: "state", players });
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(payload);
  });
}, 50);

// 3) IMPORTANTISSIMO: ascolta sulla PORT di Railway
server.listen(PORT, () => {
  console.log("HTTP listening on", PORT);
  console.log("WS endpoint: /ws");
});
