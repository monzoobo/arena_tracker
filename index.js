const http = require("http");
const crypto = require("crypto");
const os = require("os");
const WebSocket = require("ws");
const { WebSocketServer } = WebSocket;

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_JOIN_BASE_URL = process.env.PUBLIC_JOIN_BASE_URL || "";
const PROTOCOL_JOIN_BASE_URL = "arena-tracker://skin-guess/join";

const rooms = new Map();
const clients = new Map();

function localNetworkAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === "IPv4" && !address.internal)
    .map((address) => address.address);
}

function serverInfo() {
  const addresses = HOST === "0.0.0.0" ? localNetworkAddresses() : [];
  const publicBaseUrl = PUBLIC_JOIN_BASE_URL.replace(/\/+$/, "");
  return {
    ok: true,
    service: "Arena Tracker Skin Guess Rooms",
    host: HOST,
    port: PORT,
    rooms: rooms.size,
    local: {
      http: `http://localhost:${PORT}`,
      websocket: `ws://localhost:${PORT}`,
      test: `http://localhost:${PORT}/test`
    },
    public: publicBaseUrl
      ? {
          http: publicBaseUrl,
          websocket: publicBaseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:"),
          test: `${publicBaseUrl}/test`
        }
      : null,
    lan: addresses.map((address) => ({
      address,
      http: `http://${address}:${PORT}`,
      websocket: `ws://${address}:${PORT}`,
      test: `http://${address}:${PORT}/test`
    }))
  };
}

