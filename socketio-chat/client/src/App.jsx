// client/src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import { useSocket } from "./socket/socket";

// shadcn UI
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

function ChatApp({ userId }) {
  const {
    connect,
    disconnect,
    isConnected,
    messages,
    users,
    typingUsers,
    currentRoom,
    joinRoom,
    sendMessage,
    sendPrivateMessage,
    setTyping,
    unread,
    loadMessages,
    page,
    hasMore,
  } = useSocket(userId); // pass userId to the hook

  const [room, setRoom] = useState("global");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef(null);
  const scrollRef = useRef(null);
  const loadingOlderRef = useRef(false);

  /** SOCKET CONNECTION */
  useEffect(() => {
    connect();
    return () => disconnect();
  }, []);

  /** SCROLL TO BOTTOM */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /** HANDLE SENDING MESSAGES */
  const handleSend = () => {
    if (!draft.trim()) return;
    if (selectedUserId) sendPrivateMessage(selectedUserId, draft.trim());
    else sendMessage({ message: draft.trim(), room });

    setDraft("");
    setTyping(false);
  };

  /** RENDER MESSAGE */
  const renderMessage = (m) => {
    const isSystem = m.system;
    const isOwn = m.senderId === userId;
    const status = m.status || "sent";

    return (
      <div
        key={m._id || m.id || Math.random()}
        className={`flex flex-col mb-2 ${isOwn ? "items-end" : "items-start"}`}
      >
        <Card
          className={`p-3 max-w-[70%] shadow ${
            isSystem
              ? "bg-gray-200 text-gray-600 italic"
              : isOwn
              ? "bg-blue-500 text-white rounded-tr-none"
              : "bg-gray-100 text-gray-900 rounded-tl-none"
          }`}
        >
          {!isSystem && (
            <div className="flex justify-between items-center">
              <strong>{m.sender}</strong>
              {isOwn && (
                <span className="text-xs ml-2 text-gray-200">
                  {status === "sent" && "✓"}
                  {status === "delivered" && "✓✓"}
                  {status === "read" && "✓✓ (read)"}
                </span>
              )}
            </div>
          )}
          <span>{m.message}</span>
        </Card>
        {!isSystem && (
          <span className="text-xs text-gray-400 mt-1">
            {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
    );
  };

  /** INFINITE SCROLL */
  const handleScroll = () => {
    if (!scrollRef.current || loadingOlderRef.current) return;
    if (scrollRef.current.scrollTop === 0 && hasMore) {
      loadingOlderRef.current = true;
      const prevHeight = scrollRef.current.scrollHeight;
      loadMessages(currentRoom, page + 1);
      setTimeout(() => {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight;
        loadingOlderRef.current = false;
      }, 200);
    }
  };

  const rooms = ["global", "sports", "tech", "random"];

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <Card className="w-72 flex flex-col p-4 gap-4 bg-white shadow-lg rounded-tr-xl rounded-br-xl">
        <span className="font-bold text-lg">Channels</span>
        <ul className="space-y-2 mt-2">
          {rooms.map((r) => (
            <li key={r}>
              <Button
                variant={currentRoom === r ? "default" : "outline"}
                className="w-full justify-between text-left rounded-lg hover:bg-gray-100 transition"
                onClick={() => {
                  setRoom(r);
                  joinRoom(r);
                  setSelectedUserId("");
                }}
              >
                <span>#{r}</span>
                {unread[r] > 0 && (
                  <span className="bg-red-500 text-white text-xs px-2 rounded-full">
                    {unread[r]}
                  </span>
                )}
              </Button>
            </li>
          ))}
        </ul>

        <h4 className="font-semibold mt-6">Online</h4>
        <ScrollArea className="h-64 border rounded-md mt-2 bg-gray-50 p-1">
          <ul className="space-y-1">
            {users.map((u) => (
              <li key={u.socketId} className="flex justify-between items-center p-2 hover:bg-gray-100 rounded">
                <span>{u.username}</span>
                <Button size="xs" onClick={() => setSelectedUserId(u.socketId)}>
                  PM
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Card>

      {/* Chat Area */}
      <div className="flex flex-col flex-1 h-full">
        <ScrollArea ref={scrollRef} className="flex-1 p-4 overflow-y-auto bg-gray-100" onScroll={handleScroll}>
          {messages.map(renderMessage)}
          <div ref={messagesEndRef} />
        </ScrollArea>

        {/* Input Area */}
        <div className="flex gap-2 p-2 border-t bg-white shadow-inner rounded-t-xl">
          <Input
            type="text"
            placeholder={selectedUserId ? "Private message..." : `Message #${room}`}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setTyping(e.target.value.length > 0);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            className="flex-1 rounded-full border-gray-300 shadow-sm focus:ring-2 focus:ring-blue-400"
          />
          <Button onClick={handleSend} disabled={!isConnected} className="rounded-full px-6">
            Send
          </Button>
        </div>

        {/* Typing Indicator */}
        <div className="p-2 text-xs text-gray-500">
          {typingUsers.length ? `${typingUsers.join(", ")} typing...` : ""}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  // Provide a random guest userId for testing
  const userId = "guest-" + Math.floor(Math.random() * 1000);
  return <ChatApp userId={userId} />;
}
