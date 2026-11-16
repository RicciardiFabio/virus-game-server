# virus-game-server

Server multiplayer di VIRUS-0 (Node.js + Socket.IO), usato dal gioco pubblicato su
https://websitedefault.it/game_viruszero/ e dalla pagina Gioca su hobby-game.it.

## Avvio locale

```bat
npm ci
npm start
```

Il server ascolta sulla porta indicata da `PORT` (default 8080) su `0.0.0.0`.

## Render

| Campo | Valore |
|---|---|
| Language | Node |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health check | `/health` |

Piano: Free (512 MB). Il servizio si sospende dopo circa 15 minuti senza traffico:
il primo accesso successivo puo' richiedere 30-60 secondi. I dati delle stanze
sono in memoria e si perdono a ogni riavvio.

## Configurazione

- `PORT`: porta di ascolto (impostata da Render).
- `CORS_ORIGINS`: elenco separato da virgole di origini autorizzate, se serve
  aggiungerne una senza modificare il codice.

Non sono richieste credenziali, database o servizi esterni.

## Verifica

```bat
curl https://<servizio>.onrender.com/health
```

La risposta contiene `ok`, numero di stanze attive e uptime del processo.
