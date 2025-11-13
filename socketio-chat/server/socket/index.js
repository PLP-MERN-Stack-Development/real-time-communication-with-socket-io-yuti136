const { Server } = require("socket.io");
const { handleSocketConnection } = require("../controllers/socketHandlers");
const config = require("../config");

function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: config.clientUrl,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => handleSocketConnection(io, socket));

  return io;
}

module.exports = { initSocket };
