# Orbital Arena — Dutch Village Flight

A multiplayer flight-combat game over an endless, living Dutch landscape: tulip fields, canals, brick villages, windmills and wind farms. Capture windmills with your team and shoot down rival pilots (AI bots fill empty seats).

## Features

- Real-time multiplayer dogfights (Socket.IO) with AI bots
- Infinite procedurally generated terrain with village, farmland and waterland biomes
- Full day/night cycle: moving sun, golden hour, starry nights, moon, lit windows and street lamps
- Dynamic weather with drifting clouds, cloud shadows, rain, fog and lightning storms
- Procedural textures (grass, soil, brick, roof tiles, asphalt, water) — no image assets
- Post-processing bloom and four graphics quality presets
- Cockpit HUD: compass tape with objective bearings, artificial horizon, terrain warning, radar
- Capture-the-windmill objective mode, tulip power-ups, barrel rolls
- Photo mode with screenshot capture, landmark discovery toasts, in-game chat

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Open your browser and navigate to `http://localhost:3000`

## Controls

- A / D: Bank left and right
- ↑ / ↓: Climb and dive
- W / S: Throttle up and down
- Shift: Boost (drains energy)
- Space: Shoot
- R: Barrel roll
- Esc: Settings (graphics quality, bloom, time of day, FPS counter)
- P: Photo mode (cinematic orbit, HUD hidden)
- C: Save a screenshot
- M: Mute
- Enter: Chat

## Development

- Built with Three.js for 3D rendering (client code in `src/client`, scenery systems in `src/client/scenery`, HUD widgets in `src/client/ui`)
- Socket.IO for real-time multiplayer
- Express for the server
- Webpack for bundling

## Contributing

Feel free to submit issues and pull requests.

## License

MIT 