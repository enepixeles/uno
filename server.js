const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || "*" },
  pingInterval: 25000,
  pingTimeout: 20000
});

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const COLORS = ["red", "blue", "yellow", "green"];
const SPECIALS = ["skip", "reverse", "draw2"];

// Prevenir caídas del proceso ante excepciones no controladas
process.on("uncaughtException", err => console.error("Error capturado:", err.message));
process.on("unhandledRejection", err => console.error("Rechazo capturado:", err));

// Servir estáticos tanto desde la raíz como desde /public
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname));

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/health", (_req, res) => res.json({ ok: true }));

// Obtener el callback de Socket.io de forma 100% segura
function getCb(...args) {
  for (let i = args.length - 1; i >= 0; i--) {
    if (typeof args[i] === "function") return args[i];
  }
  return () => {};
}

function makeDeck() {
  const deck = [];
  let id = 0;
  for (const color of COLORS) {
    deck.push({ id: `c${id++}`, color, value: "0" });
    for (let n = 1; n <= 9; n++) {
      deck.push({ id: `c${id++}`, color, value: String(n) });
      deck.push({ id: `c${id++}`, color, value: String(n) });
    }
    for (const value of SPECIALS) {
      deck.push({ id: `c${id++}`, color, value });
      deck.push({ id: `c${id++}`, color, value });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `c${id++}`, color: "wild", value: "wild" });
    deck.push({ id: `c${id++}`, color: "wild", value: "wild4" });
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[crypto.randomInt(chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function playerFor(room, socketId) {
  return room.players.findIndex(p => p && p.socketId === socketId);
}

function currentColor(room) {
  return room.chosenColor || room.discard[room.discard.length - 1].color;
}

function canPlay(card, room) {
  const top = room.discard[room.discard.length - 1];
  if (card.color === "wild") return true;
  return card.color === currentColor(room) || card.value === top.value;
}

function drawCards(room, playerIndex, amount) {
  const player = room.players[playerIndex];
  for (let i = 0; i < amount; i++) {
    if (room.deck.length === 0) {
      if (room.discard.length <= 1) break;
      const top = room.discard.pop();
      room.deck = shuffle(room.discard.splice(0));
      room.discard = [top];
    }
    const card = room.deck.pop();
    if (card) player.hand.push(card);
  }
}

function publicState(room, socketId) {
  const me = playerFor(room, socketId);
  return {
    code: room.code,
    status: room.status,
    players: room.players.map((p, i) => p ? ({
      name: p.name,
      count: p.hand.length,
      connected: Boolean(p.socketId),
      ready: p.ready,
      isMe: i === me
    }) : null),
    myHand: me >= 0 ? room.players[me].hand : [],
    discard: room.discard,
    deckCount: room.deck.length,
    turn: room.turn,
    direction: room.direction,
    activeColor: room.discard.length ? currentColor(room) : null,
    unoPending: room.unoPending,
    notice: room.notice,
    winner: room.winner,
    drawnFor: room.drawnFor === me ? me : null,
    drawnCardId: room.drawnFor === me ? room.drawnCardId : null,
    challenge: room.challenge ? {
      challenger: room.challenge.challenger,
      offender: room.challenge.offender,
      target: room.challenge.target,
      expiresAt: room.challenge.expiresAt
    } : null,
    canChallenge: Boolean(room.challenge && room.challenge.target === me),
    canCatchUno: Boolean(room.unoPending && room.unoPending.player !== me && room.unoPending.expiresAt > Date.now()),
    myTurn: room.status === "playing" && room.turn === me && !room.challenge
  };
}

function emitRoom(room) {
  for (const p of room.players) {
    if (p && p.socketId) io.to(p.socketId).emit("state", publicState(room, p.socketId));
  }
}

function nextPlayer(index) { return index === 0 ? 1 : 0; }

function startGame(room) {
  const deck = shuffle(makeDeck());
  room.players.forEach(p => { p.hand = []; p.ready = false; });
  for (let n = 0; n < 7; n++) room.players.forEach(p => p.hand.push(deck.pop()));
  
  // Garantizar que la primera carta sea un número regular
  let first = deck.pop();
  while (first && (first.color === "wild" || SPECIALS.includes(first.value))) {
    deck.unshift(first);
    first = deck.pop();
  }
  
  room.deck = deck;
  room.discard = [first];
  room.turn = crypto.randomInt(2);
  room.direction = 1;
  room.chosenColor = null;
  room.status = "playing";
  room.winner = null;
  room.unoPending = null;
  room.challenge = null;
  room.drawnFor = null;
  room.drawnCardId = null;
  room.notice = `¡Comienza ${room.players[room.turn].name}!`;
  emitRoom(room);
}

function finishIfWon(room, playerIndex) {
  if (room.players[playerIndex].hand.length === 0) {
    room.status = "finished";
    room.winner = playerIndex;
    room.notice = `¡${room.players[playerIndex].name} ganó la partida!`;
    room.unoPending = null;
    room.challenge = null;
    return true;
  }
  return false;
}

function beginNextTurn(room, playerIndex) {
  room.turn = playerIndex;
  room.unoPending = null;
  room.challenge = null;
}

function playCard(room, playerIndex, cardId, chosenColor) {
  const player = room.players[playerIndex];
  const cardIndex = player.hand.findIndex(c => c.id === cardId);
  if (cardIndex < 0) return { error: "Esa carta no está en tu mano." };
  const card = player.hand[cardIndex];
  
  if (room.drawnFor === playerIndex && room.drawnCardId !== cardId) {
    return { error: "Solo puedes jugar la carta que acabas de robar (o pasar turno)." };
  }
  if (!canPlay(card, room)) return { error: "Esa carta no se puede jugar ahora." };
  if (card.color === "wild" && !COLORS.includes(chosenColor)) {
    return { error: "Elige un color para el comodín." };
  }

  const prevColor = currentColor(room);
  player.hand.splice(cardIndex, 1);
  room.drawnFor = null;
  room.drawnCardId = null;
  room.discard.push(card);
  room.chosenColor = card.color === "wild" ? chosenColor : null;
  room.unoPending = player.hand.length === 1
    ? { player: playerIndex, expiresAt: Date.now() + 7000 }
    : null;

  if (card.value === "wild4") {
    room.challenge = {
      offender: playerIndex,
      target: nextPlayer(playerIndex),
      hadColor: player.hand.some(c => c.color === prevColor),
      expiresAt: Date.now() + 15000
    };
    room.notice = `${player.name} jugó +4. Puedes aceptarlo o desafiarlo.`;
    return { ok: true };
  }

  if (finishIfWon(room, playerIndex)) return { ok: true };

  const opponent = nextPlayer(playerIndex);
  if (card.value === "skip" || card.value === "reverse") {
    room.turn = playerIndex;
    room.notice = `${card.value === "skip" ? "Salto" : "Reversa"}: ${player.name} vuelve a jugar.`;
  } else if (card.value === "draw2") {
    drawCards(room, opponent, 2);
    room.turn = playerIndex;
    room.notice = `${room.players[opponent].name} roba 2 y pierde su turno.`;
  } else {
    room.turn = opponent;
    room.notice = `Turno de ${room.players[opponent].name}.`;
  }
  return { ok: true };
}

function scheduleRoomCleanup(room) {
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    if (room.players.every(p => !p || !p.socketId)) {
      rooms.delete(room.code);
    }
  }, 120000);
}

io.on("connection", socket => {
  socket.on("createRoom", (data, ...rest) => {
    const cb = getCb(data, ...rest);
    const code = roomCode();
    const token = crypto.randomUUID();
    const name = data && data.name ? data.name : "Papá";
    const room = {
      code, status: "waiting", players: [
        { socketId: socket.id, token, name: String(name).slice(0, 18), hand: [], ready: true },
        null
      ],
      deck: [], discard: [], turn: 0, direction: 1, chosenColor: null,
      unoPending: null, challenge: null, winner: null, notice: "Esperando al segundo jugador…"
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.token = token;
    cb({ ok: true, code, token });
    emitRoom(room);
  });

  socket.on("joinRoom", (data, ...rest) => {
    const cb = getCb(data, ...rest);
    const cleanCode = String(data?.code || "").toUpperCase().trim();
    const room = rooms.get(cleanCode);
    if (!room) return cb({ ok: false, error: "No encontramos esa sala. Revisa el código." });
    if (room.players[1] && room.players[1].socketId) return cb({ ok: false, error: "La sala ya está llena." });
    if (room.status === "playing" || room.status === "finished") return cb({ ok: false, error: "La partida ya comenzó." });

    const slot = room.players[0] && room.players[0].socketId ? 1 : 0;
    const token = crypto.randomUUID();
    const name = data && data.name ? data.name : "Hijo";
    room.players[slot] = { socketId: socket.id, token, name: String(name).slice(0, 18), hand: [], ready: true };
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.token = token;
    cb({ ok: true, code: room.code, token });

    if (room.players.every(Boolean)) startGame(room);
    else emitRoom(room);
  });

  socket.on("reconnectPlayer", (data, ...rest) => {
    const cb = getCb(data, ...rest);
    const room = rooms.get(String(data?.code || "").toUpperCase().trim());
    if (!room) return cb({ ok: false, error: "La sala expiró." });
    const slot = room.players.findIndex(p => p && p.token === data?.token);
    if (slot < 0) return cb({ ok: false, error: "Sesión no válida." });

    room.players[slot].socketId = socket.id;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.token = data.token;
    room.notice = `${room.players[slot].name} se reconectó a la mesa.`;
    cb({ ok: true, code: room.code });
    emitRoom(room);
  });

  socket.on("playCard", (data, ...rest) => {
    const cb = getCb(data, ...rest);
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb({ ok: false, error: "La sala ya no existe." });
    const me = playerFor(room, socket.id);
    if (me < 0 || room.status !== "playing" || room.turn !== me || room.challenge) {
      return cb({ ok: false, error: "No es tu turno." });
    }
    const result = playCard(room, me, data?.cardId, data?.color);
    cb(result);
    if (result.ok) emitRoom(room);
  });

  socket.on("drawCard", (...args) => {
    const cb = getCb(...args);
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb({ ok: false, error: "Sala no disponible." });
    const me = playerFor(room, socket.id);
    if (me < 0 || room.status !== "playing" || room.turn !== me || room.challenge) {
      return cb({ ok: false, error: "No es tu turno para robar." });
    }
    if (room.drawnFor === me) return cb({ ok: false, error: "Ya robaste una carta este turno." });

    drawCards(room, me, 1);
    const card = room.players[me].hand[room.players[me].hand.length - 1];
    room.drawnCardId = card && card.id;
    room.drawnFor = me;
    room.notice = `${room.players[me].name} robó una carta.`;
    cb({ ok: true, card });
    emitRoom(room);
  });

  socket.on("passTurn", (...args) => {
    const cb = getCb(...args);
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb({ ok: false, error: "Sala no disponible." });
    const me = playerFor(room, socket.id);
    if (me !== room.turn || room.status !== "playing" || room.challenge) return cb({ ok: false, error: "No es tu turno." });
    if (room.drawnFor !== me) return cb({ ok: false, error: "Primero debes robar una carta antes de pasar." });

    room.drawnFor = null;
    room.drawnCardId = null;
    beginNextTurn(room, nextPlayer(me));
    room.notice = `Turno de ${room.players[room.turn].name}.`;
    cb({ ok: true });
    emitRoom(room);
  });

  socket.on("callUno", (...args) => {
    const cb = getCb(...args);
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb({ ok: false });
    const me = playerFor(room, socket.id);
    if (me < 0 || room.players[me].hand.length !== 1 || !room.unoPending || room.unoPending.player !== me) {
      return cb({ ok: false, error: "Solo puedes cantar UNO al quedarte con 1 carta." });
    }
    room.unoPending = null;
    room.notice = `¡${room.players[me].name} cantó ¡UNO! con éxito!`;
    cb({ ok: true });
    emitRoom(room);
  });

  socket.on("catchUno", (...args) => {
    const cb = getCb(...args);
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.unoPending) return cb({ ok: false, error: "Ya no puedes reclamar UNO." });
    const me = playerFor(room, socket.id);
    const pending = room.unoPending;
    if (me === pending.player || Date.now() > pending.expiresAt) return cb({ ok: false, error: "Tiempo agotado para pillar el UNO." });

    drawCards(room, pending.player, 2);
    room.unoPending = null;
    room.notice = `¡Pillado! ${room.players[pending.player].name} no dijo UNO y roba 2 cartas.`;
    cb({ ok: true });
    emitRoom(room);
  });

  socket.on("challengeWild4", (...args) => {
    const cb = getCb(...args);
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.challenge) return cb({ ok: false, error: "No hay un +4 para desafiar." });
    const me = playerFor(room, socket.id);
    const challenge = room.challenge;
    if (me !== challenge.target) return cb({ ok: false, error: "No puedes responder a esta jugada." });

    if (challenge.hadColor) {
      drawCards(room, challenge.offender, 4);
      room.turn = challenge.target;
      room.notice = `¡Desafío exitoso! ${room.players[challenge.offender].name} tenía el color y roba 4 cartas.`;
    } else {
      drawCards(room, challenge.target, 6);
      room.turn = challenge.offender;
      room.notice = `Desafío fallido: ${room.players[challenge.target].name} roba 6 cartas y pierde el turno.`;
      if (room.players[challenge.offender].hand.length === 0) {
        room.status = "finished";
        room.winner = challenge.offender;
        room.notice = `¡${room.players[challenge.offender].name} ganó la partida!`;
      }
    }
    room.challenge = null;
    room.unoPending = null;
    cb({ ok: true });
    emitRoom(room);
  });

  socket.on("acceptWild4", (...args) => {
    const cb = getCb(...args);
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.challenge) return cb({ ok: false, error: "No hay un +4 pendiente." });
    const me = playerFor(room, socket.id);
    if (me !== room.challenge.target) return cb({ ok: false, error: "No puedes responder a esta jugada." });

    drawCards(room, me, 4);
    const offender = room.challenge.offender;
    room.turn = offender;
    room.challenge = null;
    room.unoPending = null;
    room.notice = `${room.players[me].name} acepta el +4 y roba 4 cartas.`;

    if (room.players[offender].hand.length === 0) {
      room.status = "finished";
      room.winner = offender;
      room.notice = `¡${room.players[offender].name} ganó la partida!`;
    }
    cb({ ok: true });
    emitRoom(room);
  });

  socket.on("newGame", (...args) => {
    const cb = getCb(...args);
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb({ ok: false, error: "Sala no disponible." });
    if (!room.players.every(p => p && p.socketId)) return cb({ ok: false, error: "Ambos jugadores deben estar conectados." });
    startGame(room);
    cb({ ok: true });
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    const me = playerFor(room, socket.id);
    if (me >= 0) {
      room.players[me].socketId = null;
      room.notice = `${room.players[me].name} se desconectó temporalmente.`;
      emitRoom(room);
    }
    scheduleRoomCleanup(room);
  });
});

server.listen(PORT, () => console.log(`UNO Online funcionando en el puerto ${PORT}`));