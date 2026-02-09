import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ port: PORT });

const players = {};

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).slice(2);
  players[id] = { x: 0, y: 0 };

  ws.send(JSON.stringify({ type: "init", id }));

  ws.on("message", (msg) => {
    const data = JSON.parse(msg.toString());
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
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(payload);
  });
}, 50);