function testPageHtml() {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Arena Tracker Server Test</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #090b10;
        color: #f4f7ff;
        font-family: system-ui, sans-serif;
      }
      main {
        width: min(680px, calc(100vw - 32px));
        border: 1px solid #263145;
        background: #111722;
        padding: 24px;
      }
      code, pre {
        background: #090d15;
        color: #f4b46a;
      }
      pre {
        white-space: pre-wrap;
        padding: 12px;
      }
      .ok { color: #75e0a7; }
      .bad { color: #ff6f8c; }
    </style>
  </head>
  <body>
    <main>
      <h1>Arena Tracker Server Test</h1>
      <p>HTTP: <strong class="ok">OK</strong></p>
      <p>WebSocket: <strong id="wsStatus">test en cours...</strong></p>
      <p>URL WebSocket testée: <code id="wsUrl"></code></p>
      <pre id="log"></pre>
    </main>
    <script>
      const log = document.querySelector("#log");
      const status = document.querySelector("#wsStatus");
      const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
      document.querySelector("#wsUrl").textContent = wsUrl;

      function write(message) {
        log.textContent += message + "\\n";
      }

      try {
        const socket = new WebSocket(wsUrl);
        socket.addEventListener("open", () => {
          write("WebSocket ouvert.");
          socket.send(JSON.stringify({ type: "ping" }));
        });
        socket.addEventListener("message", (event) => {
          write("Message reçu: " + event.data);
          const data = JSON.parse(event.data);
          if (data.type === "pong") {
            status.textContent = "OK";
            status.className = "ok";
            socket.close();
          }
        });
        socket.addEventListener("error", () => {
          status.textContent = "ERREUR";
          status.className = "bad";
          write("Erreur WebSocket.");
        });
      } catch (error) {
        status.textContent = "ERREUR";
        status.className = "bad";
        write(error.message || String(error));
      }
    </script>
  </body>
</html>`;
}

function send(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
}

function sendError(socket, code, message) {
  send(socket, {
    type: "error",
    code,
    message
  });
}

function normalizeRoomCode(roomCode) {
  return String(roomCode || "").trim().toUpperCase();
}

function validateRoomCode(roomCode) {
  const code = normalizeRoomCode(roomCode);
  if (code.length < 3 || code.length > 16) {
    return { ok: false, message: "Le code de room doit faire entre 3 et 16 caractères." };
  }

  if (!/^[A-Z0-9-]+$/.test(code)) {
    return { ok: false, message: "Le code de room accepte uniquement A-Z, 0-9 et tiret." };
  }

  return { ok: true, code };
}

function generateRoomCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = crypto.randomBytes(3).toString("hex").toUpperCase();
    if (!rooms.has(code)) {
      return code;
    }
  }

  throw new Error("Impossible de générer un code de room unique.");
}

function normalizePlayerName(playerName) {
  return String(playerName || "").trim().replace(/\s+/g, " ");
}

function validatePlayerName(playerName) {
  const name = normalizePlayerName(playerName);
  if (name.length < 1 || name.length > 24) {
    return { ok: false, message: "Le nom joueur doit faire entre 1 et 24 caractères." };
  }

  return { ok: true, name };
}

function normalizeRoomName(roomName) {
  const name = String(roomName || "").trim().replace(/\s+/g, " ");
  return name.slice(0, 48) || "Skin Guess";
}

function playerNameExists(room, playerName, ignoredPlayerId = "") {
  const normalized = normalizePlayerName(playerName).toLowerCase();
  return room.players.some((player) => player.id !== ignoredPlayerId && player.name.toLowerCase() === normalized);
}

function defaultRoomSettings() {
  return {
    questionCount: 0,
    timer: "off",
    gameMode: "",
    answerType: "",
    timeMode: "perImage",
    timeValue: "15",
    finishRule: "last"
  };
}

function joinLinkFor(roomCode) {
  const query = `room=${encodeURIComponent(roomCode)}`;
  return PUBLIC_JOIN_BASE_URL
    ? `${PUBLIC_JOIN_BASE_URL.replace(/[/?#]+$/, "")}/skin-guess/join?${query}`
    : `${PROTOCOL_JOIN_BASE_URL}?${query}`;
}

function publicRoomState(room, viewerPlayerId = null) {
  return {
    type: "roomState",
    status: room.status || "lobby",
    roomName: room.roomName,
    roomCode: room.roomCode,
    hostPlayerId: room.hostPlayerId,
    viewerPlayerId,
    settings: room.settings || defaultRoomSettings(),
    gameSeed: room.gameSeed || "",
    startedAt: room.startedAt || null,
    joinLink: room.joinLink,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.id === room.hostPlayerId,
      ready: player.ready === true,
      returnedToLobby: player.returnedToLobby === true
    })),
    createdAt: room.createdAt
  };
}

function broadcastRoomState(room) {
  for (const player of room.players) {
    send(player.socket, publicRoomState(room, player.id));
  }
}

function resetRoomForNextGame(room) {
  room.status = "lobby";
  room.startedAt = null;
  room.gameSeed = "";
  room.settings = defaultRoomSettings();
  for (const player of room.players) {
    player.ready = false;
    player.returnedToLobby = true;
  }
}

function resetRoomIfEveryoneReturned(room) {
  if (room.status !== "started" || room.players.length === 0) {
    return false;
  }

  if (!room.players.every((player) => player.returnedToLobby === true)) {
    return false;
  }

  resetRoomForNextGame(room);
  return true;
}

function leaveCurrentRoom(socket) {
  const client = clients.get(socket);
  if (!client?.roomCode) {
    return;
  }

  const room = rooms.get(client.roomCode);
  if (!room) {
    clients.set(socket, { ...client, roomCode: null, playerId: null });
    return;
  }

  room.players = room.players.filter((player) => player.id !== client.playerId);
  clients.set(socket, { ...client, roomCode: null, playerId: null });

  if (room.players.length === 0) {
    rooms.delete(room.roomCode);
    return;
  }

  if (room.hostPlayerId === client.playerId) {
    room.hostPlayerId = room.players[0].id;
  }

  resetRoomIfEveryoneReturned(room);
  broadcastRoomState(room);
}

function createPlayer(socket, playerName) {
  return {
    id: crypto.randomUUID(),
    name: playerName,
    ready: false,
    returnedToLobby: true,
    socket
  };
}

function createRoom(socket, payload) {
  const nameValidation = validatePlayerName(payload.playerName);
  if (!nameValidation.ok) {
    sendError(socket, "INVALID_PLAYER_NAME", nameValidation.message);
    return;
  }

  const roomCode = payload.roomCode
    ? normalizeRoomCode(payload.roomCode)
    : generateRoomCode();
  const codeValidation = validateRoomCode(roomCode);
  if (!codeValidation.ok) {
    sendError(socket, "INVALID_ROOM_CODE", codeValidation.message);
    return;
  }

  if (rooms.has(codeValidation.code)) {
    sendError(socket, "ROOM_CODE_EXISTS", "Ce code de room est déjà utilisé.");
    return;
  }

  leaveCurrentRoom(socket);

  const player = createPlayer(socket, nameValidation.name);
  const room = {
    roomName: normalizeRoomName(payload.roomName),
    roomCode: codeValidation.code,
    password: String(payload.password || ""),
    hostPlayerId: player.id,
    status: "lobby",
    settings: defaultRoomSettings(),
    gameSeed: "",
    startedAt: null,
    players: [player],
    createdAt: new Date().toISOString(),
    joinLink: joinLinkFor(codeValidation.code)
  };

  rooms.set(room.roomCode, room);
  clients.set(socket, {
    roomCode: room.roomCode,
    playerId: player.id
  });
  send(socket, publicRoomState(room, player.id));
}

function joinRoom(socket, payload) {
  const codeValidation = validateRoomCode(payload.roomCode);
  if (!codeValidation.ok) {
    sendError(socket, "INVALID_ROOM_CODE", codeValidation.message);
    return;
  }

  const nameValidation = validatePlayerName(payload.playerName);
  if (!nameValidation.ok) {
    sendError(socket, "INVALID_PLAYER_NAME", nameValidation.message);
    return;
  }

  const room = rooms.get(codeValidation.code);
  if (!room) {
    sendError(socket, "ROOM_NOT_FOUND", "Room introuvable.");
    return;
  }

  if (room.password && String(payload.password || "") !== room.password) {
    sendError(socket, "INVALID_PASSWORD", "Mot de passe incorrect.");
    return;
  }

  if (playerNameExists(room, nameValidation.name)) {
    sendError(socket, "PLAYER_NAME_EXISTS", "Ce nom est déjà utilisé dans la room.");
    return;
  }

  leaveCurrentRoom(socket);

  const player = createPlayer(socket, nameValidation.name);
  room.players.push(player);
  clients.set(socket, {
    roomCode: room.roomCode,
    playerId: player.id
  });
  broadcastRoomState(room);
}

function roomForSocket(socket) {
  const client = clients.get(socket);
  if (!client?.roomCode || !client?.playerId) {
    return { room: null, client: null };
  }

  return {
    room: rooms.get(client.roomCode) || null,
    client
  };
}

function requireRoom(socket) {
  const { room, client } = roomForSocket(socket);
  if (!room || !client) {
    sendError(socket, "NOT_IN_ROOM", "Tu n'es pas dans une room.");
    return null;
  }

  return { room, client };
}

function setReady(socket, payload) {
  const context = requireRoom(socket);
  if (!context) {
    return;
  }

  const player = context.room.players.find((entry) => entry.id === context.client.playerId);
  if (!player) {
    sendError(socket, "PLAYER_NOT_FOUND", "Joueur introuvable dans la room.");
    return;
  }

  player.ready = payload.ready === true;
  broadcastRoomState(context.room);
}

function renamePlayer(socket, payload) {
  const context = requireRoom(socket);
  if (!context) {
    return;
  }

  const nameValidation = validatePlayerName(payload.playerName);
  if (!nameValidation.ok) {
    sendError(socket, "INVALID_PLAYER_NAME", nameValidation.message);
    return;
  }

  if (playerNameExists(context.room, nameValidation.name, context.client.playerId)) {
    sendError(socket, "PLAYER_NAME_EXISTS", "Ce nom est dÃ©jÃ  utilisÃ© dans la room.");
    return;
  }

  const player = context.room.players.find((entry) => entry.id === context.client.playerId);
  if (!player) {
    sendError(socket, "PLAYER_NOT_FOUND", "Joueur introuvable dans la room.");
    return;
  }

  player.name = nameValidation.name;
  broadcastRoomState(context.room);
}

function returnToLobby(socket) {
  const context = requireRoom(socket);
  if (!context) {
    return;
  }

  const player = context.room.players.find((entry) => entry.id === context.client.playerId);
  if (!player) {
    sendError(socket, "PLAYER_NOT_FOUND", "Joueur introuvable dans la room.");
    return;
  }

  player.ready = false;
  player.returnedToLobby = true;
  resetRoomIfEveryoneReturned(context.room);
  broadcastRoomState(context.room);
}

function updateRoomSettings(socket, payload) {
  const context = requireRoom(socket);
  if (!context) {
    return;
  }

  if (context.room.hostPlayerId !== context.client.playerId) {
    sendError(socket, "HOST_ONLY", "Seul l'host peut modifier les options de room.");
    return;
  }

  const questionCount = Number.parseInt(payload.questionCount, 10);
  const gameMode = ["classic", "timed"].includes(payload.gameMode)
    ? payload.gameMode
    : context.room.settings.gameMode;
  const answerType = ["champion", "skinline", "complete"].includes(payload.answerType)
    ? payload.answerType
    : context.room.settings.answerType;
  const timeMode = ["total", "perImage"].includes(payload.timeMode)
    ? payload.timeMode
    : context.room.settings.timeMode;
  const finishRule = ["first", "last"].includes(payload.finishRule)
    ? payload.finishRule
    : context.room.settings.finishRule;
  const timeValue = String(payload.timeValue || context.room.settings.timeValue || "15").slice(0, 12);
  context.room.settings = {
    ...context.room.settings,
    questionCount: Number.isFinite(questionCount)
      ? Math.min(999, Math.max(0, questionCount))
      : context.room.settings.questionCount,
    gameMode,
    answerType,
    timeMode,
    timeValue,
    finishRule,
    timer: "off"
  };
  broadcastRoomState(context.room);
}

function kickPlayer(socket, payload) {
  const context = requireRoom(socket);
  if (!context) {
    return;
  }

  if (context.room.hostPlayerId !== context.client.playerId) {
    sendError(socket, "HOST_ONLY", "Seul l'host peut exclure un joueur.");
    return;
  }

  const playerId = String(payload.playerId || "");
  if (!playerId || playerId === context.room.hostPlayerId) {
    return;
  }

  const kicked = context.room.players.find((player) => player.id === playerId);
  context.room.players = context.room.players.filter((player) => player.id !== playerId);
  if (kicked) {
    clients.set(kicked.socket, { roomCode: null, playerId: null });
    sendError(kicked.socket, "KICKED", "Tu as ete retire de la room.");
    kicked.socket.close();
  }
  broadcastRoomState(context.room);
}

function startRoomGame(socket) {
  const context = requireRoom(socket);
  if (!context) {
    return;
  }

  if (context.room.hostPlayerId !== context.client.playerId) {
    sendError(socket, "HOST_ONLY", "Seul l'host peut lancer la partie.");
    return;
  }

  context.room.status = "started";
  context.room.startedAt = new Date().toISOString();
  context.room.gameSeed = crypto.randomBytes(16).toString("hex");
  for (const player of context.room.players) {
    player.ready = false;
    player.returnedToLobby = false;
  }
  broadcastRoomState(context.room);
}

function handleMessage(socket, rawMessage) {
  let message = null;
  try {
    message = JSON.parse(rawMessage);
  } catch (_error) {
    sendError(socket, "INVALID_JSON", "Message JSON invalide.");
    return;
  }

  const type = message.type || message.event;
  const payload = message.payload && typeof message.payload === "object"
    ? message.payload
    : message;

  if (type === "createRoom") {
    createRoom(socket, payload);
    return;
  }

  if (type === "joinRoom") {
    joinRoom(socket, payload);
    return;
  }

  if (type === "leaveRoom") {
    leaveCurrentRoom(socket);
    send(socket, { type: "roomState", roomName: "", roomCode: "", hostPlayerId: null, players: [], createdAt: null });
    return;
  }

  if (type === "setReady") {
    setReady(socket, payload);
    return;
  }

  if (type === "renamePlayer") {
    renamePlayer(socket, payload);
    return;
  }

  if (type === "returnToLobby") {
    returnToLobby(socket);
    return;
  }

  if (type === "updateRoomSettings") {
    updateRoomSettings(socket, payload);
    return;
  }

  if (type === "kickPlayer") {
    kickPlayer(socket, payload);
    return;
  }

  if (type === "startGame") {
    startRoomGame(socket);
    return;
  }

  if (type === "ping") {
    send(socket, {
      type: "pong",
      createdAt: new Date().toISOString()
    });
    return;
  }

  sendError(socket, "UNKNOWN_MESSAGE", `Message non supporté: ${type || "unknown"}.`);
}

const server = http.createServer((request, response) => {
  const requestPath = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname;
  if (requestPath === "/test" || requestPath === "/test/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(testPageHtml());
    return;
  }

  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(serverInfo(), null, 2));
});

const webSocketServer = new WebSocketServer({ server, maxPayload: 8192 });

webSocketServer.on("connection", (socket) => {
  clients.set(socket, { roomCode: null, playerId: null });

  socket.on("message", (rawMessage) => {
    handleMessage(socket, rawMessage.toString());
  });

  socket.on("close", () => {
    leaveCurrentRoom(socket);
    clients.delete(socket);
  });
});

server.listen(PORT, HOST, () => {
  const info = serverInfo();
  console.log(`Arena Tracker Skin Guess room server listening on ws://${HOST}:${PORT}`);
  console.log(`Local test: ${info.local.test}`);
  if (info.lan.length === 0) {
    console.log("No LAN IPv4 address detected.");
    return;
  }

  console.log("LAN test URLs to open from another PC:");
  for (const address of info.lan) {
    console.log(`- ${address.test}`);
  }
});
