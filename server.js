
const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let gifts = [];
const processed = new Set();

const MAX_HISTORY = 500;

// HOME
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "Virtual Temple LIVE 2026"
  });
});

// SERVER STATUS
app.get("/api/status", (req, res) => {
  res.json({
    name: "Virtual Temple LIVE 2026",
    status: "online",
    mode: "test",
    totalGifts: gifts.length,
    connected: io.engine.clientsCount
  });
});

// GIFT HISTORY
app.get("/api/gifts", (req, res) => {
  res.json({
    success: true,
    total: gifts.length,
    gifts
  });
});

// TEST GIFT EVENT
app.post("/test-gift", (req, res) => {
  const { user, gift, eventId } = req.body || {};

  if (!user || !gift || !eventId) {
    return res.status(400).json({
      error: "user, gift and eventId are required"
    });
  }

  if (processed.has(eventId)) {
    return res.status(409).json({
      error: "Duplicate event"
    });
  }

  processed.add(eventId);

  const event = {
    user,
    gift,
    eventId,
    platform: "test",
    createdAt: new Date().toISOString()
  };

  gifts.push(event);

  if (gifts.length > MAX_HISTORY) {
    const removed = gifts.shift();
    processed.delete(removed.eventId);
  }

  io.emit("gift-event", event);

  res.json({
    success: true,
    event
  });
});

// SOCKET.IO CONNECTION
io.on("connection", (socket) => {
  console.log("Game connected:", socket.id);

  socket.emit("gift-history", gifts);

  socket.on("disconnect", () => {
    console.log("Game disconnected:", socket.id);
  });
});

// ERROR HANDLER
app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    success: false,
    error: "Internal Server Error"
  });
});

// START SERVER
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log("VIRTUAL TEMPLE LIVE 2026");
  console.log("SERVER ONLINE");
  console.log("PORT:", PORT);
  console.log("================================");
});
