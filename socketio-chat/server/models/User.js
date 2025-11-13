// server/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  clerkId: { type: String, required: true, unique: true }, // Clerk userId (or username if using simple auth)
  username: { type: String, required: true },
  socketId: { type: String, default: null },
  online: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);
