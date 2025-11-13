// client/src/socket/socket.js
import { io } from "socket.io-client";
import { useEffect, useState, useRef } from "react";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

export const useSocket = (userId) => {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [currentRoom, setCurrentRoom] = useState("global");
  const [unread, setUnread] = useState({});
  const typingTimeouts = useRef({});
  const pageSize = 20;
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  /** ---------------------------
   * SOCKET CONNECTION
   * --------------------------- */
  const connect = () => {
    if (!userId) return;
    socket.auth = { userId }; // send userId to server
    socket.connect();
  };

  const disconnect = () => socket.disconnect();

  /** ---------------------------
   * ROOMS + MESSAGING
   * --------------------------- */
  const joinRoom = (room) => {
    setCurrentRoom(room);
    setPage(0);
    setHasMore(true);
    socket.emit("join_room", room);
    loadMessages(room, 0);
    setUnread((prev) => ({ ...prev, [room]: 0 }));
  };

  const sendMessage = (payload) => {
    if (!payload.message?.trim()) return;
    const msg = {
      ...payload,
      room: currentRoom,
      timestamp: new Date().toISOString(),
      senderId: userId,
      status: "sent",
    };
    setMessages((prev) => [...prev, msg]);
    socket.emit("send_message", msg);
  };

  const sendPrivateMessage = (toSocketId, message) => {
    if (!message?.trim()) return;
    const msg = {
      to: toSocketId,
      message,
      timestamp: new Date().toISOString(),
      senderId: userId,
      status: "sent",
    };
    setMessages((prev) => [...prev, msg]);
    socket.emit("private_message", msg);
  };

  const setTyping = (isTyping) => {
    socket.emit("typing", { isTyping, room: currentRoom });
  };

  const markRead = (messageId) => {
    if (!messageId) return;
    socket.emit("message_read", { messageId });
  };

  const addReaction = (messageId, type) => {
    if (!messageId) return;
    socket.emit("add_reaction", { messageId, type });
  };

  const loadMessages = (room, pg) => {
    socket.emit("get_messages_page", { room, page: pg, pageSize });
  };

  /** ---------------------------
   * EVENT HANDLERS
   * --------------------------- */
  useEffect(() => {
    const handleNewMessage = (msg) => {
      setMessages((prev) => [...prev, msg]);

      if (msg.senderId !== userId && msg.room !== currentRoom) {
        setUnread((prev) => ({ ...prev, [msg.room]: (prev[msg.room] || 0) + 1 }));
      }
    };

    const handleTyping = ({ socketId, username, isTyping }) => {
      setTypingUsers((prev) => {
        if (isTyping) {
          if (!prev.includes(username)) return [...prev, username];
          return prev;
        } else return prev.filter((u) => u !== username);
      });

      if (isTyping) {
        clearTimeout(typingTimeouts.current[socketId]);
        typingTimeouts.current[socketId] = setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u !== username));
        }, 3000);
      }
    };

    const handleStatusUpdate = ({ messageId, status }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m._id === messageId || m.id === messageId ? { ...m, status } : m
        )
      );
    };

    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));

    socket.on("receive_message", handleNewMessage);
    socket.on("private_message", (msg) => handleNewMessage({ ...msg, isPrivate: true }));

    socket.on("messages_page", ({ messages: msgs, page: pg }) => {
      if (!msgs.length) setHasMore(false);
      setMessages((prev) => [...msgs, ...prev]);
      setPage(pg);
    });

    socket.on("message_delivered", ({ messageId }) =>
      handleStatusUpdate({ messageId, status: "delivered" })
    );
    socket.on("message_read", ({ messageId }) =>
      handleStatusUpdate({ messageId, status: "read" })
    );

    socket.on("user_list", setUsers);
    socket.on("user_joined", (u) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          system: true,
          message: `${u.username} joined the chat.`,
          timestamp: new Date().toISOString(),
        },
      ]);
    });
    socket.on("user_left", (u) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          system: true,
          message: `${u.username} left the chat.`,
          timestamp: new Date().toISOString(),
        },
      ]);
    });
    socket.on("user_typing", handleTyping);

    socket.on("reaction_added", ({ messageId, type, userId }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m._id === messageId || m.id === messageId
            ? { ...m, reactions: [...(m.reactions || []), { userId, type }] }
            : m
        )
      );
    });

    return () => socket.off();
  }, [currentRoom, userId]);

  return {
    socket,
    isConnected,
    messages,
    users,
    typingUsers,
    currentRoom,
    unread,
    connect,
    disconnect,
    joinRoom,
    sendMessage,
    sendPrivateMessage,
    setTyping,
    markRead,
    addReaction,
    loadMessages,
    page,
    hasMore,
    userId,
  };
};

export default socket;
