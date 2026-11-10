
const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

// Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Game data
const gifts = [];
const processed = new Set();
const players = new Map();

const MAX_HISTORY = 500;
const MAX_PLAYERS = 2000;

// Main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "Virtual Temple LIVE 2026"
  });
});

// Game status
app.get("/api/status", (req, res) => {
  res.json({
    status: "online",
    mode: "test",
    gifts: gifts.length,
    players: players.size,
    maxPlayers: MAX_PLAYERS
  });
});

// Get players
app.get("/api/players", (req, res) => {
  res.json({
    players: [...players.values()]
  });
});

// Get gift history
app.get("/api/gifts", (req, res) => {
  res.json({
    gifts
  });
});

// Test gift endpoint
// This is a test endpoint, not a real TikTok/Facebook integration.
app.post("/test-gift", (req, res) => {
  const { user, gift, eventId } = req.body || {};

  if (!user || !gift || !eventId) {
    return res.status(400).json({
      success: false,
      error: "user, gift and eventId are required"
    });
  }

  const id = String(eventId).slice(0, 120);

  if (processed.has(id)) {
    return res.status(409).json({
      success: false,
      error: "Duplicate event"
    });
  }

  processed.add(id);

  const event = {
    user: String(user).slice(0, 80),
    gift: String(gift).slice(0, 80),
    eventId: id,
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

// Multiplayer connection
io.on("connection", (socket) => {

  console.log("Player connected:", socket.id);

  // Send gift history
  socket.emit("gift-history", gifts);

  // Send current players
  socket.emit(
    "players:snapshot",
    [...players.values()]
  );

  // Player joins the temple
  socket.on("player:join", (data = {}) => {

    if (players.size >= MAX_PLAYERS) {
      socket.emit("player:error", {
        message: "Temple is currently full"
      });
      return;
    }

    // Prevent duplicate registration
    if (players.has(socket.id)) {
      socket.emit("player:ready", {
        id: socket.id
      });
      return;
    }

    const player = {
      id: socket.id,

      name: String(data.name || "Guest").slice(0, 30),

      x: 0,
      y: 0,
      z: 7,

      rotation: Math.PI,

      gender:
        data.gender === "male"
          ? "male"
          : "female",

      outfit: [
        "white",
        "thai",
        "casual"
      ].includes(data.outfit)
        ? data.outfit
        : "white",

      pose: "idle",

      joinedAt: new Date().toISOString()
    };

    players.set(socket.id, player);

    // Notify other players
    socket.broadcast.emit(
      "player:update",
      player
    );

    // Confirm joining
    socket.emit("player:ready", {
      id: socket.id
    });

    console.log(
      "Player joined temple:",
      socket.id,
      "Total:",
      players.size
    );
  });

  // Player movement and animation updates
  socket.on("player:update", (data = {}) => {

    const oldPlayer = players.get(socket.id);

    if (!oldPlayer || !data || typeof data !== "object") {
      return;
    }

    const x = Number(data.x);
    const z = Number(data.z);
    const rotation = Number(data.rotation);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      !Number.isFinite(rotation)
    ) {
      return;
    }

    const allowedPoses = [
      "idle",
      "walking",
      "kneeling",
      "bowing"
    ];

    const allowedOutfits = [
      "white",
      "thai",
      "casual"
    ];

    const player = {
      ...oldPlayer,

      x: Math.max(-8, Math.min(8, x)),
      z: Math.max(-2, Math.min(10, z)),

      rotation,

      gender:
        data.gender === "male" ||
        data.gender === "female"
          ? data.gender
          : oldPlayer.gender,

      outfit: allowedOutfits.includes(data.outfit)
        ? data.outfit
        : oldPlayer.outfit,

      pose: allowedPoses.includes(data.pose)
        ? data.pose
        : "idle"
    };

    players.set(socket.id, player);

    // Broadcast movement and pose to everyone else
    socket.broadcast.emit(
      "player:update",
      player
    );
  });

  // Player leaves
  socket.on("disconnect", () => {

    players.delete(socket.id);

    socket.broadcast.emit(
      "player:left",
      {
        id: socket.id
      }
    );

    console.log(
      "Player disconnected:",
      socket.id,
      "Remaining:",
      players.size
    );
  });

});

// Error handler
app.use((err, req, res, next) => {

  console.error("Server error:", err);

  res.status(500).json({
    success: false,
    error: "Internal Server Error"
  });

});

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {

  console.log("==================================");
  console.log("VIRTUAL TEMPLE LIVE 2026");
  console.log("SERVER ONLINE");
  console.log("PORT:", PORT);
  console.log("MULTIPLAYER: ENABLED");
  console.log("MAX PLAYERS:", MAX_PLAYERS);
  console.log("==================================");

});
