// ============================================================
//  WAVELENGTH — Cliente (vanilla JS + Socket.IO)
// ============================================================

const socket = io();

// ---- Estado local del cliente ----
let myId = null;         // id del jugador (asignado por el servidor)
let myTeam = null;       // "A" | "B"
let roomState = null;    // último estado de sala recibido
let targetPosition = null; // solo lo conoce el psíquico
let sliderValue = 50;    // valor actual del slider (equipo activo)
let rivalCountdown = null;

// ---- Atajos DOM ----
const $ = (id) => document.getElementById(id);
function show(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(screenId).classList.add("active");
}

// ============================================================
//  PANTALLA INICIO
// ============================================================
$("btn-create").addEventListener("click", () => {
  const name = $("input-name").value.trim();
  if (!name) { $("home-error").textContent = "Escribe tu nombre."; return; }
  socket.emit("create_room", name);
});

$("btn-join").addEventListener("click", () => {
  const name = $("input-name").value.trim();
  const code = $("input-code").value.trim().toUpperCase();
  if (!name) { $("home-error").textContent = "Escribe tu nombre."; return; }
  if (code.length !== 4) { $("home-error").textContent = "El código tiene 4 letras."; return; }
  socket.emit("join_room", { code, name });
});

socket.on("room_created", ({ code, playerId }) => {
  myId = playerId;
  show("screen-lobby");
});

socket.on("room_joined", ({ code, playerId }) => {
  myId = playerId;
  show("screen-lobby");
});

socket.on("room_error", (msg) => {
  $("home-error").textContent = msg;
});

// ============================================================
//  ACTUALIZACIÓN DE SALA (se recibe en cualquier momento)
// ============================================================
socket.on("room_update", (state) => {
  roomState = state;
  const me = state.players.find((p) => p.id === myId);
  if (me) myTeam = me.team;

  if (!state.started) {
    renderLobby(state);
    show("screen-lobby");
  } else {
    renderGame(state);
    // No forzamos show aquí si estamos en pantalla de fin
    if (!$("screen-over").classList.contains("active")) {
      show("screen-game");
    }
  }
});

// ============================================================
//  LOBBY
// ============================================================
function renderLobby(state) {
  $("lobby-code").textContent = state.code;
  $("lobby-count").textContent = state.players.length;

  const list = $("lobby-players");
  list.innerHTML = "";
  state.players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.id === state.hostId ? " 👑" : "");
    list.appendChild(li);
  });

  // Equipos (todavía sin asignar antes de empezar, pero mostramos si existen)
  renderTeamList("lobby-team-a", state, "A");
  renderTeamList("lobby-team-b", state, "B");

  // Botón empezar solo para el host
  const isHost = myId === state.hostId;
  const enough = state.players.length >= state.minPlayers;
  $("btn-start").style.display = isHost ? "block" : "none";
  $("btn-start").disabled = !enough;
  $("btn-start").style.opacity = enough ? "1" : "0.5";

  if (isHost) {
    $("lobby-hint").textContent = enough
      ? "Puedes empezar cuando quieras."
      : `Faltan jugadores (mínimo ${state.minPlayers}).`;
  } else {
    $("lobby-hint").textContent = "Esperando a que el host empiece la partida...";
  }
}

function renderTeamList(elId, state, team) {
  const ul = $(elId);
  ul.innerHTML = "";
  state.players
    .filter((p) => p.team === team)
    .forEach((p) => {
      const li = document.createElement("li");
      li.textContent = p.name;
      ul.appendChild(li);
    });
}

$("btn-start").addEventListener("click", () => socket.emit("start_game"));

// ============================================================
//  JUEGO — render principal según fase y rol
// ============================================================
socket.on("target_position", (pos) => {
  targetPosition = pos;
  if (roomState) renderGame(roomState);
});

function amPsychic() {
  return roomState && roomState.psychicId === myId;
}
function amActiveTeam() {
  return roomState && myTeam === roomState.activeTeam;
}

