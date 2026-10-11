# Orbital Arena — Dutch Village Flight

A multiplayer flight-combat game over an endless, living Dutch landscape: tulip fields, canals, brick villages, windmills and wind farms. Capture windmills with your team and shoot down rival pilots (AI bots fill empty seats).

## Features

### Combat
- Real-time multiplayer dogfights (Socket.IO) with AI bots
- Three plane classes with distinct roles: Interceptor (4 heat-seeking missiles, fast lock), Scout (2 missiles, sees further), Bomber (6 bombs, tough, captures fast)
- Heat-seeking missiles with a seeker ring that tightens as it locks, growl and lock tones; lead-pursuit guidance on the server, so a hard early break can still beat one
- Flares for everyone: decoy incoming missiles; a MISSILE warning with a direction arrow and proximity beeps
- Bombs splash low-flying enemies and knock an enemy windmill's hold down (or neutralise it); bomb sight for bombers
- Bots use missiles, pop flares when targeted, and bombers bomb enemy windmills
- Lead indicator, target lock bracket with health, magnetic aim assist and bright tracers
- Two modes: Windmill Domination and Team Deathmatch (first to 30), best-of-three rounds with intermission and sudden death
- Killstreak rewards: radar sweep at 3, wingman escort at 5, airstrike at 7

### Spectacle
- Kill cam: when you're shot down, the last seconds replay over your killer's shoulder, slowing at the kill; skip to respawn sooner
- Slow-motion final kill at the end of a round, and a Play of the Match before the results
- Explosions with fireballs, smoke plumes, sparks and flash lights; shot-down planes break apart (a wing tears off, the prop flies away) and fall burning, then smoulder on the ground
- Recorded sound: real gunfire, explosions, metal impacts and rocket motors, positioned in 3D with distance muffling and travel delay; synthesized piston engines with doppler for every nearby plane and a whoosh on close passes
- Adaptive music that swells into a combat track when the fight is on, an announcer (countdown, rounds, sudden death, multi kill, win/lose) and wingman radio calls
- Sky reflections on planes and water, ambient occlusion (Ultra), sun rays (High/Ultra), speed blur, filmic tone mapping and bloom
- Cockpit view with live instrument dials, plus look-back and free look
- Full day/night cycle, dynamic weather (rain, fog, storms with lightning), cloud shadows, procedural textures

### Progression
- XP, levels and ranks from Cadet to Ace; medals (Double Kill, Triple Kill, First Blood, Revenge, Long Shot, Comeback)
- Three daily challenges, a lifetime career record, and cosmetic unlocks by level (paint schemes, contrails, a stork wingman)
- Optional cloud pilot profiles and a global leaderboard (see "Pilot records" below); a pilot code moves your progress to another device

### Platform
- Keyboard + mouse, controllers (standard mapping, rumble), and touch (thumbstick plus FIRE / BOOST / ROLL / MSL / FLR / BMB)
- Four graphics quality presets
- Seamless connection handover: the client swaps to a fresh connection before a serverless host's WebSocket limit (and on drops or stalls) and resumes the same match

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the client and start the server:
   ```bash
   npm run build
   npm start
   ```
3. Open `http://localhost:5000`

For development, `npm run dev` restarts the server on changes and `npm run dev:client` serves the client with hot reload (Vite) on port 5173, proxying the game socket to the server.

## Controls

| Action | Keyboard / mouse | Controller |
| --- | --- | --- |
| Steer | Mouse (click the world to grab it), A / D | Left stick |
| Climb / dive | ↑ / ↓ | Left stick (Invert Y in settings) |
| Throttle | W / S | D-pad up / down |
| Boost | Shift | LT |
| Guns | Space or left mouse | RT |
| Missile (when locked) | F | RB |
| Flares | G | LB |
| Bomb (Bomber) | B | X |
| Barrel roll | R | A |
| Cockpit / chase view | V | Y |
| Look back | Z (hold) | B (hold) |
| Look around | | Right stick |
| Scoreboard | Tab (hold) | View (hold) |
| Settings | Esc | Start |
| Photo mode / screenshot | P / C | |
| Skip a replay | Space | A |

## Development

- Client: Three.js, built with Vite (`src/client`). The `Game` class is assembled from method groups in `src/client/game/*.js`; newer systems are TypeScript modules: `audio/`, `fx/`, `render/`, `replay/`, `input/`.
- Server: Express + Socket.IO (`server.js` locally, `api/socket-io.js` on Vercel), game logic in `lib/game-server.js`, weapons in `lib/weapons.js`, pilot records in `lib/persistence.js`.
- `npm run check` fails on any undefined name in the client and type-checks the TypeScript modules.
- Sound and music sources and licences: see `CREDITS.md`.

### Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server | Turn on cloud pilot profiles and the leaderboard |
| `PILOT_STORE_FILE` | Server (local dev) | Keep pilot records in a JSON file instead |
| `VITE_GAME_SERVER_URL` | Client build | Connect to an always-on game server instead of the same origin |
| `MATCH_SECONDS`, `INTERMISSION_SECONDS` | Server | Shorter rounds for testing |

### Pilot records (optional)

1. Create a free Supabase project.
2. Run `supabase/schema.sql` in its SQL editor.
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as Vercel environment variables (server-side only) and redeploy.

Without them the game keeps progress in the browser, and the login screen says so.

### Hosting notes

On Vercel the game server runs as a Function with WebSockets. Each connection lasts at most the function's `maxDuration` (300 s here), so clients hand over to a fresh connection after 4 minutes and resume their match. A serverless instance only holds the matches of the players connected to it, so two humans may not always land in the same match. For guaranteed shared matches, run `server.js` on an always-on host and point the client at it with `VITE_GAME_SERVER_URL`.

## License

MIT. Third-party sounds and music keep their own licences (CC0 and CC BY 4.0, see `CREDITS.md`).
