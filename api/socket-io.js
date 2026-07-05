// Vercel Function hosting the Socket.IO game server.
// See https://vercel.com/docs/functions/websockets
const { createServer } = require('http');
const { Server } = require('socket.io');
const { attachGameServer } = require('../lib/game-server');

const server = createServer();

// Socket.IO appends /socket.io to its path, so clients connect with
// path: '/api/socket-io/socket.io' (same as the local server in server.js).
const io = new Server(server, { path: '/api/socket-io/socket.io' });

attachGameServer(io);

module.exports = server;
