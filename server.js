
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: { origin: "*" }
});

let gifts = [];
const processed = new Set();

app.get("/", (req, res) => {
  res.json({
    name: "Virtual Temple LIVE 2026",
    status: "online",
    mode: "test"
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ทดลองส่ง Event เท่านั้น
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
  io.emit("gift-event", event);

  res.json({ success: true, event });
});

io.on("connection", socket => {
  console.log("Game connected:", socket.id);
  socket.emit("gift-history", gifts);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Virtual Temple server running on", PORT);
});
