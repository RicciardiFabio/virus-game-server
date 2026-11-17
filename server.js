import { Server } from "socket.io";
import http from "http";
import crypto from "crypto";

const PORT = process.env.PORT || 8080;

// Classifiche interne HobbyGame. Il server firma ogni risultato con HMAC:
// se le variabili non sono configurate il gioco resta identico e il
// salvataggio viene dichiarato "skipped", senza inventare esiti.
const SCORES_URL = (process.env.HG_SCORES_URL || "").trim();
const SCORES_SECRET = (process.env.HG_SCORES_SECRET || "").trim();
const SCORES_TIMEOUT_MS = 8000;
const SCORES_MAX_TENTATIVI = 3;

// Origini autorizzate: il gioco pubblico e i collaudi locali. Si possono
// ampliare con la variabile CORS_ORIGINS, senza aprire il server a tutti.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || [
  "https://websitedefault.it",
  "https://www.websitedefault.it",
  "https://hobby-game.it",
  "https://www.hobby-game.it",
  "https://appassets.androidplatform.net",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
].join(","))
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const httpServer = http.createServer((req, res) => {
  // Risultato del giocatore singolo: il browser non possiede il segreto HMAC,
  // quindi passa da qui. La richiesta e' validata, limitata e firmata dal server.
  if (req.url === "/solo-result") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, intestazioniCors(req));
      res.end();
      return;
    }
    if (req.method === "POST") {
      gestisciRisultatoSolo(req, res);
      return;
    }
    rispondiJson(res, 405, { esito: "error", codice: "metodo_non_ammesso" }, req, { Allow: "POST, OPTIONS" });
    return;
  }
  // /health serve al client per risvegliare il servizio gratuito dopo la
  // sospensione: risponde appena il processo e' pronto.
  if (req.url === "/health" || req.url === "/healthz") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({
      ok: true,
      servizio: "virus-game-server",
      stanze: Object.keys(rooms).length,
      uptimeSec: Math.round(process.uptime())
    }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("SERVER MULTIPLAYER V30: STATO IN STANZA E RIPRISTINO");
});

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => callback(null, !origin || ALLOWED_ORIGINS.includes(origin)),
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

// Oggetto senza prototipo: un identificativo come "__proto__" non puo' alterare lo stato.
const rooms = Object.create(null);

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const PLAYER_KEY_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const ROOM_IDS_RISERVATI = new Set(["__proto__", "constructor", "prototype"]);
const MAX_PLAYERS = 16;
const MAX_STATE_BYTES = 24576;
const MAX_ROOMS = 200;

// Dopo una caduta di rete la stanza resta in piedi per un minuto: chi rientra
// ritrova il proprio stato, chi non rientra libera il posto.
const RECONNECT_GRACE_MS = Number(process.env.HG_RECONNECT_GRACE_MS || 60000);

// All'inizio di una partita i client possono avere ancora in coda un pacchetto
// della partita precedente (con le vecchie infezioni). In questa finestra il
// server aggiorna gli stati ma non dichiara mai conclusa la partita: evita
// finali a pochi decimi di secondo con il vincitore sbagliato.
const MATCH_START_GRACE_MS = Number(process.env.HG_MATCH_START_GRACE_MS || 3000);

// Il client invia 20 pacchetti al secondo: il tetto resta piu' alto del normale.
const RATE_WINDOW_MS = 1000;
const MAX_STATE_PER_WINDOW = 60;
const MAX_ABUSE = 40;

const validRoomId = (v) => typeof v === "string"
  && ROOM_ID_PATTERN.test(v)
  && !ROOM_IDS_RISERVATI.has(v.toLowerCase());

// Chiave stabile del giocatore: sopravvive alla riconnessione, cambia con la scheda.
const validPlayerKey = (v) => typeof v === "string" && PLAYER_KEY_PATTERN.test(v);

const cleanName = (v) => {
  const testo = typeof v === "string" ? v : "Player";
  const pulito = testo.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 24);
  return pulito || "Player";
};

const num = (v, min = -10000, max = 10000) => Number.isFinite(v)
  ? Math.min(max, Math.max(min, Math.round(v)))
  : 0;

const sanitizePlayer = (p) => ({
  id: typeof p?.id === "string" ? p.id.slice(0, 64) : "",
  name: cleanName(p?.name),
  x: num(p?.x),
  y: num(p?.y),
  state: typeof p?.state === "string" ? p.state.slice(0, 20) : "HEALTHY",
  activePowerUps: p && typeof p.activePowerUps === "object" && p.activePowerUps !== null
    ? p.activePowerUps
    : {},
  trail: Array.isArray(p?.trail) ? p.trail.slice(0, 40) : []
});

