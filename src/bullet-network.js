/**
 * Bullet-Network.js - Networking layer for Bullet.js
 */

const EventEmitter = require("events");
const WebSocket = require("ws");

class BulletNetwork extends EventEmitter {
  constructor(bullet, options = {}) {
    super();
    this.bullet = bullet;
    this.options = {
      port: 8765,
      host: "0.0.0.0",
      peers: [],
      ...options,
    };

    // Map of peer connections
    this.connections = new Map();

    // Last sync timestamp for differential updates
    this.lastSync = {};

    // Message queue for reliability
    this.messageQueue = [];

    // Track processed message IDs to prevent duplicates
    this.processedMessages = new Set();

    // Initialize network
    if (this.options.server !== false) {
      this._initServer();
    }

    // Connect to peers
    this._connectToPeers();

    // Start sync cycle
    this._startSyncCycle();
  }

  /**
   * Initialize WebSocket server
   * @private
   */
  _initServer() {
    try {
      this.server = new WebSocket.Server({
        port: this.options.port,
        host: this.options.host,
      });

      console.log(
        `Bullet server listening on ${this.options.host}:${this.options.port}`
      );

      this.server.on("connection", (socket, req) => {
        const peerId =
          req.headers["x-peer-id"] ||
          `peer-${Math.random().toString(36).substr(2, 9)}`;
        console.log(`New peer connected: ${peerId}`);

        this._handleNewPeer(socket, peerId);
      });

      this.server.on("error", (error) => {
        console.error("Server error:", error);
        this.emit("error", error);
      });
    } catch (err) {
      console.error("Failed to initialize server:", err);
    }
  }

  /**
   * Connect to configured peers
   * @private
   */
  _connectToPeers() {
    if (!this.options.peers || !this.options.peers.length) {
      return;
    }

    this.options.peers.forEach((peerUrl) => {
      this._connectToPeer(peerUrl);
    });
  }

  /**
   * Connect to a specific peer
   * @param {string} peerUrl - WebSocket URL of the peer
   * @private
   */
  _connectToPeer(peerUrl) {
    try {
      console.log(`Connecting to peer: ${peerUrl}`);

      const socket = new WebSocket(peerUrl, {
        headers: {
          "x-peer-id": this.bullet.id,
        },
      });

      socket.on("open", () => {
        console.log(`Connected to peer: ${peerUrl}`);
        this._handleNewPeer(socket, peerUrl);

        // Send initial sync request
        this._sendSyncRequest(socket);
      });

      socket.on("error", (error) => {
        console.error(`Error connecting to peer ${peerUrl}:`, error);

        // Schedule reconnection
        setTimeout(() => {
          this._connectToPeer(peerUrl);
        }, 5000);
      });
    } catch (err) {
      console.error(`Failed to connect to peer ${peerUrl}:`, err);
    }
  }

