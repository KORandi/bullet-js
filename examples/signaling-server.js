/**
 * WebRTC Signaling Server Example
 *
 * This is a simple WebRTC signaling server that can help establish
 * WebRTC connections between peers behind NAT or firewalls.
 *
 * This server doesn't handle any actual data transfer, just helps with
 * the initial connection establishment by relaying signaling messages.
 */

const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Enable CORS for all routes
app.use(cors());

// Serve a simple status page
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>P2P Server WebRTC Signaling Server</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
          .container { max-width: 800px; margin: 0 auto; }
          h1 { color: #333; }
          .status { padding: 15px; background-color: #f0f0f0; border-radius: 5px; }
          .peers { margin-top: 20px; }
          .footer { margin-top: 30px; font-size: 0.9em; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>P2P Server WebRTC Signaling Server</h1>
          <div class="status">
            <p><strong>Status:</strong> Running</p>
            <p><strong>Connected Peers:</strong> <span id="peerCount">${io.engine.clientsCount}</span></p>
          </div>
          <div class="peers">
            <h2>Connected Peers</h2>
            <ul id="peerList">
              ${Array.from(io.sockets.sockets.keys())
                .map((id) => `<li>Peer ${id.substring(0, 8)}...</li>`)
                .join("")}
            </ul>
          </div>
          <div class="footer">
            <p>This server only handles WebRTC signaling and does not store or process any data.</p>
          </div>
        </div>
        <script>
          // Simple auto-refresh
          setTimeout(() => { location.reload(); }, 5000);
        </script>
      </body>
    </html>
  `);
});

// In-memory store of peer information
const peers = new Map();

io.on("connection", (socket) => {
  console.log(`New connection: ${socket.id}`);

  // Register peer
  socket.on("register", (data) => {
    const { peerId } = data;

    if (!peerId) {
      socket.emit("error", { message: "Invalid peer ID" });
      return;
    }

    console.log(`Peer ${peerId} registered from socket ${socket.id}`);

    // Store peer information
    peers.set(peerId, {
      socket,
      peerId,
      socketId: socket.id,
      connectedAt: new Date(),
    });

    // Respond with success
    socket.emit("registered", {
      peerId,
      success: true,
      connectedPeers: Array.from(peers.keys()).filter((id) => id !== peerId),
    });

    // Notify other peers of the new peer
    socket.broadcast.emit("peer-joined", { peerId });
  });

  // Handle WebRTC signaling
  socket.on("webrtc-signal", (data) => {
    const { targetPeerId, senderPeerId, signal, type } = data;

    console.log(`Signal from ${senderPeerId} to ${targetPeerId} (${type})`);

    // Find the target peer
    const targetPeer = peers.get(targetPeerId);

    if (!targetPeer) {
      socket.emit("error", { message: `Peer ${targetPeerId} not found` });
      return;
    }

    // Forward the signal to the target peer
    targetPeer.socket.emit("webrtc-signal", {
      senderPeerId,
      signal,
      type,
    });
  });

  // Handle connection requests
  socket.on("request-connection", (data) => {
    const { targetPeerId, senderPeerId } = data;

    console.log(`Connection request from ${senderPeerId} to ${targetPeerId}`);

    // Find the target peer
    const targetPeer = peers.get(targetPeerId);

    if (!targetPeer) {
      socket.emit("error", { message: `Peer ${targetPeerId} not found` });
      return;
    }

    // Forward the connection request
    targetPeer.socket.emit("connection-request", {
      senderPeerId,
      connectionId: `${senderPeerId}-${targetPeerId}-${Date.now()}`,
    });
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);

    // Find which peer this socket belongs to
    let disconnectedPeerId = null;

    for (const [peerId, peerInfo] of peers.entries()) {
      if (peerInfo.socketId === socket.id) {
        disconnectedPeerId = peerId;
        break;
      }
    }

    if (disconnectedPeerId) {
      console.log(`Peer ${disconnectedPeerId} disconnected`);

      // Remove the peer
      peers.delete(disconnectedPeerId);

      // Notify other peers
      socket.broadcast.emit("peer-left", { peerId: disconnectedPeerId });
    }
  });
});

// Periodic cleanup of stale connections
setInterval(
  () => {
    const now = new Date();

    for (const [peerId, peerInfo] of peers.entries()) {
      // Check if socket is still connected
      if (!peerInfo.socket.connected) {
        console.log(`Removing stale peer: ${peerId}`);
        peers.delete(peerId);
        continue;
      }

      // Check if the connection is too old (over 24 hours)
      const connectionAge = now - peerInfo.connectedAt;
      if (connectionAge > 24 * 60 * 60 * 1000) {
        console.log(
          `Removing old peer: ${peerId} (connected for ${connectionAge / 1000 / 60 / 60} hours)`
        );
        peers.delete(peerId);
        peerInfo.socket.disconnect();
      }
    }
  },
  60 * 60 * 1000
); // Clean up once per hour

// Start the server
const PORT = process.env.PORT || 3500;
server.listen(PORT, () => {
  console.log(`WebRTC Signaling Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} for status`);
});
