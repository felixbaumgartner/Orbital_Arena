// Vercel Function hosting the Socket.IO game server.
// See https://vercel.com/docs/functions/websockets
const { createServer } = require('http');
const { Server } = require('socket.io');
const { attachGameServer } = require('../lib/game-server');

// Default handler for non-Socket.IO requests (also aids debugging —
// without it the bare server would hang and 504 on plain HTTP hits).
const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, url: req.url }));
});

// Socket.IO is mounted at exactly /api/socket-io (requests go to
// /api/socket-io/?EIO=4...). Deeper subpaths like /api/socket-io/socket.io
// are NOT routed to this function by Vercel, so the path must stay flat.
const io = new Server(server, { path: '/api/socket-io' });

attachGameServer(io);

module.exports = server;
