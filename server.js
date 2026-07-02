// ============================================================
//  WAVELENGTH — Servidor (Node.js + Express + Socket.IO)
//  Todo el estado vive en memoria (objeto `rooms`). Sin base de datos.
// ============================================================

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const categories = require("./categories");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir el frontend estático desde /public
app.use(express.static(path.join(__dirname, "public")));

// ---- Constantes de juego (fáciles de cambiar) ----
const WINNING_SCORE = 10;      // puntos para ganar la partida (modo dial)
const MIN_PLAYERS = 4;         // mínimo para empezar (modo dial: 2 equipos)
const MIN_PLAYERS_NUMBER = 3;  // mínimo para el modo número (2 saben + 1 adivina)
const RIVAL_VOTE_TIMEOUT = 20; // segundos para que el rival vote

// ---- Estado global ----
const rooms = {}; // code -> room

// ============================================================
//  Utilidades
// ============================================================

// Genera un código de sala de 4 letras que no esté en uso.
function generateRoomCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += letters[Math.floor(Math.random() * letters.length)];
    }
  } while (rooms[code]);
  return code;
}

// Reparte los jugadores en dos equipos equilibrados (alternando).
function balanceTeams(room) {
  room.teamA = [];
  room.teamB = [];
  room.players.forEach((player, index) => {
    const team = index % 2 === 0 ? "A" : "B";
    player.team = team;
    if (team === "A") room.teamA.push(player.id);
    else room.teamB.push(player.id);
  });
}

// Devuelve una categoría aleatoria sin repetir hasta agotar la lista.
function pickCategory(room) {
  if (!room.categoryQueue || room.categoryQueue.length === 0) {
    // Rellenar y barajar los índices de todas las categorías
    room.categoryQueue = categories.map((_, i) => i);
    for (let i = room.categoryQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [room.categoryQueue[i], room.categoryQueue[j]] =
        [room.categoryQueue[j], room.categoryQueue[i]];
    }
  }
  const idx = room.categoryQueue.pop();
  return categories[idx];
}

// Devuelve el id del psíquico actual del equipo activo.
function getPsychicId(room) {
  if (room.activeTeam === "A") {
    if (room.teamA.length === 0) return null;
    return room.teamA[room.psychicIndexA % room.teamA.length];
  } else {
    if (room.teamB.length === 0) return null;
    return room.teamB[room.psychicIndexB % room.teamB.length];
  }
}

// Construye una versión "pública" del estado de sala para enviar a clientes.
// No incluye la posición del objetivo (targetPosition) salvo en la revelación.
function publicRoomState(room) {
  const base = {
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    mode: room.mode,
    minPlayers: room.mode === "number" ? MIN_PLAYERS_NUMBER : MIN_PLAYERS,
    players: room.players.map((p) => ({ id: p.id, name: p.name, team: p.team })),
  };

  if (room.mode === "number") {
    // El número secreto NUNCA va en el estado público; se envía aparte.
    return {
      ...base,
      guesserId: room.started ? room.guesserOrder[room.guesserIndex] : null,
      groupScore: room.groupScore,
      round: room.currentRound
        ? {
            phase: room.currentRound.phase,
            guess: room.currentRound.guess,
            roundNumber: room.roundNumber,
            totalRounds: room.totalRounds,
          }
        : null,
    };
  }

  // ---- modo dial (por defecto) ----
  return {
    ...base,
    activeTeam: room.activeTeam,
    scoreA: room.scoreA,
    scoreB: room.scoreB,
    winningScore: WINNING_SCORE,
    psychicId: room.started ? getPsychicId(room) : null,
    round: room.currentRound
      ? {
          category: room.currentRound.category,
          clue: room.currentRound.clue,
          teamGuess: room.currentRound.teamGuess,
          rivalVote: room.currentRound.rivalVote,
          phase: room.currentRound.phase,
          // targetPosition se envía aparte, solo al psíquico
        }
      : null,
  };
}

