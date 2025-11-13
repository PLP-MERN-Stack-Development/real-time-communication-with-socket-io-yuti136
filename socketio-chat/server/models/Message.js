// server/models/Message.js
const mongoose = require("mongoose");

const reactionSchema = new mongoose.Schema(
  {
    userId: { type: String },
    type: { type: String },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema({
  message: { type: String, required: true },
  sender: { type: String, required: true },
  senderId: { type: String, required: true },
  to: { type: String, default: null },
  room: { type: String, default: "global" },
  isPrivate: { type: Boolean, default: false },
  meta: { type: Object, default: {} },
  timestamp: { type: Date, default: Date.now },
  readBy: { type: [String], default: [] },
  reactions: { type: [reactionSchema], default: [] },
});

// ✅ Important: prevent model overwrite errors during dev hot reload
module.exports = mongoose.models.Message || mongoose.model("Message", messageSchema);
