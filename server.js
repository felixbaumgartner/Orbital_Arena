const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { attachGameServer, GAME_CONFIG } = require('./lib/game-server');

const app = express();
const httpServer = createServer(app);

// Same Socket.IO path as the Vercel Function (api/socket-io.js) so the
// client connects identically in local dev and production.
const io = new Server(httpServer, { path: '/api/socket-io/socket.io' });

// Debug logs for static file serving
console.log('Current working directory:', process.cwd());
console.log('Public directory path:', path.join(process.cwd(), 'public'));

// Serve static files
app.use(express.static('public'));

// Debug route to check if Express is working
app.get('/debug', (req, res) => {
  res.send('Express server is working');
});

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log('Request URL:', req.url);
  console.log('Request method:', req.method);
  next();
});

// Attach all game state and socket handlers
attachGameServer(io);

// Error handling for the server
httpServer.on('error', (error) => {
  console.error('Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`
═══════════════════════════════════════
  Orbital Arena Server
  Port: ${PORT}
  Environment: ${process.env.NODE_ENV || 'development'}
  Max players per game: ${GAME_CONFIG.PLAYERS_PER_GAME}
  Match duration: ${GAME_CONFIG.MATCH_DURATION / 1000}s
═══════════════════════════════════════
  `);
});