// Emite el estado de sala a todos los miembros de la sala.
function broadcastRoom(room) {
  io.to(room.code).emit("room_update", publicRoomState(room));
}

// Encuentra la sala y el jugador asociados a un socket.
function findBySocket(socketId) {
  for (const code in rooms) {
    const room = rooms[code];
    const player = room.players.find((p) => p.socketId === socketId);
    if (player) return { room, player };
  }
  return { room: null, player: null };
}

// ============================================================
//  Lógica de rondas
// ============================================================

// Inicia una nueva ronda: elige categoría, objetivo oculto y fase "clue".
function startNewRound(room) {
  const category = pickCategory(room);
  const targetPosition = Math.floor(Math.random() * 101); // 0-100

  room.currentRound = {
    category,
    targetPosition,
    clue: "",
    teamGuess: null,
    rivalVote: null,
    phase: "clue",
  };

  // Limpiar cualquier temporizador de voto rival previo
  if (room.rivalTimer) {
    clearTimeout(room.rivalTimer);
    room.rivalTimer = null;
  }

  broadcastRoom(room);

  // Enviar la posición del objetivo SOLO al psíquico
  const psychicId = getPsychicId(room);
  const psychic = room.players.find((p) => p.id === psychicId);
  if (psychic) {
    io.to(psychic.socketId).emit("target_position", targetPosition);
  }
}

// ---- Modo número: inicia una ronda ----
// Elige adivinador (por rotación) y un número secreto 1-10 que ven todos
// menos el adivinador.
function startNumberRound(room) {
  const guesserId = room.guesserOrder[room.guesserIndex];
  const secretNumber = 1 + Math.floor(Math.random() * 10); // 1..10

  room.currentRound = {
    mode: "number",
    guesserId,
    secretNumber,
    guess: null,
    phase: "guess_number",
  };
  room.roundNumber = room.guesserIndex + 1;

  broadcastRoom(room); // estado público SIN el número

  // Enviar el número secreto a todos MENOS al adivinador.
  room.players.forEach((p) => {
    if (p.id !== guesserId) {
      io.to(p.socketId).emit("secret_number", secretNumber);
    }
  });
}

// Calcula puntuación y pasa a la fase de revelación.
function revealRound(room) {
  const r = room.currentRound;
  if (!r || r.phase === "reveal") return;

  if (room.rivalTimer) {
    clearTimeout(room.rivalTimer);
    room.rivalTimer = null;
  }

  const target = r.targetPosition;
  const guess = r.teamGuess != null ? r.teamGuess : 50;
  const distance = Math.abs(guess - target);

  // Puntos del equipo activo según distancia
  let activePoints = 0;
  if (distance <= 3) activePoints = 4;
  else if (distance <= 6) activePoints = 3;
  else if (distance <= 10) activePoints = 2;
  else activePoints = 0;

  // Punto del equipo rival según su apuesta izquierda/derecha
  // "left" = el objetivo real está a la IZQUIERDA de la marca (target < guess)
  // "right" = el objetivo real está a la DERECHA de la marca (target > guess)
  let rivalPoint = 0;
  let rivalCorrect = false;
  if (r.rivalVote && target !== guess) {
    const realSide = target < guess ? "left" : "right";
    if (r.rivalVote === realSide) {
      rivalPoint = 1;
      rivalCorrect = true;
    }
  }

  // Sumar al marcador (el equipo activo gana activePoints, el rival rivalPoint)
  if (room.activeTeam === "A") {
    room.scoreA += activePoints;
    room.scoreB += rivalPoint;
  } else {
    room.scoreB += activePoints;
    room.scoreA += rivalPoint;
  }

  r.phase = "reveal";

  const result = {
    category: r.category,
    clue: r.clue,
    teamGuess: guess,
    targetPosition: target,
    distance,
    activeTeam: room.activeTeam,
    activePoints,
    rivalVote: r.rivalVote,
    rivalCorrect,
    rivalPoint,
    scoreA: room.scoreA,
    scoreB: room.scoreB,
  };

  io.to(room.code).emit("round_reveal", result);
  broadcastRoom(room);

  // ¿Fin de partida?
  if (room.scoreA >= WINNING_SCORE || room.scoreB >= WINNING_SCORE) {
    const winner = room.scoreA >= room.scoreB ? "A" : "B";
    // Empate improbable (ambos llegan a la vez): gana el de más puntos, o A.
    const realWinner =
      room.scoreA > room.scoreB ? "A" : room.scoreB > room.scoreA ? "B" : winner;
    io.to(room.code).emit("game_over", {
      winner: realWinner,
      scoreA: room.scoreA,
      scoreB: room.scoreB,
    });
  }
}

