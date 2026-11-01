const socket = io();
const $ = id => document.getElementById(id);
const screens = ["home", "lobby", "game"];
let state = null, roomCode = "", playerName = "", playerToken = "", soundOn = true;
let pendingWildCard = null, toastTimer = null, audioCtx = null;

const colorNames = { red: "Rojo", blue: "Azul", yellow: "Amarillo", green: "Verde" };
const symbol = value => ({ skip: "⊘", reverse: "↻", draw2: "+2", wild: "✦", wild4: "+4" }[value] || value);
const cardLabel = c => c.value.match(/^\d$/) ? c.value : symbol(c.value);

function showScreen(id) {
  screens.forEach(s => $(s).classList.toggle("hidden", s !== id));
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function error(message) {
  $("homeError").textContent = message || "";
}

function request(event, payload) {
  return new Promise(resolve => {
    const handleResponse = res => resolve(res || { ok: false, error: "Error de comunicación." });
    if (payload !== undefined) {
      socket.emit(event, payload, handleResponse);
    } else {
      socket.emit(event, handleResponse);
    }
  });
}

function beep(freq = 500, duration = 0.08) {
  if (!soundOn) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (_) {}
}

function setConnection(online) {
  $("connection").classList.toggle("online", online);
  $("connection").innerHTML = `<i></i> ${online ? "Conectado" : "Reconectando…"}`;
  $("connectionGame").textContent = online ? "● Conectado" : "● Reconectando…";
}

socket.on("connect", () => {
  setConnection(true);
  const savedCode = sessionStorage.getItem("uno_code");
  const savedToken = sessionStorage.getItem("uno_token");
  if (savedCode && savedToken) {
    socket.emit("reconnectPlayer", { code: savedCode, token: savedToken }, res => {
      if (res && res.ok) {
        roomCode = savedCode;
        playerToken = savedToken;
      }
    });
  }
});

socket.on("disconnect", () => setConnection(false));
socket.on("connect_error", () => setConnection(false));

window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get("room") || params.get("code");
  if (codeParam) {
    $("roomCode").value = codeParam.toUpperCase().slice(0, 5);
    toast("¡Código de sala cargado!");
  }
  const savedName = localStorage.getItem("uno_name");
  if (savedName) $("playerName").value = savedName;
});

$("createBtn").addEventListener("click", async () => {
  playerName = $("playerName").value.trim() || "Papá";
  localStorage.setItem("uno_name", playerName);
  const result = await request("createRoom", { name: playerName });
  if (!result.ok) return error(result.error);
  roomCode = result.code;
  playerToken = result.token;
  sessionStorage.setItem("uno_code", roomCode);
  sessionStorage.setItem("uno_token", playerToken);
  openLobby();
});

$("joinBtn").addEventListener("click", async () => {
  playerName = $("playerName").value.trim() || "Hijo";
  localStorage.setItem("uno_name", playerName);
  const code = $("roomCode").value.trim().toUpperCase();
  if (code.length !== 5) return error("Ingresa el código de 5 letras.");
  const result = await request("joinRoom", { code, name: playerName });
  if (!result.ok) return error(result.error);
  roomCode = result.code;
  playerToken = result.token;
  sessionStorage.setItem("uno_code", roomCode);
  sessionStorage.setItem("uno_token", playerToken);
  openLobby();
});

$("roomCode").addEventListener("input", e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5));

function openLobby() {
  $("roomCodeDisplay").textContent = roomCode;
  showScreen("lobby");
}

$("copyCode").addEventListener("click", async () => {
  const inviteUrl = `${window.location.origin}/?room=${roomCode}`;
  try {
    await navigator.clipboard.writeText(inviteUrl);
    toast("¡Enlace copiado! Envíalo por WhatsApp");
  } catch (_) {
    toast(`Código de sala: ${roomCode}`);
  }
});

$("backHome").addEventListener("click", () => {
  sessionStorage.clear();
  location.reload();
});

$("leaveBtn").addEventListener("click", () => {
  if (confirm("¿Seguro que quieres salir de la partida?")) {
    sessionStorage.clear();
    location.reload();
  }
});

$("soundToggle").addEventListener("click", () => {
  soundOn = !soundOn;
  $("soundToggle").textContent = soundOn ? "🔊" : "🔇";
  toast(soundOn ? "Sonido activado" : "Sonido desactivado");
});