const roomHostId = (room) => {
  const host = room && room.players[room.hostKey];
  return host ? host.id : "";
};

const playerList = (room) => Object.keys(room.players)
  .map((k) => room.players[k])
  .filter((p) => p.connected !== false)
  .map((p) => ({ id: p.id, name: p.name, isHost: p.key === room.hostKey }));

// Infezioni decise dall'host. Si conservano sia gli identificativi ricevuti
// (servono ai client per mostrare i bot infetti) sia la chiave stabile dei
// giocatori: dopo una riconnessione l'id cambia ma la chiave no.
const mergeHostInfections = (room, ids) => {
  if (!Array.isArray(ids)) return;
  for (const raw of ids.slice(0, 64)) {
    if (typeof raw !== "string") continue;
    const id = raw.slice(0, 64);
    if (!id) continue;
    room.hostInfections.add(id);
    const chiave = Object.keys(room.players).find((k) => room.players[k].id === id);
    if (chiave) room.infectedKeys.add(chiave);
  }
};

// Elenco aggiornato da trasmettere: per i giocatori riconnessi vale l'id
// corrente, per i bot restano gli id dichiarati dall'host.
const infectionIdsFor = (room) => {
  const ids = new Set(room.hostInfections);
  for (const chiave of room.infectedKeys) {
    const p = room.players[chiave];
    if (p) ids.add(p.id);
  }
  const elenco = Array.from(ids);
  return elenco.length > 64 ? elenco.slice(0, 64) : elenco;
};

const notificaSalvataggio = (roomId, resultId, status, messaggio) => {
  const room = rooms[roomId];
  if (room && room.result && room.result.resultId === resultId) {
    room.result.saveStatus = status;
    room.resultSaved = status;
  }
  io.to(roomId).emit("v2_result_saved", { resultId, status, message: messaggio || undefined });
};

// Il plugin WordPress accetta soltanto il contratto pubblico documentato:
// modalita' "multi", data ISO 8601 UTC e nomi degli esiti in italiano.
// La conversione avviene qui, in un unico punto, per non duplicarla nei client.
const ESITI_CLASSIFICA = {
  VICTORY: "vittoria",
  INFECTED: "infetto",
  DEFEAT: "sconfitta",
  DISCONNECTED: "disconnesso"
};

const dataIsoClassifica = (ms) => {
  const data = new Date(Number(ms) || Date.now());
  return data.toISOString().replace(/\.\d{3}Z$/, "Z");
};

// Firma e invia un risultato al plugin di WordPress.
// Restituisce { esito: "saved" | "duplicate" | "skipped" | "error", messaggio? }.
const inviaFirmata = async (payload) => {
  if (!SCORES_URL || !SCORES_SECRET) return { esito: "skipped" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCORES_TIMEOUT_MS);
  if (timeout.unref) timeout.unref();

  try {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const path = new URL(SCORES_URL).pathname;
    const firma = crypto.createHmac("sha256", SCORES_SECRET)
      .update(`${timestamp}\nPOST\n${path}\n${body}`)
      .digest("hex");

    const risposta = await fetch(SCORES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HG-Timestamp": String(timestamp),
        "X-HG-Signature": firma
      },
      body,
      signal: controller.signal
    });

    if (risposta.ok) {
      let corpo = null;
      try { corpo = await risposta.json(); } catch { corpo = null; }
      const duplicato = !!corpo && (corpo.stato === "duplicato" || corpo.duplicate === true);
      return { esito: duplicato ? "duplicate" : "saved" };
    }

    let codice = "";
    try {
      const corpo = await risposta.json();
      codice = corpo && corpo.codice ? String(corpo.codice).slice(0, 64) : "";
    } catch { codice = ""; }
    return { esito: "error", messaggio: `HTTP ${risposta.status}${codice ? " " + codice : ""}` };
  } catch (errore) {
    return { esito: "error", messaggio: (errore && errore.message) || "errore di rete" };
  } finally {
    clearTimeout(timeout);
  }
};