// Avanza a la siguiente ronda: cambia equipo activo y rota el psíquico.
function nextRound(room) {
  // Rotar el psíquico del equipo que acaba de jugar
  if (room.activeTeam === "A") {
    room.psychicIndexA = (room.psychicIndexA + 1) % Math.max(1, room.teamA.length);
  } else {
    room.psychicIndexB = (room.psychicIndexB + 1) % Math.max(1, room.teamB.length);
  }
  // Alternar equipo activo
  room.activeTeam = room.activeTeam === "A" ? "B" : "A";
  startNewRound(room);
}

// ============================================================
//  Manejo de conexiones Socket.IO
// ============================================================

io.on("connection", (socket) => {
  // ---- Crear sala ----
  socket.on("create_room", (name) => {
    const cleanName = (name || "").trim().slice(0, 20) || "Jugador";
    const code = generateRoomCode();
    const playerId = socket.id; // en el MVP, id == socketId al crear

    const room = {
      code,
      hostId: playerId,
      started: false,
      mode: "dial", // "dial" | "number"
      players: [{ id: playerId, name: cleanName, socketId: socket.id, team: null }],
      teamA: [],
      teamB: [],
      activeTeam: "A",
      psychicIndexA: 0,
      psychicIndexB: 0,
      scoreA: 0,
      scoreB: 0,
      currentRound: null,
      categoryQueue: [],
      rivalTimer: null,
      // ---- estado del modo número ----
      guesserOrder: [], // ids de jugadores en orden de rotación
      guesserIndex: 0,  // a quién le toca adivinar
      groupScore: 0,    // puntuación cooperativa acumulada
      roundNumber: 0,   // ronda actual (1..totalRounds)
      totalRounds: 0,   // una ronda por jugador
    };
    rooms[code] = room;

    socket.join(code);
    socket.emit("room_created", { code, playerId });
    broadcastRoom(room);
  });

  // ---- Unirse a sala ----
  socket.on("join_room", ({ code, name }) => {
    const roomCode = (code || "").trim().toUpperCase();
    const room = rooms[roomCode];
    if (!room) {
      socket.emit("room_error", "No existe ninguna sala con ese código.");
      return;
    }

    const cleanName = (name || "").trim().slice(0, 20) || "Jugador";

    // Si el nombre coincide con un jugador existente, reocupa su sitio (reconexión simple)
    let player = room.players.find((p) => p.name.toLowerCase() === cleanName.toLowerCase());
    if (player) {
      player.socketId = socket.id;
    } else {
      player = { id: socket.id, name: cleanName, socketId: socket.id, team: null };
      room.players.push(player);
      // Si la partida (modo dial) ya empezó, asignarle a un equipo para que pueda mirar
      if (room.started && room.mode === "dial") {
        const team = room.teamA.length <= room.teamB.length ? "A" : "B";
        player.team = team;
        if (team === "A") room.teamA.push(player.id);
        else room.teamB.push(player.id);
      }
    }

    socket.join(roomCode);
    socket.emit("room_joined", { code: roomCode, playerId: player.id });
    broadcastRoom(room);

    // Si se reconecta y es el psíquico de una ronda en curso, reenviarle el target
    if (
      room.started &&
      room.mode === "dial" &&
      room.currentRound &&
      getPsychicId(room) === player.id
    ) {
      socket.emit("target_position", room.currentRound.targetPosition);
    }

    // Modo número: si se reconecta alguien que SABE el número (no es el
    // adivinador), reenviárselo.
    if (
      room.started &&
      room.mode === "number" &&
      room.currentRound &&
      room.currentRound.guesserId !== player.id
    ) {
      socket.emit("secret_number", room.currentRound.secretNumber);
    }
  });

  // ---- Elegir modo de juego (solo host, sala no empezada) ----
  socket.on("set_mode", (mode) => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player) return;
    if (player.id !== room.hostId) return;
    if (room.started) return;
    if (mode !== "dial" && mode !== "number") return;
    room.mode = mode;
    broadcastRoom(room);
  });

  // ---- Empezar partida (solo host) ----
  socket.on("start_game", () => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player) return;
    if (player.id !== room.hostId) return;

    const min = room.mode === "number" ? MIN_PLAYERS_NUMBER : MIN_PLAYERS;
    if (room.players.length < min) {
      socket.emit("room_error", `Se necesitan al menos ${min} jugadores.`);
      return;
    }

    if (room.mode === "number") {
      // Modo número: sin equipos, rotación de adivinador entre todos.
      room.started = true;
      room.guesserOrder = room.players.map((p) => p.id);
      room.guesserIndex = 0;
      room.groupScore = 0;
      room.roundNumber = 0;
      room.totalRounds = room.guesserOrder.length;
      startNumberRound(room);
      return;
    }

    // Modo dial (por defecto)
    balanceTeams(room);
    room.started = true;
    room.activeTeam = "A";
    room.psychicIndexA = 0;
    room.psychicIndexB = 0;
    room.scoreA = 0;
    room.scoreB = 0;
    startNewRound(room);
  });

  // ---- Modo número: el adivinador envía su número ----
  socket.on("submit_number_guess", (value) => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player || room.mode !== "number" || !room.currentRound) return;
    if (room.currentRound.phase !== "guess_number") return;
    if (room.currentRound.guesserId !== player.id) return;

    const guess = Math.round(Number(value));
    if (!(guess >= 1 && guess <= 10)) return;

    const secret = room.currentRound.secretNumber;
    const distance = Math.abs(guess - secret);
    let points = 0;
    if (distance === 0) points = 3;
    else if (distance === 1) points = 2;
    else if (distance === 2) points = 1;

    room.groupScore += points;
    room.currentRound.guess = guess;
    room.currentRound.phase = "reveal";

    io.to(room.code).emit("number_reveal", {
      secretNumber: secret,
      guess,
      distance,
      points,
      groupScore: room.groupScore,
      guesserId: player.id,
      guesserName: player.name,
      roundNumber: room.roundNumber,
      totalRounds: room.totalRounds,
    });
    broadcastRoom(room);
  });

  // ---- Fase 1: enviar pista (solo psíquico) ----
  socket.on("submit_clue", (clue) => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player || room.mode !== "dial" || !room.currentRound) return;
    if (room.currentRound.phase !== "clue") return;
    if (getPsychicId(room) !== player.id) return;

    room.currentRound.clue = (clue || "").trim().slice(0, 60);
    room.currentRound.phase = "guessing";
    io.to(room.code).emit("clue_given", room.currentRound.clue);
    broadcastRoom(room);
  });

  // ---- Fase 2: mover slider (miembros del equipo activo, no el psíquico) ----
  socket.on("move_slider", (position) => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player || room.mode !== "dial" || !room.currentRound) return;
    if (room.currentRound.phase !== "guessing") return;
    if (player.team !== room.activeTeam) return;
    if (getPsychicId(room) === player.id) return;

    const pos = Math.max(0, Math.min(100, Number(position)));
    // Reenviar el movimiento en tiempo real a los miembros del equipo activo
    const teamIds = room.activeTeam === "A" ? room.teamA : room.teamB;
    teamIds.forEach((id) => {
      const member = room.players.find((p) => p.id === id);
      if (member) io.to(member.socketId).emit("slider_moved", pos);
    });
  });

  // ---- Fase 2 → 3: bloquear posición del equipo activo ----
  socket.on("lock_guess", (position) => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player || room.mode !== "dial" || !room.currentRound) return;
    if (room.currentRound.phase !== "guessing") return;
    if (player.team !== room.activeTeam) return;
    if (getPsychicId(room) === player.id) return;

    const pos = Math.max(0, Math.min(100, Number(position)));
    room.currentRound.teamGuess = pos;
    room.currentRound.phase = "rival_vote";
    io.to(room.code).emit("guess_locked", pos);
    broadcastRoom(room);

    // Iniciar temporizador: si el rival no vota en 20s, se revela igual.
    room.rivalTimer = setTimeout(() => {
      if (room.currentRound && room.currentRound.phase === "rival_vote") {
        revealRound(room);
      }
    }, RIVAL_VOTE_TIMEOUT * 1000);
  });

  // ---- Fase 3: voto del equipo rival (primer voto gana) ----
  socket.on("rival_vote", (vote) => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player || room.mode !== "dial" || !room.currentRound) return;
    if (room.currentRound.phase !== "rival_vote") return;
    if (player.team === room.activeTeam) return; // debe ser del equipo rival
    if (vote !== "left" && vote !== "right") return;
    if (room.currentRound.rivalVote !== null) return; // ya se votó

    room.currentRound.rivalVote = vote;
    io.to(room.code).emit("rival_vote_locked", vote);
    broadcastRoom(room);

    // Con el voto emitido, revelar de inmediato.
    revealRound(room);
  });

  // ---- Siguiente ronda ----
  socket.on("next_round", () => {
    const { room } = findBySocket(socket.id);
    if (!room || !room.currentRound) return;
    if (room.currentRound.phase !== "reveal") return;

    if (room.mode === "number") {
      // ¿Ya adivinó todo el mundo una vez? → fin de partida.
      if (room.guesserIndex + 1 >= room.totalRounds) {
        io.to(room.code).emit("number_game_over", {
          groupScore: room.groupScore,
          totalRounds: room.totalRounds,
          maxScore: room.totalRounds * 3,
        });
        return;
      }
      room.guesserIndex += 1;
      startNumberRound(room);
      return;
    }

    // Modo dial: si ya hay un ganador, no seguir (se usa play_again en su lugar)
    if (room.scoreA >= WINNING_SCORE || room.scoreB >= WINNING_SCORE) return;
    nextRound(room);
  });

  // ---- Jugar otra vez (resetea puntuaciones, mantiene sala y jugadores) ----
  socket.on("play_again", () => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player) return;

    if (room.mode === "number") {
      room.groupScore = 0;
      room.guesserIndex = 0;
      room.roundNumber = 0;
      room.guesserOrder = room.players.map((p) => p.id);
      room.totalRounds = room.guesserOrder.length;
      startNumberRound(room);
      return;
    }

    room.scoreA = 0;
    room.scoreB = 0;
    room.activeTeam = "A";
    room.psychicIndexA = 0;
    room.psychicIndexB = 0;
    balanceTeams(room);
    startNewRound(room);
  });

  // ---- Desconexión ----
  socket.on("disconnect", () => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player) return;

    // En el MVP: si no ha empezado, se elimina de la lista. Si empezó, se
    // mantiene su hueco (puede reentrar con el mismo nombre).
    if (!room.started) {
      room.players = room.players.filter((p) => p.id !== player.id);
      // Reasignar host si se fue el host
      if (room.hostId === player.id && room.players.length > 0) {
        room.hostId = room.players[0].id;
      }
      // Borrar sala vacía
      if (room.players.length === 0) {
        delete rooms[room.code];
        return;
      }
    }
    broadcastRoom(room);
  });
});

// ============================================================
//  Arranque del servidor
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Wavelength escuchando en el puerto ${PORT}`);
});
