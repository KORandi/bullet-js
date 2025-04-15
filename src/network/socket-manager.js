/**
 * SocketManager - Manages WebSocket connections between peers
 * Also coordinates with WebRTC connections when enabled
 */

const socketIO = require("socket.io");
const { io: ioClient } = require("socket.io-client");
const { setupMessageHandlers } = require("./message-handlers");

class SocketManager {
  /**
   * Create a new SocketManager
   * @param {Object} server - P2PServer instance
   */
  constructor(server) {
    this.server = server;
    this.sockets = {}; // Map of peerID -> socket
    this.socketsByUrl = {}; // Map of url -> socket
    this.urlToPeerId = {}; // Map of url -> peerID
    this.peerIdToUrl = {}; // Map of peerID -> url
    this.webrtcPeers = {}; // Map of peerID -> WebRTC dataChannel
    this.io = null;
    this.myUrl = null;
    this.isShuttingDown = false;
    this.peerSockets = []; // Store client socket connections
    this.webrtcEnabled = server.webrtcEnabled || false;
  }

  /**
   * Initialize socket server
   * @param {Object} httpServer - HTTP server instance
   */
  init(httpServer) {
    this.io = socketIO(httpServer);
    this.myUrl = `http://localhost:${this.server.port}`;

    this.io.on("connection", (socket) => {
      // Don't accept new connections if shutting down
      if (this.isShuttingDown) {
        console.log(`Rejecting new connection during shutdown: ${socket.id}`);
        socket.disconnect(true);
        return;
      }

      console.log(`New connection from: ${socket.id}`);

      socket.on("identify", (data) => {
        const peerId = data.serverID;
        const peerUrl = data.url;

        // Store socket reference by ID
        this.sockets[peerId] = socket;

        // Store bidirectional mappings
        if (peerUrl) {
          this.socketsByUrl[peerUrl] = socket;
          this.peerIdToUrl[peerId] = peerUrl;
          this.urlToPeerId[peerUrl] = peerId;
          console.log(`Mapped peer ${peerId} to URL ${peerUrl}`);
        }

        console.log(`Peer identified: ${peerId} at ${peerUrl || "unknown"}`);

        // Log connection status
        const peerCount = Object.keys(this.sockets).length;
        const urlCount = Object.keys(this.socketsByUrl).length;
        console.log(
          `Current connections: ${peerCount} by ID, ${urlCount} by URL`
        );

        // Immediately synchronize vector clocks with new peer
        if (this.server.syncManager) {
          // Send our current vector clock to the new peer
          const syncMessage = {
            type: "vector-clock-sync",
            vectorClock: this.server.syncManager.getVectorClock(),
            nodeId: this.server.serverID,
            timestamp: Date.now(),
            syncId: `init-${this.server.serverID}-${Date.now()}`,
          };

          socket.emit("vector-clock-sync", syncMessage);
        }

        // If WebRTC is enabled, try to establish a WebRTC connection
        if (this.webrtcEnabled && this.server.webrtcManager) {
          this.server.webrtcManager
            .connectToPeer(peerId)
            .catch((err) =>
              console.warn(
                `Could not establish WebRTC connection with ${peerId}:`,
                err
              )
            );
        }
      });

      // Set up WebRTC signaling handlers
      if (this.webrtcEnabled) {
        socket.on("webrtc-signal", (data) => {
          // Forward to webrtcManager - it will handle the signal if it's for us
          if (this.server.webrtcManager) {
            this.server.webrtcManager.handleSignal(
              socket,
              data.peerId,
              data.signal
            );
          }
        });
      }

      // Set up message handlers for incoming connection
      setupMessageHandlers(socket, this.server, true);
    });
  }

  /**
   * Connect to known peers
   * @param {Array<string>} peerURLs - URLs of peers to connect to
   */
  connectToPeers(peerURLs) {
    // Don't connect to peers if shutting down
    if (this.isShuttingDown) {
      console.log("Skipping peer connections during shutdown");
      return;
    }

    this.peerSockets = []; // Store socket references for cleanup

    peerURLs.forEach((url) => {
      try {
        // Skip self connections
        if (url === this.myUrl) {
          console.log(`Skipping self-connection to ${url}`);
          return;
        }

        console.log(`Attempting to connect to peer: ${url}`);
        const socket = ioClient(url);

        // Store for cleanup
        this.peerSockets.push(socket);

        // Store socket by URL immediately
        this.socketsByUrl[url] = socket;

        socket.on("connect", () => {
          console.log(`Connected to peer: ${url}`);

          // Identify ourselves to the peer
          socket.emit("identify", {
            serverID: this.server.serverID,
            url: this.myUrl,
          });

          // After connecting, immediately synchronize vector clocks
          if (this.server.syncManager) {
            const syncMessage = {
              type: "vector-clock-sync",
              vectorClock: this.server.syncManager.getVectorClock(),
              nodeId: this.server.serverID,
              timestamp: Date.now(),
              syncId: `connect-${this.server.serverID}-${Date.now()}`,
            };

            socket.emit("vector-clock-sync", syncMessage);
          }
        });

        socket.on("disconnect", () => {
          console.log(`Disconnected from peer: ${url}`);

          // Clean up the URL mapping
          delete this.socketsByUrl[url];

          // Find and clean up the ID mapping if it exists
          const peerId = this.urlToPeerId[url];
          if (peerId) {
            delete this.sockets[peerId];
            delete this.peerIdToUrl[peerId];
            delete this.urlToPeerId[url];
          }
        });

        // Set up message handlers for outgoing connection
        setupMessageHandlers(socket, this.server, false);
      } catch (err) {
        console.error(`Error setting up connection to peer ${url}:`, err);
      }
    });
  }