// Invio idempotente: il plugin riconosce resultId gia' presente e risponde
// "duplicate", che per noi equivale a un salvataggio riuscito.
const inviaRisultatoClassifica = async (roomId, result, tentativo) => {
  if (!SCORES_URL || !SCORES_SECRET) {
    notificaSalvataggio(roomId, result.resultId, "skipped", "Classifiche non configurate");
    return;
  }

  const outcomes = Array.isArray(result.outcomes)
    ? result.outcomes.slice(0, 16).map((o) => ({
      player: String((o && o.name) || "Player").slice(0, 64),
      esito: ESITI_CLASSIFICA[o && o.outcome] || "sconfitta"
    }))
    : [];

  const esito = await inviaFirmata({
    resultId: result.resultId,
    roomId: result.roomId,
    game: result.game,
    mode: "multi",
    winner: typeof result.winner === "string" ? result.winner : "",
    matchSeq: result.matchSeq,
    startedAt: dataIsoClassifica(result.startedAt),
    durationSec: result.durationSec,
    survivors: result.survivors,
    infected: result.infected,
    outcomes
  });

  if (esito.esito === "saved" || esito.esito === "duplicate") {
    notificaSalvataggio(roomId, result.resultId, "saved");
    return;
  }

  if (tentativo < SCORES_MAX_TENTATIVI) {
    const attesa = setTimeout(() => {
      inviaRisultatoClassifica(roomId, result, tentativo + 1);
    }, tentativo * 2500);
    if (attesa.unref) attesa.unref();
    return;
  }

  console.warn(`[SCORES] Invio non riuscito dopo ${SCORES_MAX_TENTATIVI} tentativi: ${esito.messaggio}`);
  notificaSalvataggio(roomId, result.resultId, "error");
};

// ---- Risultati del giocatore singolo -----------------------------------
// Il client non possiede il segreto HMAC: nessun segreto deve stare nel
// browser o nel pacchetto Android. La rotta /solo-result valida il
// risultato, applica limiti antiabuso e lo inoltra firmato al plugin
// WordPress. Se le classifiche non sono configurate risponde "skipped" e il
// gioco resta identico (punteggio locale e storico Firebase invariati).

const SOLO_MAX_BYTES = 8192;
const SOLO_LETTURA_MS = 5000;
const SOLO_MAX_PER_ORA = 30;
const SOLO_FINESTRA_MS = 60 * 60 * 1000;
const SOLO_MAX_DURATA_SEC = 86400;
const SOLO_ANTICIPO_MS = 5 * 60 * 1000;
const SOLO_ETA_MAX_MS = 24 * 60 * 60 * 1000;
const SOLO_MAX_CONTATORI = 20000;
const soloContatori = new Map();

const origineConsentita = (req) => {
  const origine = req.headers.origin;
  return !origine || ALLOWED_ORIGINS.includes(origine);
};

const intestazioniCors = (req) => {
  const intestazioni = {
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600"
  };
  const origine = req.headers.origin;
  if (origine && ALLOWED_ORIGINS.includes(origine)) {
    intestazioni["Access-Control-Allow-Origin"] = origine;
  }
  return intestazioni;
};

const rispondiJson = (res, stato, dati, req, extra) => {
  if (res.headersSent) return;
  const corpo = JSON.stringify(dati);
  res.writeHead(stato, {
    ...intestazioniCors(req),
    ...(extra || {}),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(corpo),
    "X-Content-Type-Options": "nosniff"
  });
  res.end(corpo);
};

const ipRichiesta = (req) => {
  const inoltro = req.headers["x-forwarded-for"];
  const primo = typeof inoltro === "string" ? inoltro.split(",")[0].trim() : "";
  const ip = primo || (req.socket && req.socket.remoteAddress) || "sconosciuto";
  return ip.slice(0, 64);
};

// Finestra scorrevole in memoria, come le stanze: si azzera a ogni riavvio.
const soloRateConsentito = (req) => {
  const adesso = Date.now();
  if (soloContatori.size > SOLO_MAX_CONTATORI) {
    for (const [chiave, voce] of soloContatori) {
      if (adesso - voce.inizio >= SOLO_FINESTRA_MS) soloContatori.delete(chiave);
    }
  }
  const ip = ipRichiesta(req);
  let voce = soloContatori.get(ip);
  if (!voce || adesso - voce.inizio >= SOLO_FINESTRA_MS) {
    voce = { inizio: adesso, conteggio: 0 };
    soloContatori.set(ip, voce);
  }
  voce.conteggio += 1;
  return voce.conteggio <= SOLO_MAX_PER_ORA;
};

