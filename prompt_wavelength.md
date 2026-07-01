# PROMPT PARA CLAUDE CODE — Juego "WAVELENGTH" (versión web multijugador)

## CONTEXTO Y OBJETIVO

Quiero que construyas un juego web multijugador basado en el juego de mesa **Wavelength**, para jugarlo con amigos por videollamada/voz de Discord mientras usamos esta web para la mecánica del dial y las puntuaciones. NO necesita integrarse con la API de Discord ni ser un bot: es una web normal que se juega en el navegador (móvil u ordenador) mientras hablamos por Discord por fuera.

Requisitos generales:
- **Simplicidad ante todo**: sin build step complejo, sin frameworks pesados. Stack: Node.js + Express + Socket.IO en el backend, HTML/CSS/JS vanilla en el frontend (sin React, sin Next.js).
- **Sin base de datos**: todo el estado de las partidas vive en memoria del servidor (objeto `rooms` en RAM). No hace falta persistencia entre reinicios.
- **Diseño funcional, no elaborado**: CSS simple, limpio, mobile-first (la gente jugará desde el móvil mientras habla por Discord en el PC). Nada de animaciones complejas ni librerías de UI. Colores neutros, tipografía del sistema, todo legible.
- **Listo para desplegar en Render.com** como Web Service: debe arrancar con `npm start`, escuchar en `process.env.PORT`, y no depender de nada que no esté en `package.json`.

---

## REGLAS DEL JUEGO (implementar EXACTAMENTE así)

### Roles y equipos
- Mínimo 4 jugadores, ideal 4-10. Se dividen en 2 equipos (Equipo A / Equipo B) de forma automática y equilibrada al empezar la partida (el host puede reordenar manualmente antes de empezar si quiere, pero no es obligatorio para el MVP).
- En cada ronda, un equipo es el **Equipo Activo** (tiene al Psíquico) y el otro es el **Equipo Rival**.
- El rol de Psíquico rota entre los miembros del equipo activo turno tras turno (cola circular por jugador dentro del equipo).
- Los equipos se alternan turno a turno: si en la ronda 1 es activo el Equipo A, en la ronda 2 es activo el Equipo B, y así sucesivamente.

### El espectro y el objetivo oculto
- Cada ronda se elige aleatoriamente (sin repetir hasta agotar la lista, luego se reinicia) un par de conceptos opuestos de una lista predefinida (ver sección "Lista de espectros" más abajo). Ejemplo: "FRÍO — CALIENTE".
- Se genera un número aleatorio entre 0 y 100 que representa la posición del objetivo oculto en el espectro (0 = extremo izquierdo, 100 = extremo derecho).
- **Solo el Psíquico ve este número/posición** en su pantalla (representado visualmente como una marca sobre la barra). El resto de jugadores solo ven la barra vacía con las dos etiquetas de los extremos.

### Fase 1 — La pista
- El Psíquico escribe una pista de una palabra (o frase corta) en un campo de texto y la envía.
- Esa pista se muestra en pantalla a TODOS los jugadores (equipo activo y equipo rival).
- Mientras tanto, el Psíquico no puede hacer nada más (no vota, no adivina).

### Fase 2 — El equipo activo adivina
- Los demás miembros del Equipo Activo (todos menos el Psíquico) ven un slider/barra horizontal (0-100) sin marcas de posición del objetivo, y deben debatir en voz (por Discord) y llegar a un acuerdo.
- Cualquier miembro del equipo activo puede mover el slider; el valor se sincroniza en tiempo real para todos los del equipo (que vean cómo se mueve mientras discuten, similar a un cursor compartido).
- Cuando están de acuerdo, cualquiera de ellos pulsa "Confirmar posición" y esa posición queda bloqueada (no se puede volver a mover).

### Fase 3 — El equipo rival adivina Izquierda/Derecha
- En cuanto el equipo activo bloquea su posición (pero ANTES de revelar dónde estaba el objetivo real), el equipo rival ve dos botones grandes: **"IZQUIERDA"** y **"DERECHA"**.
- Deben decidir (hablando por Discord) si creen que el objetivo real está a la izquierda o a la derecha de la posición marcada por el equipo activo.
- Cualquier miembro del equipo rival puede votar; se resuelve por el primer voto que se emita (para simplicidad del MVP) o por mayoría simple si prefieres — implementa "primer voto gana" para que sea instantáneo y no se bloquee esperando consenso técnico (el consenso humano ya lo hacen hablando).
- Si el equipo rival no vota en 20 segundos, se cuenta como "sin apuesta" (0 puntos posibles ahí, no penaliza).