function renderGame(state) {
  const round = state.round;
  if (!round) return;

  // Marcador
  $("score-a").textContent = state.scoreA;
  $("score-b").textContent = state.scoreB;

  // Turno
  $("turn-badge").textContent = `Turno: Equipo ${state.activeTeam}`;
  $("turn-badge").style.color = state.activeTeam === "A" ? "var(--team-a)" : "var(--team-b)";

  // Etiquetas del espectro
  $("label-left").textContent = round.category.left;
  $("label-right").textContent = round.category.right;

  // Fase legible
  const phaseNames = {
    clue: "Fase 1: el psíquico da la pista",
    guessing: "Fase 2: el equipo activo adivina",
    rival_vote: "Fase 3: el rival apuesta izq/der",
    reveal: "Resultado de la ronda",
  };
  $("phase-badge").textContent = phaseNames[round.phase] || "";

  // Mi rol
  let roleText = `Estás en el <b>Equipo ${myTeam || "?"}</b>. `;
  if (amPsychic()) roleText += "Eres el <b>PSÍQUICO</b> 🔮";
  else if (amActiveTeam()) roleText += "Tu equipo <b>adivina</b> esta ronda.";
  else roleText += "Tu equipo es el <b>rival</b> esta ronda.";
  $("my-role").innerHTML = roleText;

  // Ocultar todos los controles, luego mostrar según corresponda
  ["ctrl-clue", "ctrl-guess", "ctrl-rival", "ctrl-wait", "ctrl-reveal"].forEach(
    (id) => ($(id).style.display = "none")
  );
  $("clue-display").style.display = "none";
  $("slider").style.display = "none";
  $("target-marker").style.display = "none";
  $("guess-marker").style.display = "none";
  $("zones").style.display = "none";

  // Mostrar la pista si ya existe (fases posteriores)
  if (round.clue) {
    $("clue-display").style.display = "block";
    $("clue-display").textContent = `Pista: "${round.clue}"`;
  }

  // El psíquico ve la marca del objetivo durante toda su ronda
  if (amPsychic() && targetPosition != null && round.phase !== "reveal") {
    placeMarker("target-marker", targetPosition);
  }

  // ---- Controles por fase ----
  if (round.phase === "clue") {
    if (amPsychic()) {
      $("ctrl-clue").style.display = "block";
    } else {
      $("ctrl-wait").style.display = "block";
      $("wait-text").textContent = "El psíquico está pensando la pista...";
    }
  }

  else if (round.phase === "guessing") {
    if (amActiveTeam() && !amPsychic()) {
      // Miembros del equipo activo mueven el slider
      $("ctrl-guess").style.display = "block";
      $("slider").style.display = "block";
      $("slider").value = sliderValue;
      placeMarker("guess-marker", sliderValue);
    } else if (amPsychic()) {
      $("ctrl-wait").style.display = "block";
      $("wait-text").textContent = "Tu equipo está adivinando. ¡No puedes ayudar más!";
    } else {
      $("ctrl-wait").style.display = "block";
      $("wait-text").textContent = "El equipo rival está adivinando la posición...";
    }
  }

  else if (round.phase === "rival_vote") {
    // Mostrar la marca bloqueada del equipo activo a todos
    if (round.teamGuess != null) placeMarker("guess-marker", round.teamGuess);

    if (!amActiveTeam()) {
      // Equipo rival vota
      if (round.rivalVote == null) {
        $("ctrl-rival").style.display = "block";
        startRivalCountdown();
      } else {
        $("ctrl-wait").style.display = "block";
        $("wait-text").textContent = "Voto registrado. Revelando...";
      }
    } else {
      $("ctrl-wait").style.display = "block";
      $("wait-text").textContent = "El equipo rival está decidiendo izquierda/derecha...";
    }
  }

  else if (round.phase === "reveal") {
    // El render de reveal se maneja en el evento round_reveal.
    // Aquí solo aseguramos que se vea el bloque si volvemos a renderizar.
  }
}

// Coloca una marca (target o guess) en la barra según posición 0-100.
function placeMarker(markerId, pos) {
  const m = $(markerId);
  m.style.display = "block";
  m.style.left = pos + "%";
}

// ============================================================
//  FASE 1 — Psíquico envía pista
// ============================================================
$("btn-clue").addEventListener("click", () => {
  const clue = $("input-clue").value.trim();
  if (!clue) return;
  socket.emit("submit_clue", clue);
  $("input-clue").value = "";
});

socket.on("clue_given", (clue) => {
  // El estado llegará vía room_update; aquí solo aseguramos mostrarla.
  $("clue-display").style.display = "block";
  $("clue-display").textContent = `Pista: "${clue}"`;
});

// ============================================================
//  FASE 2 — Slider compartido del equipo activo
// ============================================================
$("slider").addEventListener("input", (e) => {
  sliderValue = Number(e.target.value);
  placeMarker("guess-marker", sliderValue);
  socket.emit("move_slider", sliderValue);
});

