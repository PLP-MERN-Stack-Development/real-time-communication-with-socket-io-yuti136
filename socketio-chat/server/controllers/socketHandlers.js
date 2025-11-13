// server/controllers/socketHandlers.js
const { log } = require('../utils/logger');
const { verifyToken } = require('./authController');

// In-memory stores (dev)
const users = {};         // socketId -> { username, id }
const socketsByUser = {}; // username -> Set(socketId)
const messages = [];      // message objects
const typingUsers = {};   // socketId -> username
const rooms = { global: new Set() }; // roomId -> Set(socketId)

// timestamp helper
const toISO = (ts = Date.now()) => new Date(ts).toISOString();

function createMessage({ text, sender, senderId, roomId = 'global', isPrivate = false, toUser = null, fileUrl = null }) {
  return {
    id: Date.now() + '_' + Math.random().toString(36).slice(2,8),
    text: text || null,
    fileUrl: fileUrl || null,
    sender,
    senderId,
    roomId,
    isPrivate,
    toUser,
    timestamp: toISO(),
    readBy: [],
    reactions: {}
  };
}

function getUserList() {
  const seen = new Set();
  const list = [];
  for (const sid in users) {
    const u = users[sid];
    if (!seen.has(u.username)) {
      seen.add(u.username);
      list.push({ username: u.username, id: u.id });
    }
  }
  return list;
}

function registerUser(socket, username, io, viaJWT = false) {
  users[socket.id] = { username, id: socket.id };
  socketsByUser[username] = socketsByUser[username] || new Set();
  socketsByUser[username].add(socket.id);

  socket.join('global');
  rooms.global.add(socket.id);

  // emit presence and notifications
  io.emit('user_joined', { username, id: socket.id });
  io.emit('user_list', getUserList());
  io.emit('notification', { type: 'join', username });

  log(`${username} ${viaJWT ? '(JWT)' : ''} joined via socket ${socket.id}`);
}