const leggiCorpo = (req) => new Promise((risolvi, rifiuta) => {
  const pezzi = [];
  let totale = 0;
  let concluso = false;
  const chiudi = (errore, esito) => {
    if (concluso) return;
    concluso = true;
    clearTimeout(timer);
    if (errore) rifiuta(errore);
    else risolvi(esito);
  };
  const timer = setTimeout(
    () => chiudi(Object.assign(new Error("timeout"), { codiceHttp: 408 })),
    SOLO_LETTURA_MS
  );
  if (timer.unref) timer.unref();
  req.on("data", (pezzo) => {
    if (concluso) return;
    totale += pezzo.length;
    if (totale > SOLO_MAX_BYTES) {
      chiudi(Object.assign(new Error("corpo troppo grande"), { codiceHttp: 413 }));
      return;
    }
    pezzi.push(pezzo);
  });
  req.on("end", () => chiudi(null, Buffer.concat(pezzi).toString("utf8")));
  req.on("error", (errore) => chiudi(Object.assign(errore, { codiceHttp: 400 })));
});

const avvioRisultatoSolo = (valore) => {
  if (typeof valore === "number" && Number.isFinite(valore)) return Math.round(valore);
  if (typeof valore === "string" && valore.trim()) {
    const ms = Date.parse(valore);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
};

const gestisciRisultatoSolo = async (req, res) => {
  try {
    if (!origineConsentita(req)) {
      rispondiJson(res, 403, { esito: "error", codice: "origine_non_ammessa" }, req);
      return;
    }
    const tipo = String(req.headers["content-type"] || "").toLowerCase();
    if (!tipo.startsWith("application/json")) {
      rispondiJson(res, 415, { esito: "error", codice: "formato_non_supportato" }, req);
      return;
    }
    if (!soloRateConsentito(req)) {
      rispondiJson(res, 429, { esito: "error", codice: "troppi_invii" }, req, { "Retry-After": "600" });
      return;
    }

    let dati = null;
    try {
      dati = JSON.parse(await leggiCorpo(req));
    } catch (errore) {
      const stato = errore && errore.codiceHttp ? errore.codiceHttp : 400;
      const codice = stato === 413 ? "corpo_troppo_grande"
        : (stato === 408 ? "timeout" : "json_non_valido");
      rispondiJson(res, stato, { esito: "error", codice }, req);
      return;
    }
    if (!dati || typeof dati !== "object" || Array.isArray(dati)) {
      rispondiJson(res, 400, { esito: "error", codice: "payload_non_valido" }, req);
      return;
    }

    const nomeGrezzo = typeof dati.playerName === "string" ? dati.playerName.trim() : "";
    if (!nomeGrezzo) {
      rispondiJson(res, 400, { esito: "error", codice: "nome_mancante" }, req);
      return;
    }
    const nome = cleanName(nomeGrezzo);

    const durata = Number.isInteger(dati.durationSec) ? dati.durationSec : null;
    if (durata === null || durata < 0 || durata > SOLO_MAX_DURATA_SEC) {
      rispondiJson(res, 400, { esito: "error", codice: "durata_non_valida" }, req);
      return;
    }
    const botCount = Number.isInteger(dati.botCount) ? dati.botCount : 0;
    if (botCount < 0 || botCount > 64) {
      rispondiJson(res, 400, { esito: "error", codice: "bot_non_validi" }, req);
      return;
    }
    const esitoPartita = dati.esito === "vittoria" ? "vittoria"
      : (dati.esito === "sconfitta" ? "sconfitta" : null);
    if (esitoPartita === null) {
      rispondiJson(res, 400, { esito: "error", codice: "esito_non_valido" }, req);
      return;
    }

    const avvio = avvioRisultatoSolo(dati.startedAt);
    const adesso = Date.now();
    if (avvio === null || avvio > adesso + SOLO_ANTICIPO_MS || avvio < adesso - SOLO_ETA_MAX_MS) {
      rispondiJson(res, 400, { esito: "error", codice: "avvio_non_valido" }, req);
      return;
    }
    if (durata * 1000 > (adesso - avvio) + 120000) {
      rispondiJson(res, 400, { esito: "error", codice: "durata_incoerente" }, req);
      return;
    }

    // resultId derivato da nome e avvio: un invio ripetuto resta idempotente
    // e non crea righe doppie nella classifica.
    const impronta = crypto.createHash("sha256").update(nome.toLowerCase()).digest("hex").slice(0, 16);
    const resultId = "solo:" + impronta + ":" + avvio;

    const esito = await inviaFirmata({
      resultId: resultId,
      roomId: "solo",
      game: "virus-0",
      mode: "solo",
      winner: esitoPartita === "vittoria" ? nome : "",
      matchSeq: 0,
      startedAt: dataIsoClassifica(avvio),
      durationSec: durata,
      survivors: esitoPartita === "vittoria" ? 1 : 0,
      infected: esitoPartita === "sconfitta" ? 1 : 0,
      outcomes: [{
        player: nome,
        esito: esitoPartita,
        score: durata,
        metrics: { botCount: botCount }
      }]
    });

    if (esito.esito === "error") {
      console.warn("[SCORES] Risultato singolo non salvato: " + (esito.messaggio || "errore"));
      rispondiJson(res, 502, { esito: "error", codice: "classifica_non_disponibile" }, req);
      return;
    }
    rispondiJson(res, 200, { esito: esito.esito, resultId: resultId }, req);
  } catch (errore) {
    console.warn("[SCORES] Errore nella rotta solo-result: " + ((errore && errore.message) || "sconosciuto"));
    rispondiJson(res, 500, { esito: "error", codice: "errore_interno" }, req);
  }
};

// Calcolo autoritativo dell'esito: un solo evento v2_result per partita.
const concludiPartita = (room) => {
  if (!room.started || room.finished) return null;
  if (Date.now() - (room.startedAt || 0) < MATCH_START_GRACE_MS) return null;
  const chiavi = Object.keys(room.participants);
  if (chiavi.length === 0) return null;

  // Una caduta di rete non e' un'infezione: chi resta nella stanza durante la
  // finestra di rientro continua a far parte della partita. Conta come fuori
  // solo chi ha abbandonato davvero (uscita esplicita o tempo scaduto).
  const superstiti = chiavi.filter((k) => {
    const partecipante = room.participants[k];
    if (partecipante && partecipante.abbandonato) return false;
    return !room.infectedKeys.has(k);
  });

  // La partita continua finche' restano almeno due giocatori in gioco.
  if (superstiti.length > 1) return null;
  // Una stanza avviata con un solo partecipante non termina con una vittoria
  // automatica: si chiude soltanto se non resta nessun sano.
  if (superstiti.length === 1 && chiavi.length < 2) return null;

  room.finished = true;
  const startedAt = room.startedAt || Date.now();
  const vincitoreKey = superstiti.length === 1 ? superstiti[0] : null;

  const outcomes = chiavi.map((k) => {
    const partecipante = room.participants[k] || {};
    const p = room.players[k];
    let outcome = "DEFEAT";
    if (room.infectedKeys.has(k)) outcome = "INFECTED";
    else if (partecipante.abbandonato || !p) outcome = "DISCONNECTED";
    else if (k === vincitoreKey) outcome = "VICTORY";
    return {
      id: (p && p.id) || partecipante.id || k,
      name: (p && p.name) || partecipante.name || "Player",
      outcome
    };
  });

  const nomeVincitore = vincitoreKey
    ? ((room.players[vincitoreKey] && room.players[vincitoreKey].name)
      || (room.participants[vincitoreKey] && room.participants[vincitoreKey].name)
      || null)
    : null;

  const result = {
    resultId: `${room.id}:${startedAt}`,
    roomId: room.id,
    game: "virus-0",
    mode: "multiplayer",
    winner: nomeVincitore,
    matchSeq: room.matchSeq,
    startedAt,
    durationSec: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
    survivors: superstiti.length,
    infected: chiavi.filter((k) => room.infectedKeys.has(k)).length,
    outcomes,
    saveStatus: "pending"
  };

  room.result = result;
  room.resultId = result.resultId;
  io.to(room.id).emit("v2_result", result);
  console.log(`[RESULT] Stanza ${room.id} partita ${room.matchSeq}: superstiti ${result.survivors}, vincitore ${result.winner || "nessuno"}`);
  inviaRisultatoClassifica(room.id, result, 1);
  return result;
};

console.log(`[START] Server avviato sulla porta ${PORT}`);

const closeRoom = (roomId, reason = "closed") => {
  const room = rooms[roomId];
  if (!room) return;

  const socketIds = Object.keys(room.players).map((k) => room.players[k].id);
  for (const key of Object.keys(room.players)) {
    const p = room.players[key];
    if (p.timer) { clearTimeout(p.timer); p.timer = null; }
  }

  io.to(roomId).emit("room_closed", { roomId, reason });

  socketIds.forEach((sid) => {
    const s = io.sockets.sockets.get(sid);
    if (!s) return;
    s.leave(roomId);
    if (s.data.currentRoomId === roomId) {
      s.data.currentRoomId = null;
    }
  });

  delete rooms[roomId];
};

// Rimozione definitiva: esce dal gioco, scade il tempo di rientro o l'host chiude.
const removePlayer = (roomId, key, reason = "left", notify = true) => {
  const room = rooms[roomId];
  const player = room && room.players[key];
  if (!room || !player) return;

  if (player.timer) { clearTimeout(player.timer); player.timer = null; }

  // L'uscita definitiva va registrata prima di eliminare il giocatore: cosi'
  // l'esito distingue un abbandono reale da una semplice caduta di rete.
  const partecipante = room.participants && room.participants[key];
  if (partecipante) {
    partecipante.abbandonato = true;
    partecipante.abbandonatoIl = Date.now();
  }

  delete room.players[key];
  delete room.states[key];

  const s = io.sockets.sockets.get(player.id);
  if (s) {
    s.leave(roomId);
    if (s.data.currentRoomId === roomId) s.data.currentRoomId = null;
  }

  // L'host che esce chiude la stanza: e' il comportamento storico, invariato.
  if (key === room.hostKey) {
    closeRoom(roomId, reason === "timeout" ? "host_timeout" : "host_left");
    return;
  }

  if (notify) io.to(roomId).emit("player_left", { playerId: player.id });

  // Un giocatore che non rientra lascia la partita: se ne resta uno solo,
  // il server chiude comunque l'esito con un unico risultato.
  if (room.started && !room.finished) concludiPartita(room);

  if (Object.keys(room.players).length === 0) {
    delete rooms[roomId];
  }
};

const leaveRoom = (socket, roomId) => {
  const targetRoomId = roomId || socket.data.currentRoomId;
  if (!targetRoomId) return;

  const room = rooms[targetRoomId];
  const key = socket.data.playerKey;
  const player = room && key ? room.players[key] : null;

  if (room && player && player.id === socket.id) {
    removePlayer(targetRoomId, key, "left", true);
    return;
  }

  socket.leave(targetRoomId);
  if (socket.data.currentRoomId === targetRoomId) {
    socket.data.currentRoomId = null;
  }
};

// Antispam: finestra di un secondo per socket. Oltre il doppio del limite la
// connessione viene chiusa, cosi' un client impazzito non occupa la stanza.
const rateOk = (socket) => {
  const now = Date.now();
  const w = socket.data.txWindow;
  if (!w || now - w.start >= RATE_WINDOW_MS) {
    socket.data.txWindow = { start: now, count: 1 };
    return true;
  }
  w.count++;
  if (w.count <= MAX_STATE_PER_WINDOW) return true;

  socket.data.abuso = (socket.data.abuso || 0) + 1;
  if (socket.data.abuso === MAX_ABUSE) {
    socket.emit("room_error", { code: "rate_limited", message: "Troppi aggiornamenti: rallenta." });
  }
  if (socket.data.abuso > MAX_ABUSE * 2) {
    socket.disconnect(true);
  }
  return false;
};

io.on("connection", (socket) => {
  socket.data.currentRoomId = null;
  socket.data.playerKey = null;
  console.log(`[CONN] ${socket.id}`);

  socket.on("get_rooms", () => {
    const activeRooms = Object.keys(rooms).map((id) => ({
      id,
      playerCount: Object.values(rooms[id].players).filter((p) => p.connected !== false).length
    }));
    socket.emit("rooms_list", activeRooms);
  });

  socket.on("v2_hello", (data) => {
    const roomId = data?.roomId;
    if (!validRoomId(roomId)) {
      socket.emit("room_error", { code: "invalid_room", message: "Identificativo stanza non valido." });
      return;
    }
    const name = cleanName(data?.name);
    // I client vecchi non mandano la chiave: restano identificati dal socket.
    const key = validPlayerKey(data?.playerKey) ? data.playerKey : socket.id;

    const stanzaEsistente = rooms[roomId];
    const giocatoreEsistente = stanzaEsistente ? stanzaEsistente.players[key] : null;

    if (stanzaEsistente && !giocatoreEsistente && Object.keys(stanzaEsistente.players).length >= MAX_PLAYERS) {
      socket.emit("room_error", { code: "room_full", message: "La stanza e' piena." });
      return;
    }
    if (!stanzaEsistente && Object.keys(rooms).length >= MAX_ROOMS) {
      socket.emit("room_error", { code: "server_full", message: "Troppe stanze attive, riprova tra poco." });
      return;
    }

    if (socket.data.currentRoomId && socket.data.currentRoomId !== roomId) {
      leaveRoom(socket, socket.data.currentRoomId);
    }

    socket.join(roomId);
    socket.data.currentRoomId = roomId;
    socket.data.playerKey = key;

    let room = rooms[roomId];
    if (!room) {
      room = rooms[roomId] = {
        id: roomId,
        hostKey: key,
        players: Object.create(null),
        states: Object.create(null),
        world: null,
        started: false,
        startedAt: 0,
        matchSeq: 0,
        participants: Object.create(null),
        finished: false,
        result: null,
        resultId: null,
        resultSaved: null,
        hostInfections: new Set(),
        infectedKeys: new Set()
      };
    }
    if (Object.keys(room.players).length === 0) {
      room.hostKey = key;
    }

    const vecchioId = giocatoreEsistente ? giocatoreEsistente.id : null;
    const rientro = !!giocatoreEsistente
      && (giocatoreEsistente.connected === false || vecchioId !== socket.id);

    if (giocatoreEsistente && giocatoreEsistente.timer) {
      clearTimeout(giocatoreEsistente.timer);
      giocatoreEsistente.timer = null;
    }

    room.players[key] = giocatoreEsistente
      ? { ...giocatoreEsistente, id: socket.id, name: name || giocatoreEsistente.name, connected: true, isHost: key === room.hostKey, lastSeen: Date.now() }
      : { key, id: socket.id, name: name || "Player", connected: true, isHost: key === room.hostKey, lastSeen: Date.now() };

    // Chi entra a partita iniziata partecipa ufficialmente all'esito.
    if (room.started && !room.finished && !room.participants[key]) {
      room.participants[key] = { id: socket.id, name: room.players[key].name };
    }

    const isHost = key === room.hostKey;

    // Se la stessa chiave arriva da un secondo socket, il vecchio non conta piu'.
    if (vecchioId && vecchioId !== socket.id) {
      const vecchio = io.sockets.sockets.get(vecchioId);
      if (vecchio) {
        vecchio.leave(roomId);
        if (vecchio.data.currentRoomId === roomId) vecchio.data.currentRoomId = null;
      }
      socket.to(roomId).emit("player_left", { playerId: vecchioId });
    }

    socket.emit("v2_welcome", {
      isHost,
      myAssignedId: socket.id,
      hostId: roomHostId(room),
      players: playerList(room),
      playerKey: key
    });

    if (rientro) {
      socket.to(roomId).emit("v2_player_joined", {
        id: socket.id,
        name: room.players[key].name,
        isHost
      });
      if (isHost) {
        socket.to(roomId).emit("v2_host", { hostId: socket.id, players: playerList(room) });
      }

      // Ripristino: ultimo stato del giocatore e ultimo mondo dell'host.
      const stato = room.states[key];
      socket.emit("v2_snapshot", {
        roomId,
        started: room.started,
        startedAt: room.startedAt,
        matchSeq: room.matchSeq,
        finished: room.finished,
        result: room.result,
        hostInfections: infectionIdsFor(room),
        hostId: roomHostId(room),
        players: playerList(room),
        you: { key, id: socket.id, name: room.players[key].name },
        player: stato
          ? { ...stato.player, state: room.infectedKeys.has(key) ? "INFECTED" : stato.player.state }
          : (room.infectedKeys.has(key) ? { state: "INFECTED" } : null),
        world: room.world
      });
    } else if (!giocatoreEsistente) {
      socket.to(roomId).emit("v2_player_joined", room.players[key]);
    }
  });

  socket.on("v2_state", (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return;

    const roomId = data?.roomId;
    const key = socket.data.playerKey;
    // Si aggiorna solo la stanza in cui si e' entrati, non una qualsiasi.
    if (!validRoomId(roomId) || socket.data.currentRoomId !== roomId) return;

    const room = rooms[roomId];
    const player = room && key ? room.players[key] : null;
    if (!player || player.id !== socket.id || player.connected === false) return;
    // Una partita nuova ha una sequenza nuova: i pacchetti rimasti in coda
    // dalla partita precedente non possono infettare la nuova.
    if (room.started && typeof data.matchSeq === "number" && data.matchSeq !== room.matchSeq) return;
    if (typeof data.type !== "string" || data.type.length > 40) return;
    if (!rateOk(socket)) return;

    // Un pacchetto di stato ragionevole resta sotto i 24 KB: oltre e' spam o errore.
    let serializzato = "";
    try { serializzato = JSON.stringify(data); } catch { return; }
    if (serializzato.length > MAX_STATE_BYTES) return;

    player.lastSeen = Date.now();

    if (data.type === "v2_collect_item") {
      // Solo chi raccoglie puo' annunciare la raccolta.
      if (data.id !== socket.id) return;
      // La raccolta arriva anche a chi l'ha fatta: il client la ignora se e' sua.
      io.to(roomId).emit("v2_state", { ...data, _from: socket.id });
      return;
    }

    if (data.player && typeof data.player === "object") {
      room.states[key] = {
        player: sanitizePlayer({ ...data.player, id: socket.id }),
        at: Date.now()
      };
    }

    const payload = { ...data, _from: socket.id };
    if (room.states[key]) payload.player = room.states[key].player;

    if (key === room.hostKey && data.isHostSync) {
      room.world = {
        bots: Array.isArray(data.bots) ? data.bots.slice(0, 32) : [],
        powerUps: Array.isArray(data.powerUps) ? data.powerUps.slice(0, 150) : [],
        events: Array.isArray(data.events) ? data.events.slice(0, 30) : [],
        hazards: Array.isArray(data.hazards) ? data.hazards.slice(0, 60) : [],
        at: Date.now()
      };
      // L'host e' l'unico arbitro delle infezioni: il server le rende
      // definitive e le rimanda a tutti, anche dopo una riconnessione.
      mergeHostInfections(room, data.hostInfections);
    } else {
      delete payload.isHostSync;
      delete payload.bots;
      delete payload.powerUps;
      delete payload.events;
      delete payload.hazards;
      // Solo l'host puo' dichiarare infezioni: un ospite non deve poter
      // infettare gli altri facendosi passare per l'arbitro.
      delete payload.hostInfections;
    }

    if (key === room.hostKey && data.isHostSync) {
      payload.hostInfections = infectionIdsFor(room);
    }

    socket.to(roomId).emit("v2_state", payload);

    // Dopo ogni aggiornamento del mondo si verifica se restano superstiti.
    // Il calcolo e' idempotente: un solo v2_result per partita.
    if (key === room.hostKey && data.isHostSync) {
      concludiPartita(room);
    }
  });

  socket.on("v2_start", (data) => {
    const roomId = data?.roomId || socket.data.currentRoomId;
    const room = roomId ? rooms[roomId] : null;
    if (!room || room.hostKey !== socket.data.playerKey) return;

    room.started = true;
    room.startedAt = Date.now();
    room.matchSeq = (room.matchSeq || 0) + 1;
    room.finished = false;
    room.result = null;
    room.resultId = null;
    room.resultSaved = null;
    room.states = Object.create(null);
    room.world = null;
    room.hostInfections = new Set();
    room.infectedKeys = new Set();
    room.participants = Object.create(null);
    for (const chiave of Object.keys(room.players)) {
      const p = room.players[chiave];
      if (p.connected === false) continue;
      room.participants[chiave] = { id: p.id, name: p.name };
    }

    console.log(`[GAME_START] Stanza ${roomId} partita ${room.matchSeq}`);
    io.to(roomId).emit("v2_start", {
      roomId,
      startedAt: room.startedAt,
      matchSeq: room.matchSeq,
      players: playerList(room)
    });
  });

  socket.on("v2_end", (data) => {
    // La fine partita e' decisa dal server: un client non puo' chiudere la
    // stanza degli altri. L'evento resta accettato per compatibilita' e
    // viene semplicemente registrato.
    const roomId = data?.roomId || socket.data.currentRoomId;
    if (roomId && rooms[roomId] && rooms[roomId].hostKey === socket.data.playerKey) {
      console.log(`[GAME_END] Stanza ${roomId}: richiesta ignorata, la stanza resta aperta`);
    }
  });

  socket.on("leave_room", (data) => {
    leaveRoom(socket, data?.roomId || socket.data.currentRoomId);
  });

  // Caduta di rete: il giocatore resta in stanza per il tempo di rientro.
  socket.on("disconnect", () => {
    const roomId = socket.data.currentRoomId;
    const key = socket.data.playerKey;
    const room = roomId && key ? rooms[roomId] : null;
    const player = room ? room.players[key] : null;
    if (!room || !player || player.id !== socket.id) return;

    player.connected = false;
    player.lastSeen = Date.now();
    socket.data.currentRoomId = null;

    io.to(roomId).emit("player_left", { playerId: player.id });

    player.timer = setTimeout(() => {
      const r = rooms[roomId];
      const p = r && r.players[key];
      if (!r || !p || p.connected) return;
      removePlayer(roomId, key, "timeout", false);
    }, RECONNECT_GRACE_MS);
    if (player.timer.unref) player.timer.unref();
  });
});

httpServer.listen(PORT, "0.0.0.0");

// Render invia SIGTERM a ogni riavvio o sospensione: chiudiamo le connessioni
// in modo ordinato invece di lasciare il processo appeso.
const spegni = (segnale) => {
  console.log(`[STOP] Ricevuto ${segnale}: chiusura del server`);
  io.close(() => httpServer.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", () => spegni("SIGTERM"));
process.on("SIGINT", () => spegni("SIGINT"));