// Recibir movimientos de otros miembros del equipo (cursor compartido)
socket.on("slider_moved", (pos) => {
  sliderValue = pos;
  $("slider").value = pos;
  placeMarker("guess-marker", pos);
});

$("btn-lock").addEventListener("click", () => {
  socket.emit("lock_guess", sliderValue);
});

socket.on("guess_locked", (pos) => {
  placeMarker("guess-marker", pos);
});

// ============================================================
//  FASE 3 — Voto del equipo rival
// ============================================================
$("btn-left").addEventListener("click", () => socket.emit("rival_vote", "left"));
$("btn-right").addEventListener("click", () => socket.emit("rival_vote", "right"));

function startRivalCountdown() {
  clearInterval(rivalCountdown);
  let secs = 20;
  $("rival-timer").textContent = `Tiempo: ${secs}s`;
  rivalCountdown = setInterval(() => {
    secs--;
    if (secs <= 0) {
      clearInterval(rivalCountdown);
      $("rival-timer").textContent = "Tiempo agotado.";
    } else {
      $("rival-timer").textContent = `Tiempo: ${secs}s`;
    }
  }, 1000);
}

socket.on("rival_vote_locked", () => {
  clearInterval(rivalCountdown);
});

// ============================================================
//  FASE 4 — Revelación y puntuación
// ============================================================
socket.on("round_reveal", (result) => {
  clearInterval(rivalCountdown);

  // Ocultar controles activos
  ["ctrl-clue", "ctrl-guess", "ctrl-rival", "ctrl-wait"].forEach(
    (id) => ($(id).style.display = "none")
  );
  $("slider").style.display = "none";

  // Mostrar zonas de puntuación centradas en el objetivo real
  drawZones(result.targetPosition);
  placeMarker("target-marker", result.targetPosition);
  placeMarker("guess-marker", result.teamGuess);

  // Texto de resultado
  const rivalTeam = result.activeTeam === "A" ? "B" : "A";
  let voteText = "El equipo rival no apostó.";
  if (result.rivalVote) {
    const dir = result.rivalVote === "left" ? "IZQUIERDA" : "DERECHA";
    voteText = result.rivalCorrect
      ? `<span class="ok">Equipo ${rivalTeam} acertó (${dir}): +1 punto.</span>`
      : `<span class="bad">Equipo ${rivalTeam} falló (${dir}): 0 puntos.</span>`;
  }

  $("reveal-text").innerHTML = `
    <div>Pista: <b>"${result.clue}"</b></div>
    <span class="big">Distancia: ${result.distance} → Equipo ${result.activeTeam} suma ${result.activePoints} pts</span>
    <div>Posición del equipo: ${result.teamGuess} · Objetivo real: ${result.targetPosition}</div>
    <div>${voteText}</div>
    <div style="margin-top:10px">Marcador: <b>A ${result.scoreA} — ${result.scoreB} B</b></div>
  `;

  $("ctrl-reveal").style.display = "block";
  $("clue-display").style.display = "none";
  show("screen-game");
});

// Dibuja las zonas de color (bullseye/anillos) alrededor del objetivo.
function drawZones(target) {
  const zones = $("zones");
  zones.innerHTML = "";
  zones.style.display = "block";
  // rangos: bullseye ±3 (verde), anillo ±6 (amarillo), anillo ±10 (naranja)
  const bands = [
    { r: 10, color: "rgba(255,138,61,0.5)" },
    { r: 6, color: "rgba(255,214,61,0.6)" },
    { r: 3, color: "rgba(76,175,80,0.7)" },
  ];
  bands.forEach((b) => {
    const div = document.createElement("div");
    div.className = "zone";
    const left = Math.max(0, target - b.r);
    const right = Math.min(100, target + b.r);
    div.style.left = left + "%";
    div.style.width = (right - left) + "%";
    div.style.background = b.color;
    zones.appendChild(div);
  });
}

$("btn-next").addEventListener("click", () => {
  socket.emit("next_round");
  // reset slider local para la próxima ronda
  sliderValue = 50;
  targetPosition = null;
});

// ============================================================
//  FIN DE PARTIDA
// ============================================================
socket.on("game_over", (data) => {
  $("winner-text").textContent = `🏆 ¡Gana el Equipo ${data.winner}!`;
  $("final-score").textContent = `Equipo A ${data.scoreA} — ${data.scoreB} Equipo B`;
  show("screen-over");
});

$("btn-again").addEventListener("click", () => {
  socket.emit("play_again");
  sliderValue = 50;
  targetPosition = null;
  show("screen-game");
});