function handleSocketConnection(io, socket) {
  log('Socket connected:', socket.id);

  // JWT handshake may provide token
  const token = socket.handshake.auth?.token;
  if (token) {
    const payload = verifyToken(token);
    if (payload?.username) {
      registerUser(socket, payload.username, io, true);
    } else {
      log('Invalid token on handshake for socket', socket.id);
    }
  }

  // user_join for non-JWT login
  socket.on('user_join', (username) => {
    if (!username) return;
    registerUser(socket, username, io, false);
  });

  // join_room
  socket.on('join_room', ({ roomId }) => {
    if (!roomId) return;
    socket.join(roomId);
    rooms[roomId] = rooms[roomId] || new Set();
    rooms[roomId].add(socket.id);
    io.to(roomId).emit('room_joined', { roomId, socketId: socket.id });
    io.emit('notification', { type: 'room_join', roomId, socketId: socket.id });
    log(`${socket.id} joined room ${roomId}`);
  });

  // leave_room
  socket.on('leave_room', ({ roomId }) => {
    if (!roomId) return;
    socket.leave(roomId);
    rooms[roomId]?.delete(socket.id);
    io.to(roomId).emit('room_left', { roomId, socketId: socket.id });
  });

  // send_message (public or room)
  socket.on('send_message', (payload, ack) => {
    const user = users[socket.id];
    if (!user) return typeof ack === 'function' && ack({ status: 'error', reason: 'not_authenticated' });

    const msg = createMessage({
      text: payload.text,
      sender: user.username,
      senderId: socket.id,
      roomId: payload.roomId || 'global',
      fileUrl: payload.fileUrl || null
    });

    messages.push(msg);
    if (messages.length > 2000) messages.shift();

    io.to(msg.roomId).emit('receive_message', msg);

    // delivery ack
    if (typeof ack === 'function') ack({ status: 'ok', id: msg.id, timestamp: msg.timestamp });

    // notification
    io.emit('notification', { type: 'message', roomId: msg.roomId, messageId: msg.id });
  });

  // private_message
  socket.on('private_message', ({ to, text, fileUrl }, ack) => {
    const from = users[socket.id];
    if (!from) return typeof ack === 'function' && ack({ status: 'error', reason: 'not_authenticated' });

    const msg = createMessage({
      text,
      sender: from.username,
      senderId: socket.id,
      isPrivate: true,
      toUser: to,
      fileUrl: fileUrl || null
    });

    messages.push(msg);

    // send to recipient sockets
    const recSockets = socketsByUser[to] || new Set();
    for (const sid of recSockets) io.to(sid).emit('private_message', msg);

    // echo to sender
    socket.emit('private_message', msg);

    if (typeof ack === 'function') ack({ status: 'ok', id: msg.id });

    // notification to recipient(s)
    for (const sid of recSockets) io.to(sid).emit('notification', { type: 'private_message', messageId: msg.id, from: from.username });
  });

  // typing indicator
  socket.on('typing', ({ roomId = 'global', isTyping }) => {
    const u = users[socket.id];
    if (!u) return;
    if (isTyping) typingUsers[socket.id] = u.username;
    else delete typingUsers[socket.id];

    io.to(roomId).emit('typing_users', Object.values(typingUsers));
  });

  // message_read
  socket.on('message_read', ({ messageId, username }) => {
    const m = messages.find((mm) => mm.id === messageId);
    if (!m) return;
    if (!m.readBy.includes(username)) m.readBy.push(username);

    // notify relevant parties
    if (m.isPrivate) {
      const senderSockets = socketsByUser[m.sender] || [];
      senderSockets.forEach((sid) => io.to(sid).emit('message_read', { messageId, username }));
    } else {
      io.to(m.roomId || 'global').emit('message_read', { messageId, username });
    }
  });

  // message_reaction
  socket.on('message_reaction', ({ messageId, reaction, username }) => {
    const m = messages.find((mm) => mm.id === messageId);
    if (!m) return;
    m.reactions[reaction] = m.reactions[reaction] || [];
    const idx = m.reactions[reaction].indexOf(username);
    if (idx === -1) m.reactions[reaction].push(username);
    else m.reactions[reaction].splice(idx, 1);

    // broadcast reaction update
    if (m.isPrivate) {
      const recSockets = socketsByUser[m.toUser] || [];
      const senderSockets = socketsByUser[m.sender] || [];
      [...recSockets, ...senderSockets].forEach((sid) => io.to(sid).emit('message_reaction', { messageId, reaction, username }));
    } else {
      io.to(m.roomId).emit('message_reaction', { messageId, reaction, username });
    }
  });

  // pagination request: load older messages for a room or private chat
  socket.on('load_older', ({ roomId = 'global', beforeId, limit = 20 }, ack) => {
    // very simple in-memory pagination: find index of beforeId, return previous items
    let list = messages.filter((m) => m.roomId === roomId && !m.isPrivate);
    if (beforeId) {
      const idx = list.findIndex((m) => m.id === beforeId);
      list = idx === -1 ? list.slice(-limit) : list.slice(Math.max(0, idx - limit), idx);
    } else {
      list = list.slice(-limit);
    }
    if (typeof ack === 'function') ack({ status: 'ok', messages: list });
  });

  // disconnect
  socket.on('disconnect', (reason) => {
    const u = users[socket.id];
    if (u) {
      const username = u.username;
      socketsByUser[username]?.delete(socket.id);
      if (socketsByUser[username]?.size === 0) delete socketsByUser[username];
      delete users[socket.id];
      delete typingUsers[socket.id];
      Object.values(rooms).forEach((set) => set.delete(socket.id));
      io.emit('user_left', { username, id: socket.id });
      io.emit('user_list', getUserList());
      io.emit('typing_users', Object.values(typingUsers));
      log(`${username} disconnected: ${reason}`);
    } else {
      log('Socket disconnected (no user):', socket.id);
    }
  });
}

module.exports = { handleSocketConnection, users, messages, typingUsers, getUserList };