socket.on("state", next => {
  state = next;
  if (state.status === "waiting") {
    showScreen("lobby");
    renderLobby();
  } else {
    showScreen("game");
    renderGame();
  }
  if (state.status === "finished") showWinner();
});

function escapeHtml(val) {
  return String(val).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderLobby() {
  $("roomCodeDisplay").textContent = state.code;
  const players = state.players.filter(Boolean);
  $("lobbyPlayers").innerHTML = [0, 1].map(i => {
    const p = state.players[i];
    return `<div class="lobby-player"><b>${p ? escapeHtml(p.name) : "Esperando jugador…"}</b><small>${p ? (p.connected ? "● Conectado" : "○ Desconectado") : "Comparte el enlace"}</small></div>`;
  }).join("");
  $("lobbyStatus").textContent = players.length === 2 ? "¡Ambos conectados! Preparando mesa…" : "Esperando que se una tu rival…";
}

function makeCard(card, activeColor) {
  const label = cardLabel(card);
  const isWild = card.color === "wild";
  const glow = (isWild && activeColor) ? `style="box-shadow: 0 0 0 4px var(--${activeColor}), 0 8px 15px #000;"` : "";
  return `<div class="uno-card ${card.color}" ${glow}><span class="mini">${escapeHtml(label)}</span><span class="face">${escapeHtml(label)}</span><span class="mini bottom">${escapeHtml(label)}</span></div>`;
}

function renderGame() {
  $("gameRoomCode").textContent = `· Sala ${state.code}`;
  const me = state.players.find(p => p?.isMe);
  const opponent = state.players.find(p => p && !p.isMe);

  $("selfInfo").querySelector("strong").textContent = me?.name || playerName;
  $("selfInfo").querySelector("small").textContent = state.myTurn ? "¡Tu turno!" : "Esperando";
  $("selfInfo").querySelector(".card-count").textContent = state.myHand.length;

  $("opponentInfo").querySelector("strong").textContent = opponent?.name || "Oponente";
  $("opponentInfo").querySelector("small").textContent = opponent?.connected ? "● En línea" : "○ Desconectado";
  $("opponentInfo").querySelector(".card-count").textContent = opponent?.count ?? 0;
  $("opponentCards").innerHTML = Array.from({ length: Math.min(opponent?.count || 0, 15) }, (_, i) => `<div class="back-card" style="--rot:${(i - 7) * 1.2}deg"></div>`).join("");

  $("deckCount").textContent = `${state.deckCount} cartas`;
  $("discardPile").innerHTML = state.discard.length ? makeCard(state.discard[state.discard.length - 1], state.activeColor) : '<div class="empty-card">—</div>';
  $("activeColorLabel").textContent = state.activeColor ? `Color: ${colorNames[state.activeColor] || state.activeColor}` : "Color activo";

  $("turnPill").textContent = state.myTurn ? "✨ TU TURNO" : `Turno de ${opponent?.name || "rival"}`;
  $("turnPill").style.color = state.myTurn ? "#ffdf4c" : "#c7e8dd";
  $("tableMessage").textContent = state.notice || (state.myTurn ? "¡Tu turno! Juega una carta o roba." : `Espera la jugada de ${opponent?.name || "tu rival"}.`);

  const top = state.discard[state.discard.length - 1];

  let hasPlayableCards = false;
  $("myHand").innerHTML = state.myHand.map((c, i) => {
    const matchesTop = (c.color === "wild" || c.color === state.activeColor || c.value === top.value);
    const playable = state.myTurn && (!state.challenge) && (state.drawnCardId ? (c.id === state.drawnCardId && matchesTop) : matchesTop);
    if (playable) hasPlayableCards = true;

    return `<button class="hand-card ${c.color} ${playable ? "playable" : ""}" data-id="${c.id}" style="--rot:${(i - (state.myHand.length - 1) / 2) * 1.4}deg" ${playable ? "" : "disabled"} aria-label="${colorNames[c.color] || "Comodín"} ${cardLabel(c)}"><span class="corner">${cardLabel(c)}</span><span class="face">${cardLabel(c)}</span><span class="corner bottom">${cardLabel(c)}</span></button>`;
  }).join("");

  $("myHand").querySelectorAll(".hand-card").forEach(btn => btn.addEventListener("click", () => onCardClick(btn.dataset.id)));

  // Habilitar o deshabilitar botón del MAZO
  const canDraw = state.myTurn && (state.drawnFor === null) && !state.challenge;
  $("drawBtn").disabled = !canDraw;
  $("drawBtn").style.opacity = canDraw ? "1" : ".45";
  // Si no tienes cartas para jugar, hacer que el mazo brille y palpite
  $("drawBtn").classList.toggle("highlight-draw", Boolean(canDraw && !hasPlayableCards));

  $("passBtn").classList.toggle("hidden", !(state.myTurn && state.drawnFor !== null));

  const needsToCallUno = state.myHand.length === 1 && state.unoPending && state.unoPending.player === state.players.findIndex(p => p?.isMe);
  $("unoBtn").classList.toggle("visible", Boolean(needsToCallUno));

  $("catchUnoBtn").classList.toggle("hidden", !state.canCatchUno);
  $("challengeActions").classList.toggle("hidden", !state.canChallenge);

  // Mensaje de ayuda en la parte inferior
  if (state.myTurn) {
    if (state.drawnFor !== null) {
      $("handHint").textContent = hasPlayableCards ? "Puedes jugar la carta robada o pulsar 'Pasar turno'" : "La carta no sirve. Pulsa 'Pasar turno'";
    } else if (!hasPlayableCards) {
      $("handHint").textContent = "⚠️ No tienes cartas que sirvan: ¡Toca el MAZO para robar!";
    } else {
      $("handHint").textContent = "Toca una carta resaltada para jugarla";
    }
  } else {
    $("handHint").textContent = `Es el turno de ${opponent?.name || "tu rival"}`;
  }
}

async function onCardClick(id) {
  const card = state.myHand.find(c => c.id === id);
  if (!card) return;
  if (card.color === "wild") {
    pendingWildCard = id;
    $("colorModal").classList.remove("hidden");
    return;
  }
  await submitPlay(id, null);
}

async function submitPlay(cardId, color) {
  const result = await request("playCard", { cardId, color });
  if (!result.ok) return toast(result.error);
  beep(640);
}

$("colorModal").querySelectorAll(".color-choice").forEach(btn => btn.addEventListener("click", async () => {
  const color = btn.dataset.color;
  $("colorModal").classList.add("hidden");
  if (pendingWildCard) await submitPlay(pendingWildCard, color);
  pendingWildCard = null;
}));

$("drawBtn").addEventListener("click", async () => {
  const result = await request("drawCard");
  if (!result.ok) return toast(result.error);
  beep(360);
  toast("¡Robaste una carta!");
});

$("passBtn").addEventListener("click", async () => {
  const result = await request("passTurn");
  if (!result.ok) toast(result.error);
});

$("unoBtn").addEventListener("click", async () => {
  const result = await request("callUno");
  if (!result.ok) toast(result.error);
  else { toast("¡CANTAS UNO!"); beep(840); }
});

$("catchUnoBtn").addEventListener("click", async () => {
  const result = await request("catchUno");
  if (!result.ok) toast(result.error);
  else { toast("¡Pillaste al rival sin decir UNO! (+2)"); beep(500); }
});

$("challengeBtn").addEventListener("click", async () => {
  const result = await request("challengeWild4");
  if (!result.ok) toast(result.error);
});

$("acceptBtn").addEventListener("click", async () => {
  const result = await request("acceptWild4");
  if (!result.ok) toast(result.error);
});

function showWinner() {
  const winner = state.players[state.winner]?.name || "Ganador";
  const iWon = state.players[state.winner]?.isMe;
  $("winnerTitle").textContent = iWon ? "🎉 ¡GANASTE! 🎉" : `¡Ganó ${winner}!`;
  $("winnerText").textContent = iWon ? "¡Excelente partida! Le ganaste a tu rival." : `${winner} se llevó la victoria esta vez. ¿Revancha?`;
  $("winModal").classList.remove("hidden");
  beep(880, 0.25);
}

$("newGameBtn").addEventListener("click", async () => {
  const result = await request("newGame");
  if (!result.ok) toast(result.error);
  else $("winModal").classList.add("hidden");
});

$("returnLobbyBtn").addEventListener("click", () => {
  $("winModal").classList.add("hidden");
  toast("La sala sigue activa para otra partida.");
});