  /**
   * Handle a new peer connection
   * @param {WebSocket} socket - WebSocket connection
   * @param {string} peerId - Unique identifier for the peer
   * @private
   */
  _handleNewPeer(socket, peerId) {
    // Store the connection
    this.connections.set(peerId, socket);

    // Setup message handling
    socket.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        this._handlePeerMessage(peerId, data);
      } catch (err) {
        console.error(`Error handling message from ${peerId}:`, err);
      }
    });

    // Handle disconnection
    socket.on("close", () => {
      console.log(`Peer disconnected: ${peerId}`);
      this.connections.delete(peerId);

      // If this was a known peer, schedule reconnection
      if (this.options.peers.includes(peerId)) {
        setTimeout(() => {
          this._connectToPeer(peerId);
        }, 5000);
      }
    });

    // Notify about new peer
    this.emit("peer:connect", peerId);
  }

  /**
   * Handle messages from peers
   * @param {string} peerId - Unique identifier for the peer
   * @param {Object} message - Message object
   * @private
   */
  _handlePeerMessage(peerId, message) {
    if (!message || !message.type) return;

    // Check if we've already processed this message
    if (message.id && this.processedMessages.has(message.id)) {
      return;
    }

    // Mark as processed to prevent duplicates
    if (message.id) {
      this.processedMessages.add(message.id);

      // Limit the size of the processed set
      if (this.processedMessages.size > 10000) {
        const iterator = this.processedMessages.values();
        for (let i = 0; i < 1000; i++) {
          this.processedMessages.delete(iterator.next().value);
        }
      }
    }

    switch (message.type) {
      case "sync-request":
        this._handleSyncRequest(peerId, message);
        break;

      case "sync-data":
        this._handleSyncData(peerId, message);
        break;

      case "put":
        this._handlePut(peerId, message);
        break;

      default:
        console.warn(`Unknown message type from ${peerId}:`, message.type);
    }
  }

  /**
   * Handle sync request from a peer
   * @param {string} peerId - Unique identifier for the peer
   * @param {Object} message - Message object
   * @private
   */
  _handleSyncRequest(peerId, message) {
    const socket = this.connections.get(peerId);
    if (!socket) return;

    const lastSync = message.lastSync || {};
    const updates = this._getUpdatesSince(lastSync);

    socket.send(
      JSON.stringify({
        id: this._generateId(),
        type: "sync-data",
        updates,
        timestamp: Date.now(),
      })
    );
  }

  /**
   * Handle sync data from a peer
   * @param {string} peerId - Unique identifier for the peer
   * @param {Object} message - Message object
   * @private
   */
  _handleSyncData(peerId, message) {
    const updates = message.updates || [];

    updates.forEach((update) => {
      // Apply updates if they're newer than what we have
      const currentData = this.bullet._getData(update.path);
      const currentMeta = this.bullet.meta[update.path] || { timestamp: 0 };

      if (update.timestamp > currentMeta.timestamp) {
        // Update our data
        this.bullet._setData(update.path, update.data, update.timestamp);

        // Update metadata
        this.bullet.meta[update.path] = {
          timestamp: update.timestamp,
          source: peerId,
        };
      }
    });

    // Update last sync time for this peer
    this.lastSync[peerId] = message.timestamp;
  }

  /**
   * Handle put operation from a peer
   * @param {string} peerId - Unique identifier for the peer
   * @param {Object} message - Message object
   * @private
   */
  _handlePut(peerId, message) {
    const { path, data, timestamp } = message;

    // Check if this update is newer than what we have
    const currentMeta = this.bullet.meta[path] || { timestamp: 0 };

    if (timestamp > currentMeta.timestamp) {
      // Update our data
      this.bullet._setData(path, data, timestamp);

      // Update metadata
      this.bullet.meta[path] = {
        timestamp,
        source: peerId,
      };

      // Propagate to other peers (except the source)
      this._broadcastMessage(message, [peerId]);
    }
  }

  /**
   * Get updates since the given timestamps
   * @param {Object} lastSync - Map of paths to timestamps
   * @return {Array} - Array of updates
   * @private
   */
  _getUpdatesSince(lastSync) {
    const updates = [];

    // Filter the transaction log for new updates
    this.bullet.log.forEach((entry) => {
      const pathTimestamp = lastSync[entry.path] || 0;

      if (entry.timestamp > pathTimestamp) {
        updates.push({
          path: entry.path,
          data: entry.data,
          timestamp: entry.timestamp,
        });
      }
    });

    return updates;
  }

  /**
   * Start the periodic sync cycle
   * @private
   */
  _startSyncCycle() {
    this.syncInterval = setInterval(() => {
      this.connections.forEach((socket, peerId) => {
        this._sendSyncRequest(socket);
      });
    }, 30000); // Sync every 30 seconds
  }

  /**
   * Send a sync request to a peer
   * @param {WebSocket} socket - WebSocket connection
   * @private
   */
  _sendSyncRequest(socket) {
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            id: this._generateId(),
            type: "sync-request",
            lastSync: this.lastSync,
            timestamp: Date.now(),
          })
        );
      }
    } catch (err) {
      console.error("Error sending sync request:", err);
    }
  }

  /**
   * Broadcast a message to connected peers
   * @param {Object} message - Message to broadcast
   * @param {Array} excludePeers - List of peer IDs to exclude
   * @private
   */
  _broadcastMessage(message, excludePeers = []) {
    const messageStr = JSON.stringify({
      ...message,
      id: message.id || this._generateId(),
    });

    this.connections.forEach((socket, peerId) => {
      if (excludePeers.includes(peerId)) return;

      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(messageStr);
        }
      } catch (err) {
        console.error(`Error broadcasting to peer ${peerId}:`, err);
      }
    });
  }

  /**
   * Broadcast a data change to all peers
   * @param {string} path - Data path
   * @param {*} data - New data
   * @param {number} timestamp - Operation timestamp
   * @public
   */
  broadcast(path, data, timestamp = Date.now()) {
    const message = {
      type: "put",
      path,
      data,
      timestamp,
    };

    this._broadcastMessage(message);
  }

  /**
   * Generate a unique ID
   * @return {string} - Unique ID
   * @private
   */
  _generateId() {
    return "msg-" + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Close all connections and stop the server
   * @public
   */
  close() {
    // Clear sync interval
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    // Close all peer connections
    this.connections.forEach((socket, peerId) => {
      try {
        socket.close();
      } catch (err) {
        console.error(`Error closing connection to ${peerId}:`, err);
      }
    });

    // Close server if it exists
    if (this.server) {
      try {
        this.server.close();
      } catch (err) {
        console.error("Error closing server:", err);
      }
    }

    console.log("BulletNetwork closed");
  }
}

module.exports = BulletNetwork;
