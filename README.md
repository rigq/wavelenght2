# Wavelength (web multijugador)

Versión web sencilla del juego de mesa **Wavelength**, pensada para jugar con
amigos mientras habláis por Discord. Un equipo intenta leer la mente de su
"psíquico" colocando un marcador en un dial; el equipo rival apuesta si el
objetivo real está a la izquierda o a la derecha.

No necesita base de datos ni integración con Discord: es una web normal que
corre en el navegador (móvil u ordenador).

## Cómo jugar

1. Alguien pulsa **Crear sala** y comparte el código de 4 letras.
2. El resto entra con **Unirse** usando ese código.
3. Con mínimo **4 jugadores**, el host pulsa **Empezar partida** (se forman
   automáticamente el Equipo A y el Equipo B).
4. Cada ronda:
   - El **psíquico** del equipo activo ve la posición oculta del objetivo y
     escribe una pista.
   - Su equipo mueve el marcador y **confirma** una posición.
   - El **equipo rival** apuesta izquierda/derecha (primer voto gana, 20s máx).
   - Se revela el objetivo y se reparten puntos.
5. Gana el primer equipo en llegar a **10 puntos**.

### Puntuación
- Equipo activo (según distancia al objetivo): ≤3 → 4 pts, ≤6 → 3 pts,
  ≤10 → 2 pts, >10 → 0 pts.
- Equipo rival: +1 punto si acierta el lado.

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
- `WINNING_SCORE` (puntos para ganar, por defecto 10)
- `MIN_PLAYERS` (mínimo para empezar, por defecto 4)
- `RIVAL_VOTE_TIMEOUT` (segundos de voto rival, por defecto 20)

Los espectros están en `categories.js` — añade más pares `{ left, right }`.