### Fase 4 — Revelación y puntuación
- Se revela la posición real del objetivo a todos.
- Se calcula la distancia entre la posición marcada por el equipo activo y la posición real del objetivo: `distancia = abs(posicionEquipo - posicionReal)`.
- Puntos para el **equipo activo**:
  - `distancia <= 3` → **4 puntos** (Bullseye)
  - `distancia <= 6` → **3 puntos** (Anillo interior)
  - `distancia <= 10` → **2 puntos** (Anillo exterior)
  - `distancia > 10` → **0 puntos**
- Punto para el **equipo rival**:
  - Si votaron IZQUIERDA o DERECHA y acertaron respecto a si el objetivo real quedó a la izquierda o derecha de la marca del equipo activo → **+1 punto**.
  - Si el objetivo real cae EXACTAMENTE sobre la marca del equipo activo (mismo valor), nadie gana ese punto extra.
- Se muestra una pantalla de resultado con: pista dada, posición marcada, posición real, puntos ganados por cada equipo, marcador acumulado total.
- Botón "Siguiente ronda" (lo pulsa el host o cualquiera, para simplicidad) que reinicia el ciclo con el otro equipo como activo.

### Fin de la partida
- La partida termina cuando un equipo alcanza **10 puntos** (configurable como constante fácil de cambiar en el código, ej. `WINNING_SCORE = 10`).
- Pantalla final mostrando equipo ganador y marcador final, con botón "Jugar otra vez" que resetea puntuaciones pero mantiene la sala y los jugadores.

---

## FLUJO TÉCNICO / ARQUITECTURA

### Stack
- Backend: Node.js + Express (servir archivos estáticos) + Socket.IO (tiempo real).
- Frontend: `public/index.html` + `public/style.css` + `public/client.js`, todo vanilla JS. Sin frameworks, sin npm build.
- Un único servidor sirve tanto el HTML/CSS/JS estático como el WebSocket.

### Estructura de archivos
```
wavelength/
├── server.js
├── package.json
├── categories.js        (lista de espectros, exportada como array)
├── public/
│   ├── index.html
│   ├── style.css
│   └── client.js
└── README.md
```

### Estado en memoria (server.js)
Un objeto `rooms` donde cada sala tiene:
```js
{
  code: "ABCD",
  players: [{ id, name, socketId, team }],
  teamA: [], teamB: [],
  activeTeam: "A",
  psychicIndexA: 0, psychicIndexB: 0, // rotación
  scoreA: 0, scoreB: 0,
  currentRound: {
    category: { left: "FRÍO", right: "CALIENTE" },
    targetPosition: 42, // 0-100
    clue: "",
    teamGuess: null,      // posición 0-100 bloqueada
    rivalVote: null,      // "left" | "right" | null
    phase: "clue" | "guessing" | "rival_vote" | "reveal"
  }
}
```

### Salas
- Pantalla inicial: campo "Tu nombre" + botón "Crear sala" (genera código de 4 letras) o campo "Código de sala" + botón "Unirse".
- Todos ven una lista de jugadores conectados y a qué equipo pertenecen, en tiempo real.
- El primer jugador en crear la sala es el "host" y ve un botón "Empezar partida" (requiere mínimo 4 jugadores).

### Eventos de Socket.IO (nombralos así para claridad)
- `create_room` (name) → server responde con `room_created` (code)
- `join_room` (code, name) → `room_joined` / `room_error`
- `room_update` (broadcast completo del estado de sala cada vez que cambia algo: jugadores, equipos, marcador)
- `start_game` (solo host)
- `new_round` (broadcast: categoría visible a todos, target solo al psíquico vía evento privado `target_position`)
- `submit_clue` (clue) → broadcast `clue_given`
- `move_slider` (position) → broadcast en tiempo real solo a miembros del equipo activo (para ver el cursor compartido moverse)
- `lock_guess` (position) → broadcast `guess_locked`, activa fase de voto rival
- `rival_vote` ("left" | "right") → primer voto gana, broadcast `rival_vote_locked`
- `reveal_round` → server calcula puntos y hace broadcast con: target real, guess, puntos activo, acierto/fallo rival, marcador actualizado
- `next_round` → reinicia el ciclo, cambia equipo activo, rota psíquico
- `game_over` → cuando algún equipo llega a WINNING_SCORE

