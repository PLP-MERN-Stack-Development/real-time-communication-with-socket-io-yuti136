// server/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const { Clerk } = require('@clerk/clerk-sdk-node');

const Message = require('./models/Message');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/myChatApp';
const CLERK_SECRET = process.env.CLERK_SECRET_KEY || process.env.CLERK_SECRET || null;

const clerk = CLERK_SECRET ? new Clerk({ secretKey: CLERK_SECRET }) : null;

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// In-memory map for connected users
const users = {}; // socketId => { clerkId, username, id, room }

// ---- Routes ----

// Unified recent messages route
app.get("/api/messages/recent", async (req, res) => {
  try {
    const room = req.query.room || "global";
    const messages = await Message.find({ room })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();
    res.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List users
app.get('/api/users', async (req, res) => {
  try {
    const list = await User.find().lean();
    res.json(list);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Clerk-based socket authentication middleware
 */
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next();

  if (!clerk) {
    console.warn('⚠️ Clerk not configured — skipping verification');
    return next();
  }

  try {
    const verified = await clerk.sessions.verifyToken(token);
    const userId = verified.userId || verified.sub || verified.subject;
    socket.user = { clerkId: userId };

    try {
      const user = await clerk.users.getUser(userId);
      socket.user.username =
        user.fullName || user.username || user.primaryEmailAddress?.emailAddress || userId;
    } catch {
      socket.user.username = userId;
    }

    return next();
  } catch (err) {
    console.error('❌ Clerk token verify failed:', err.message || err);
    return next(new Error('Unauthorized'));
  }
});

// ---- SOCKET HANDLERS ----
io.on('connection', async (socket) => {
  console.log(`⚡ Socket connected: ${socket.id}`, socket.user ? `(user: ${socket.user.username})` : '');

  // Register or update Clerk user
  if (socket.user && socket.user.clerkId) {
    const { clerkId, username } = socket.user;
    users[socket.id] = { clerkId, username, id: socket.id, room: 'global' };

    try {
      await User.findOneAndUpdate(
        { clerkId },
        { username, socketId: socket.id, online: true, lastSeen: new Date() },
        { upsert: true, new: true }
      );

      const onlineUsers = await User.find({ online: true }).lean();
      io.emit('user_list', onlineUsers);
      io.emit('user_joined', { username, id: socket.id });
    } catch (err) {
      console.error('Error registering user:', err);
    }
  }

  // Guest join
  socket.on('user_join', async (username) => {
    const name = username?.trim() || `Anon-${socket.id.slice(0, 5)}`;
    users[socket.id] = { clerkId: null, username: name, id: socket.id, room: 'global' };

    try {
      await User.findOneAndUpdate(
        { clerkId: `guest:${socket.id}` },
        { clerkId: `guest:${socket.id}`, username: name, socketId: socket.id, online: true, lastSeen: new Date() },
        { upsert: true, new: true }
      );

      io.emit('user_list', await User.find({ online: true }).lean());
      io.emit('user_joined', { username: name, id: socket.id });
    } catch (err) {
      console.error('Error on guest join:', err);
    }
  });

  // Join room
  socket.on('join_room', (roomName) => {
    const room = roomName || 'global';
    socket.join(room);
    socket.currentRoom = room;
    if (users[socket.id]) users[socket.id].room = room;

    console.log(`📥 ${socket.id} joined room ${room}`);

    // Send room user list
    const roomUsers = Object.values(users).filter(u => u.room === room);
    io.to(room).emit('user_list', roomUsers);
  });

  // Send message (room or global)
  socket.on('send_message', async (msgData = {}) => {
    try {
      const room = socket.currentRoom || msgData.room || 'global';
      const senderName = users[socket.id]?.username || socket.user?.username || 'Anonymous';
      const messageObj = {
        message: msgData.message || '',
        sender: senderName,
        senderId: socket.user?.clerkId || socket.id,
        room,
        isPrivate: !!msgData.isPrivate,
        to: msgData.to || null,
        meta: msgData.meta || {}, // file/image metadata
        timestamp: new Date(),
        readBy: [],
        reactions: [],
      };

      const saved = await Message.create(messageObj);
      io.to(room).emit('receive_message', saved);
    } catch (err) {
      console.error('send_message error:', err);
    }
  });

  // Private message
  socket.on('private_message', async ({ to, message }) => {
    if (!to || !message) return;
    const senderName = users[socket.id]?.username || socket.user?.username || 'Anonymous';
    const msg = {
      message,
      sender: senderName,
      senderId: socket.user?.clerkId || socket.id,
      to,
      room: `pm:${socket.id}:${to}`,
      isPrivate: true,
      timestamp: new Date(),
    };

    try {
      const saved = await Message.create(msg);
      socket.emit('private_message', saved);
      io.to(to).emit('private_message', saved);
    } catch (err) {
      console.error('private_message error', err);
    }
  });

  // Typing indicator (per room)
  socket.on('typing', (isTyping) => {
    const room = socket.currentRoom || 'global';
    const user = users[socket.id] || socket.user;
    if (!user) return;

    if (isTyping) {
      socket.to(room).emit('typing_users_update', {
        socketId: socket.id,
        username: user.username,
      });
    } else {
      socket.to(room).emit('typing_users_cleared', { socketId: socket.id });
    }
  });

  // Fetch recent messages
  socket.on('get_recent_messages', async (room = 'global') => {
    try {
      const recent = await Message.find({ room }).sort({ timestamp: 1 }).limit(200).lean();
      socket.emit('receive_recent_messages', recent);
    } catch (err) {
      console.error('get_recent_messages error', err);
    }
  });

  // Read receipts
  socket.on('message_read', async (messageId) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg) return;
      const userId = socket.user?.clerkId || socket.id;
      if (!msg.readBy.includes(userId)) {
        msg.readBy.push(userId);
        await msg.save();
        io.emit('message_read', { messageId, userId });
      }
    } catch (err) {
      console.error('message_read error', err);
    }
  });

  // Reactions
  socket.on('add_reaction', async ({ messageId, type }) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg) return;
      const userId = socket.user?.clerkId || socket.id;
      msg.reactions.push({ userId, type });
      await msg.save();
      io.emit('reaction_added', { messageId, type, userId });
    } catch (err) {
      console.error('add_reaction error', err);
    }
  });

  // Disconnect
  socket.on('disconnect', async () => {
    const user = users[socket.id];
    if (user) {
      try {
        await User.findOneAndUpdate(
          { clerkId: user.clerkId || `guest:${socket.id}` },
          { online: false, socketId: null, lastSeen: new Date() }
        );
        io.to(user.room || 'global').emit('user_left', user);
      } catch (err) {
        console.error('disconnect error', err);
      }
      delete users[socket.id];
      io.emit('user_list', await User.find({ online: true }).lean());
    }

    console.log(`❌ Socket disconnected: ${socket.id}`);
  });
});

// ---- Start server ----
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
