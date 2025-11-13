const { Server } = require('socket.io');
const { handleSocketConnection } = require('./controllers/socketHandlers');
const { log } = require('./utils/logger');
const config = require('./config');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.clientUrl || '*',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.on('connection', (socket) => handleSocketConnection(io, socket));
  io.on('error', (err) => log('Socket.io error:', err));
  log('Socket.io initialized');
  return io;
}

module.exports = { initSocket };