### Reconexión
No implementes reconexión robusta para el MVP: si alguien recarga la página, simplemente vuelve a la pantalla de "unirse a sala" y puede reentrar con el código (mantiene su team si el nombre coincide, si no, entra como nuevo jugador). No hace falta gestión de sesiones ni cookies.

---

## LISTA DE ESPECTROS (categorías) — usar como array inicial, mínimo estos 40, en español

Guarda esto en `categories.js` como array de objetos `{left, right}`:

FRÍO / CALIENTE, RÁPIDO / LENTO, BARATO / CARO, RIDÍCULO / RESPETABLE, INÚTIL / IMPRESCINDIBLE, SOBREVALORADO / INFRAVALORADO, ABURRIDO / ADICTIVO, NORMAL / RARO, SEGURO / PELIGROSO, LEGAL / ILEGAL (pero debería), FEO / GUAPO, PEQUEÑO / GIGANTE, SUAVE / ÁSPERO, SILENCIOSO / RUIDOSO, INFANTIL / ADULTO, LOCAL / GLOBAL, ANTIGUO / MODERNO, SIMPLE / COMPLICADO, MALA IDEA / BUENA IDEA, EXAGERADO / REALISTA, TÓXICO / SANO, VERGONZOSO / ORGULLOSO, INNECESARIO / ESENCIAL, DE POBRES / DE RICOS, FLOJO / DIFÍCIL, FALSO / AUTÉNTICO, PACÍFICO / AGRESIVO, TRANQUILO / CAÓTICO, PREVISIBLE / SORPRENDENTE, FRACASO / ÉXITO, EDUCATIVO / ENTRETENIMIENTO PURO, DE NICHO / MAINSTREAM, HORRIBLE OLOR / BUEN OLOR, MALA SUERTE / BUENA SUERTE, POCO ROMÁNTICO / MUY ROMÁNTICO, CUTRE / LUJOSO, RÁPIDO DE OLVIDAR / INOLVIDABLE, SANO / ADICTIVO (comida), MOVIDA DE VIEJOS / MOVIDA DE JÓVENES, DE MAL GUSTO / ELEGANTE.

Puedes añadir más luego fácilmente porque estará en un array separado.

---

## DISEÑO VISUAL (mínimo pero cuidado)

- Fondo oscuro (`#111` o similar), texto claro, un color de acento único (ej. un naranja o verde) para botones y la marca del slider.
- Tipografía del sistema (`font-family: -apple-system, sans-serif`), tamaños grandes y legibles pensando en móvil.
- El slider del dial: una barra horizontal larga con las dos etiquetas del espectro en cada extremo, un marcador circular que se arrastra con el dedo/ratón. Cuando se revela, mostrar además zonas de color (bullseye/anillos) superpuestas para que se entienda visualmente la puntuación.
- Nada de imágenes externas ni fuentes de Google Fonts (para evitar dependencias de red y que cargue rápido).

---

## DESPLIEGUE EN RENDER

- `package.json` con:
  - `"scripts": { "start": "node server.js" }`
  - `"engines": { "node": ">=18" }`
- El servidor debe escuchar en `process.env.PORT || 3000`.
- No usar variables de entorno adicionales ni servicios externos: debe funcionar con solo pulsar "Deploy" en Render como Web Service apuntando al repo, build command `npm install`, start command `npm start`.
- Incluye un `README.md` corto con instrucciones: cómo correrlo en local (`npm install && npm start`) y cómo desplegarlo en Render.

---

## ENTREGABLES QUE ESPERO DE TI (Claude Code)

1. Todos los archivos funcionando end-to-end (crear sala → unirse → jugar ronda completa → puntuación → siguiente ronda → fin de partida).
2. Prueba tú mismo el flujo completo simulando varios clientes si es posible antes de darlo por terminado.
3. Código comentado en español, simple de leer, sin sobre-ingeniería.
4. No añadas autenticación, base de datos, ni funcionalidades fuera de lo descrito aquí. Prioriza que funcione perfecto para lo pedido antes que añadir extras.
