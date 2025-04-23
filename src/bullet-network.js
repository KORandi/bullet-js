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
      maxTTL: 32,
      messageCacheSize: 10000,
      syncInterval: 30000,
      batchSize: 100,
      batchDelay: 500,
      ...options,
    };

    this.connections = new Map();
    this.lastSync = {};
    this.messageQueue = [];
    this.processedMessages = new Set();
    this.activeSyncBatches = new Map();

    if (this.options.server !== false) {
      this._initServer();
    }

    this._connectToPeers();
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

        this._sendSyncRequest(socket);
      });

      socket.on("error", (error) => {
        console.error(`Error connecting to peer ${peerUrl}:`, error);

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
    this.connections.set(peerId, socket);

    socket.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        this._handlePeerMessage(peerId, data);
      } catch (err) {
        console.error(`Error handling message from ${peerId}:`, err);
      }
    });

    socket.on("close", () => {
      console.log(`Peer disconnected: ${peerId}`);
      this.connections.delete(peerId);

      if (this.options.peers.includes(peerId)) {
        setTimeout(() => {
          this._connectToPeer(peerId);
        }, 5000);
      }
    });

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

    if (message.id && this.processedMessages.has(message.id)) {
      return;
    }

    if (message.id) {
      this.processedMessages.add(message.id);

      if (this.processedMessages.size > this.options.messageCacheSize) {
        const iterator = this.processedMessages.values();
        for (let i = 0; i < this.options.messageCacheSize / 10; i++) {
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

      case "sync-ack":
        this._handleSyncAck(peerId, message);
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

    const requestId = message.requestId || this._generateId();
    const lastSync = message.lastSync || {};

    if (this.activeSyncBatches.has(peerId)) {
      socket.send(
        JSON.stringify({
          id: this._generateId(),
          type: "sync-status",
          requestId: requestId,
          status: "in-progress",
          message: "Sync already in progress",
        })
      );
      return;
    }

    const allUpdates = this._getUpdatesSince(lastSync);

    if (allUpdates.length === 0) {
      socket.send(
        JSON.stringify({
          id: this._generateId(),
          type: "sync-data",
          requestId: requestId,
          updates: [],
          complete: true,
          batchIndex: 0,
          totalBatches: 0,
          timestamp: Date.now(),
        })
      );
      return;
    }

    const totalBatches = Math.ceil(allUpdates.length / this.options.batchSize);

    this.activeSyncBatches.set(peerId, {
      updates: allUpdates,
      requestId: requestId,
      totalBatches: totalBatches,
      currentBatch: 0,
      startTime: Date.now(),
    });

    this._sendNextSyncBatch(peerId);
  }

  /**
   * Send the next batch of sync data to a peer
   * @param {string} peerId - Unique identifier for the peer
   * @private
   */
  _sendNextSyncBatch(peerId) {
    const socket = this.connections.get(peerId);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.activeSyncBatches.delete(peerId);
      return;
    }

    const batchInfo = this.activeSyncBatches.get(peerId);
    if (!batchInfo) return;

    const { updates, requestId, totalBatches, currentBatch } = batchInfo;

    const start = currentBatch * this.options.batchSize;
    const end = Math.min(start + this.options.batchSize, updates.length);

    const batchUpdates = updates.slice(start, end);

    const isLastBatch = currentBatch === totalBatches - 1;

    try {
      socket.send(
        JSON.stringify({
          id: this._generateId(),
          type: "sync-data",
          requestId: requestId,
          updates: batchUpdates,
          batchIndex: currentBatch,
          totalBatches: totalBatches,
          complete: isLastBatch,
          timestamp: Date.now(),
        })
      );

      console.log(
        `Sent sync batch ${
          currentBatch + 1
        }/${totalBatches} to ${peerId} with ${batchUpdates.length} updates`
      );

      batchInfo.currentBatch++;

      if (isLastBatch) {
        this.activeSyncBatches.delete(peerId);
        console.log(`Completed batched sync with ${peerId}`);
      }
    } catch (error) {
      console.error(`Error sending sync batch to ${peerId}:`, error);
      this.activeSyncBatches.delete(peerId);
    }
  }

  /**
   * Handle sync data from a peer
   * @param {string} peerId - Unique identifier for the peer
   * @param {Object} message - Message object
   * @private
   */
  _handleSyncData(peerId, message) {
    const updates = message.updates || [];
    const requestId = message.requestId || "unknown";
    const batchIndex = message.batchIndex || 0;
    const totalBatches = message.totalBatches || 1;
    const isComplete = message.complete || false;

    console.log(
      `Received sync batch ${
        batchIndex + 1
      }/${totalBatches} from ${peerId} with ${updates.length} updates`
    );

    // Process each update in the batch
    updates.forEach((update) => {
      const currentData = this.bullet._getData(update.path);
      const currentMeta = this.bullet.meta[update.path] || { timestamp: 0 };

      if (update.timestamp > currentMeta.timestamp) {
        this.bullet._setData(update.path, update.data, update.timestamp, false);

        this.bullet.meta[update.path] = {
          timestamp: update.timestamp,
          source: peerId,
        };
      }
    });

    // Update last sync timestamp for this peer
    this.lastSync[peerId] = message.timestamp;

    // Send acknowledgment for this batch
    const socket = this.connections.get(peerId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          id: this._generateId(),
          type: "sync-ack",
          requestId: requestId,
          batchIndex: batchIndex,
          totalBatches: totalBatches,
          status: "processed",
          timestamp: Date.now(),
        })
      );
    }

    // If this was the last batch, log completion
    if (isComplete) {
      console.log(
        `Completed receiving sync from ${peerId}: ${totalBatches} batches`
      );
    }
  }

  /**
   * Handle sync acknowledgment from a peer
   * @param {string} peerId - Unique identifier for the peer
   * @param {Object} message - Message object
   * @private
   */
  _handleSyncAck(peerId, message) {
    const requestId = message.requestId;
    const batchIndex = message.batchIndex;
    const status = message.status;

    // Check if we have an active sync session for this peer
    if (!this.activeSyncBatches.has(peerId)) {
      console.log(
        `Received sync-ack from ${peerId} but no active sync session found`
      );
      return;
    }

    const batchInfo = this.activeSyncBatches.get(peerId);

    // Verify this ack is for the correct sync session and batch
    if (
      batchInfo.requestId !== requestId ||
      batchInfo.currentBatch - 1 !== batchIndex
    ) {
      console.log(`Received out-of-sequence sync-ack from ${peerId}`);
      return;
    }

    console.log(
      `Received sync-ack for batch ${batchIndex + 1}/${
        batchInfo.totalBatches
      } from ${peerId}`
    );

    // Check if there are more batches to send
    if (batchInfo.currentBatch < batchInfo.totalBatches) {
      // Schedule sending the next batch
      setTimeout(() => {
        this._sendNextSyncBatch(peerId);
      }, this.options.batchDelay);
    } else {
      // All batches have been sent and acknowledged
      console.log(`Completed sync session with ${peerId}`);

      // Clean up session state
      this.activeSyncBatches.delete(peerId);
    }
  }

  /**
   * Handle put operation from a peer
   * @param {string} peerId - Unique identifier for the peer
   * @param {Object} message - Message object
   * @private
   */
  _handlePut(peerId, message) {
    const { path, data, timestamp, ttl } = message;

    if (ttl !== undefined && ttl <= 0) {
      return;
    }

    const currentMeta = this.bullet.meta[path] || { timestamp: 0 };

    if (timestamp > currentMeta.timestamp) {
      this.bullet._setData(path, data, timestamp, false);

      this.bullet.meta[path] = {
        timestamp,
        source: peerId,
      };

      this._broadcastMessage(message);
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
    }, this.options.syncInterval);
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
   * @private
   */
  _broadcastMessage(message) {
    if (message.ttl !== undefined && message.ttl <= 0) {
      return;
    }

    const messageWithId = {
      ...message,
      id: message.id || this._generateId(),
    };

    if (messageWithId.ttl !== undefined) {
      messageWithId.ttl = messageWithId.ttl - 1;
    } else {
      messageWithId.ttl = this.options.maxTTL - 1;
    }

    const messageStr = JSON.stringify(messageWithId);

    this.connections.forEach((socket, peerId) => {
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
      id: this._generateId(),
      type: "put",
      path,
      data,
      timestamp,
      ttl: this.options.maxTTL,
    };

    this.processedMessages.add(message.id);

    this._broadcastMessage(message);
  }

  /**
   * Generate a unique ID
   * @return {string} - Unique ID
   * @private
   */
  _generateId() {
    return "msg-" + Math.random().toString(36).substr(2, 9) + "-" + Date.now();
  }

  /**
   * Close all connections and stop the server
   * @public
   */
  close() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.connections.forEach((socket, peerId) => {
      try {
        socket.close();
      } catch (err) {
        console.error(`Error closing connection to ${peerId}:`, err);
      }
    });

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