  /**
   * Register a WebRTC peer connection
   * @param {string} peerId - Peer ID
   * @param {Object} peer - WebRTC peer or data channel
   */
  registerWebRTCPeer(peerId, peer) {
    if (this.isShuttingDown) return;

    console.log(`Registering WebRTC connection with peer ${peerId}`);
    this.webrtcPeers[peerId] = peer;
  }

  /**
   * Unregister a WebRTC peer connection
   * @param {string} peerId - Peer ID
   */
  unregisterWebRTCPeer(peerId) {
    if (this.isShuttingDown) return;

    console.log(`Unregistering WebRTC connection with peer ${peerId}`);
    delete this.webrtcPeers[peerId];
  }

  /**
   * Close all socket connections properly
   */
  closeAllConnections() {
    this.isShuttingDown = true;
    console.log("Closing all socket connections");

    // Close WebRTC connections if available
    if (this.server.webrtcManager) {
      this.server.webrtcManager.closeAllConnections();
    }

    // Close server-side socket.io instance
    if (this.io) {
      try {
        this.io.close();
        console.log("Closed server socket.io instance");
      } catch (err) {
        console.error("Error closing socket.io server:", err);
      }
    }

    // Close all outgoing connections by URL
    if (this.peerSockets && this.peerSockets.length > 0) {
      console.log(`Disconnecting ${this.peerSockets.length} socket.io clients`);
      for (const socket of this.peerSockets) {
        try {
          if (socket) {
            socket.disconnect();
            socket.close();
            socket.removeAllListeners();
          }
        } catch (err) {
          console.error(`Error disconnecting socket:`, err);
        }
      }
      this.peerSockets = [];
    }

    // Close any remaining sockets by URL
    for (const [url, socket] of Object.entries(this.socketsByUrl)) {
      try {
        if (socket && socket.connected) {
          socket.disconnect();
          socket.close();
          socket.removeAllListeners();
          console.log(`Disconnected from peer: ${url}`);
        }
      } catch (err) {
        console.error(`Error disconnecting from ${url}:`, err);
      }
    }

    // Clear all socket collections
    this.sockets = {};
    this.socketsByUrl = {};
    this.urlToPeerId = {};
    this.peerIdToUrl = {};
    this.webrtcPeers = {};

    console.log("All socket connections closed");
  }

  /**
   * Broadcast a message to all connected peers
   * @param {string} event - Event name
   * @param {Object} data - Event data
   * @returns {number} - Number of peers message was sent to
   */
  broadcast(event, data) {
    // Skip broadcasting if shutting down
    if (this.isShuttingDown) {
      console.log("Skipping broadcast during shutdown");
      return 0;
    }

    // Get all connected peers, filter out ourselves
    const idPeers = Object.keys(this.sockets).filter(
      (id) => id !== this.server.serverID
    );
    const urlPeers = Object.keys(this.socketsByUrl);
    const webrtcPeers = Object.keys(this.webrtcPeers);

    // Process data before sending
    let dataToSend = { ...data };

    // Initialize forwarded flag if it doesn't exist
    if (!("forwarded" in dataToSend)) {
      dataToSend.forwarded = false;
    }

    // Initialize or preserve hop count
    if (!("hopCount" in dataToSend)) {
      dataToSend.hopCount = 0;
    }

    // Always include our latest vector clock in outgoing messages
    if (this.server.syncManager) {
      dataToSend.vectorClock = this.server.syncManager.getVectorClock();
    }

    // Track which peers we've sent to
    const sentToPeers = new Set();
    let peerCount = 0;

    // First, try WebRTC connections if enabled
    if (this.webrtcEnabled && this.server.webrtcManager) {
      for (const peerId of webrtcPeers) {
        // Skip ourselves
        if (peerId === this.server.serverID) continue;

        // Skip if already sent
        if (sentToPeers.has(peerId)) continue;

        // Send via WebRTC
        if (this.server.webrtcManager.sendToPeer(peerId, event, dataToSend)) {
          sentToPeers.add(peerId);
          peerCount++;
        }
      }
    }

    // Then, send by peer ID (these are confirmed peers)
    for (const peerId of idPeers) {
      // Skip ourselves
      if (peerId === this.server.serverID) continue;

      // Skip if already sent
      if (sentToPeers.has(peerId)) continue;

      // Get the socket
      const socket = this.sockets[peerId];
      if (socket && socket.connected) {
        socket.emit(event, dataToSend);
        sentToPeers.add(peerId);
        peerCount++;
      }
    }

    // Then send by URL for any remaining peers
    for (const url of urlPeers) {
      // Get the peer ID if known
      const peerId = this.urlToPeerId[url];

      // Skip if we already sent to this peer by ID or WebRTC
      if (peerId && sentToPeers.has(peerId)) continue;

      // Get the socket
      const socket = this.socketsByUrl[url];
      if (socket && socket.connected) {
        socket.emit(event, dataToSend);
        if (peerId) sentToPeers.add(peerId);
        peerCount++;
      }
    }

    console.log(
      `Broadcasting ${event} for ${
        data.path || "general message"
      } to ${peerCount} peers (${sentToPeers.size} unique)`
    );
    return peerCount;
  }

  /**
   * Get connection status information
   * @returns {Object} - Connection status info
   */
  getConnectionStatus() {
    return {
      peersById: Object.keys(this.sockets),
      peersByUrl: Object.keys(this.socketsByUrl),
      peerCount: Object.keys(this.sockets).length,
      webrtcPeers: Object.keys(this.webrtcPeers),
    };
  }
}

module.exports = SocketManager;
