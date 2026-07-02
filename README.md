# Wavelength (web multijugador)

Versión web sencilla del juego de mesa **Wavelength**, pensada para jugar con
amigos mientras habláis por Discord. Un equipo intenta leer la mente de su
"psíquico" colocando un marcador en un dial; el equipo rival apuesta si el
objetivo real está a la izquierda o a la derecha.

No necesita base de datos ni integración con Discord: es una web normal que
corre en el navegador (móvil u ordenador).

## Modos de juego

En el lobby, el host elige uno de los dos modos antes de empezar:

- **🎯 Dial (espectro):** el modo clásico por equipos, con dial semicircular.
- **🔢 Número (1-10):** variante cooperativa, un jugador adivina un número.

## Modo Dial

1. Alguien pulsa **Crear sala** y comparte el código de 4 letras.
2. El resto entra con **Unirse** usando ese código.
3. Con mínimo **4 jugadores**, el host pulsa **Empezar partida** (se forman
   automáticamente el Equipo A y el Equipo B).
4. Cada ronda:
   - El **psíquico** del equipo activo ve la posición oculta del objetivo y
     escribe una pista.
   - Su equipo mueve la aguja del dial y **confirma** una posición.
   - El **equipo rival** apuesta izquierda/derecha (primer voto gana, 20s máx).
   - Se revela el objetivo y se reparten puntos.
5. Gana el primer equipo en llegar a **10 puntos**.

### Puntuación (dial)
- Equipo activo (según distancia al objetivo): ≤3 → 4 pts, ≤6 → 3 pts,
  ≤10 → 2 pts, >10 → 0 pts.
- Equipo rival: +1 punto si acierta el lado.

## Modo Número (1-10)

Cooperativo, mínimo **3 jugadores**. Cada ronda un jugador es el **adivinador**
y no ve el número; el resto ve un número secreto del 1 al 10.

1. El adivinador pregunta categorías en voz por Discord ("¿bebidas?",
   "¿películas?").
2. Cada compañero responde con un ejemplo que represente ese número
   (p. ej. una bebida que sea un "8"). 1 = mínimo, 10 = máximo.
3. Con esas pistas, el adivinador elige un número en el pad 1-10 y confirma.
4. Se revela el número real y **todo el grupo** suma puntos.
5. Cada jugador es adivinador una vez; al final se muestra la puntuación total
   del grupo.

### Puntuación (número, cooperativa)
Según la distancia entre la adivinanza y el número real: exacto → 3 pts,
±1 → 2 pts, ±2 → 1 pt, más lejos → 0.

## Correr en local

Necesitas Node.js >= 18.

```bash
npm install
npm start
```

Abre `http://localhost:3000` en varias pestañas/dispositivos para simular
jugadores.

## Desplegar en Render.com

1. Sube este repositorio a GitHub.
2. En Render, crea un **Web Service** apuntando al repo.
3. Configura:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
4. Render asigna el puerto vía `process.env.PORT` (ya contemplado en el código).
5. Deploy y ¡a jugar!

## Configuración rápida

En `server.js` puedes cambiar constantes fáciles:
- `WINNING_SCORE` (puntos para ganar en modo dial, por defecto 10)
- `MIN_PLAYERS` (mínimo para empezar en modo dial, por defecto 4)
- `MIN_PLAYERS_NUMBER` (mínimo para el modo número, por defecto 3)
- `RIVAL_VOTE_TIMEOUT` (segundos de voto rival, por defecto 20)

Los espectros están en `categories.js` — añade más pares `{ left, right }`.
