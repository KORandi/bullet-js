/**
 * Bullet-Network.js - Networking layer for Bullet.js
 * A true peer-to-peer networking implementation with no server/client distinction
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

    // Local peer identifier
    this.localPeerId = this.bullet.id;

    // Track peers using consistent identifiers
    // Maps peer IDs to peer context objects
    this.peers = new Map();

    // Track active websocket server
    this.server = null;

    // Track processed message IDs to prevent loops
    this.processedMessages = new Set();

    // Track active sync sessions
    this.activeSyncBatches = new Map();

    // Start listening for connections if not disabled
    if (this.options.server !== false) {
      this._startListening();
    }

    // Connect to known peers
    this._connectToPeers();

    // Start sync cycle
    this._startSyncCycle();
  }

  /**
   * Start listening for incoming connections
   * @private
   */
  _startListening() {
    try {
      this.server = new WebSocket.Server({
        port: this.options.port,
        host: this.options.host,
      });

      console.log(
        `Bullet network listening on ${this.options.host}:${this.options.port}`
      );

      this.server.on("connection", (socket, req) => {
        this._handleIncomingConnection(socket, req);
      });

      this.server.on("error", (error) => {
        console.error("WebSocket server error:", error);
        this.emit("error", error);
      });
    } catch (err) {
      console.error("Failed to start WebSocket server:", err);
    }
  }

  /**
   * Handle incoming connection from another peer
   * @param {WebSocket} socket - WebSocket connection
   * @param {Object} req - HTTP request object
   * @private
   */
  _handleIncomingConnection(socket, req) {
    const remotePeerId = req.headers["x-peer-id"];

    if (!remotePeerId) {
      console.warn("Rejecting connection with no peer ID");
      socket.close();
      return;
    }

    // Don't connect to self
    if (remotePeerId === this.localPeerId) {
      console.warn("Rejecting connection from self");
      socket.close();
      return;
    }

    console.log(`Incoming connection from peer: ${remotePeerId}`);

    // Check if we already have a connection with this peer
    const existingPeer = this.peers.get(remotePeerId);

    if (
      existingPeer &&
      existingPeer.socket &&
      existingPeer.socket.readyState === WebSocket.OPEN
    ) {
      // We already have a connection to this peer
      // If we initiated the connection (outbound is true), keep our connection
      // If the remote peer initiated the connection (outbound is false), use their connection
      if (existingPeer.outbound) {
        console.log(
          `Already have outbound connection to ${remotePeerId}. Closing incoming connection.`
        );
        socket.close();
        return;
      } else {
        console.log(
          `Replacing existing inbound connection from ${remotePeerId}`
        );
        existingPeer.socket.close();
      }
    }

    // Setup the peer connection
    this._setupPeerConnection(socket, remotePeerId, false);
  }

  /**
   * Connect to configured peer list
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
   * Connect to a specific peer by URL
   * @param {string} peerUrl - WebSocket URL of the peer
   * @private
   */
  _connectToPeer(peerUrl) {
    try {
      console.log(`Initiating outbound connection to peer: ${peerUrl}`);

      const socket = new WebSocket(peerUrl, {
        headers: {
          "x-peer-id": this.localPeerId,
        },
      });

      socket.on("open", () => {
        console.log(`Connected to peer at ${peerUrl}`);

        // Handle initial handshake
        socket.send(
          JSON.stringify({
            type: "handshake",
            id: this._generateId(),
            peerId: this.localPeerId,
            timestamp: Date.now(),
          })
        );

        // Wait for handshake response to establish peer ID
        const handleHandshake = (message) => {
          try {
            const data = JSON.parse(message);

            if (
              data.type === "handshake" ||
              data.type === "handshake-response"
            ) {
              const remotePeerId = data.peerId;

              if (!remotePeerId) {
                console.warn("Received handshake without peer ID");
                socket.close();
                return;
              }

              // Don't connect to self
              if (remotePeerId === this.localPeerId) {
                console.warn("Connected to self, closing connection");
                socket.close();
                return;
              }

              // Remove this one-time handler
              socket.removeListener("message", handleHandshake);

              // Setup the connection with the correct peer ID
              this._setupPeerConnection(socket, remotePeerId, true, peerUrl);

              // Initiate sync
              this._sendSyncRequest(remotePeerId);
            }
          } catch (err) {
            console.error("Error handling handshake:", err);
          }
        };

        socket.on("message", handleHandshake);
      });

      socket.on("error", (error) => {
        console.error(`Error connecting to peer ${peerUrl}:`, error);

        // Try reconnecting after delay
        setTimeout(() => {
          this._connectToPeer(peerUrl);
        }, 5000);
      });
    } catch (err) {
      console.error(`Failed to connect to peer ${peerUrl}:`, err);

      // Try reconnecting after delay
      setTimeout(() => {
        this._connectToPeer(peerUrl);
      }, 5000);
    }
  }

  /**
   * Setup peer connection with consistent handling
   * @param {WebSocket} socket - WebSocket connection
   * @param {string} peerId - Remote peer ID
   * @param {boolean} outbound - Whether we initiated the connection
   * @param {string} peerUrl - Optional URL for reconnection (for outbound connections)
   * @private
   */
  _setupPeerConnection(socket, peerId, outbound, peerUrl = null) {
    // Store information about this peer
    const peerInfo = {
      peerId,
      socket,
      outbound,
      url: peerUrl,
      connectedAt: Date.now(),
      lastSyncAt: 0,
    };

    this.peers.set(peerId, peerInfo);

    // Setup message handler
    socket.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        this._handlePeerMessage(peerId, data);
      } catch (err) {
        console.error(`Error handling message from ${peerId}:`, err);
      }
    });

    // Setup disconnect handler
    socket.on("close", () => {
      console.log(`Peer disconnected: ${peerId}`);

      // Remove from active peers
      this.peers.delete(peerId);

      // Clean up any active sync sessions
      this.activeSyncBatches.delete(peerId);

      // Try to reconnect if this was in our peer list
      if (outbound && peerUrl && this.options.peers.includes(peerUrl)) {
        console.log(`Will attempt to reconnect to ${peerUrl} in 5 seconds`);
        setTimeout(() => {
          this._connectToPeer(peerUrl);
        }, 5000);
      }
    });

    // Send handshake-response if this was an inbound connection
    if (!outbound) {
      socket.send(
        JSON.stringify({
          type: "handshake-response",
          id: this._generateId(),
          peerId: this.localPeerId,
          timestamp: Date.now(),
        })
      );
    }

    // Emit peer connect event
    this.emit("peer:connect", peerId);

    console.log(
      `Peer connection established with ${peerId} (${
        outbound ? "outbound" : "inbound"
      })`
    );
  }

  /**
   * Handle messages from peers
   * @param {string} peerId - Remote peer ID
   * @param {Object} message - Message object
   * @private
   */
  _handlePeerMessage(peerId, message) {
    if (!message || !message.type) return;

    // Deduplicate messages
    if (message.id && this.processedMessages.has(message.id)) {
      return;
    }

    // Mark message as processed
    if (message.id) {
      this.processedMessages.add(message.id);

      // Prune processed message cache if it gets too large
      if (this.processedMessages.size > this.options.messageCacheSize) {
        const iterator = this.processedMessages.values();
        for (let i = 0; i < this.options.messageCacheSize / 10; i++) {
          this.processedMessages.delete(iterator.next().value);
        }
      }
    }

    // Handle message based on type
    switch (message.type) {
      case "handshake":
      case "handshake-response":
        // Handshake messages handled during connection setup
        break;

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
   * @param {string} peerId - Remote peer ID
   * @param {Object} message - Message object
   * @private
   */
  _handleSyncRequest(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.socket || peer.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const requestId = message.requestId || this._generateId();
    const lastSync = message.lastSync || {};

    // Check if we're already in a sync session with this peer
    if (this.activeSyncBatches.has(peerId)) {
      peer.socket.send(
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

    // Get all updates since last sync
    const allUpdates = this._getUpdatesSince(lastSync);

    // If no updates, send empty sync response
    if (allUpdates.length === 0) {
      peer.socket.send(
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

    // Calculate batching requirements
    const totalBatches = Math.ceil(allUpdates.length / this.options.batchSize);

    // Store sync session state
    this.activeSyncBatches.set(peerId, {
      updates: allUpdates,
      requestId: requestId,
      totalBatches: totalBatches,
      currentBatch: 0,
      startTime: Date.now(),
    });

    // Start sending batches
    this._sendNextSyncBatch(peerId);
  }

  /**
   * Send the next batch of sync data to a peer
   * @param {string} peerId - Remote peer ID
   * @private
   */
  _sendNextSyncBatch(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.socket || peer.socket.readyState !== WebSocket.OPEN) {
      this.activeSyncBatches.delete(peerId);
      return;
    }

    const batchInfo = this.activeSyncBatches.get(peerId);
    if (!batchInfo) return;

    const { updates, requestId, totalBatches, currentBatch } = batchInfo;

    // Prepare batch slice
    const start = currentBatch * this.options.batchSize;
    const end = Math.min(start + this.options.batchSize, updates.length);
    const batchUpdates = updates.slice(start, end);
    const isLastBatch = currentBatch === totalBatches - 1;

    try {
      // Send batch
      peer.socket.send(
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

      // Increment batch counter
      batchInfo.currentBatch++;

      // Clean up if this was the last batch
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
   * @param {string} peerId - Remote peer ID
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

      // Only apply if the update is newer
      if (update.timestamp > currentMeta.timestamp) {
        this.bullet._setData(update.path, update.data, update.timestamp, false);

        // Update metadata
        this.bullet.meta[update.path] = {
          timestamp: update.timestamp,
          source: peerId,
        };
      }
    });

    // Update last sync timestamp for this peer
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.lastSyncAt = message.timestamp;
    }

    // Send acknowledgment for this batch
    this._sendToPeer(peerId, {
      id: this._generateId(),
      type: "sync-ack",
      requestId: requestId,
      batchIndex: batchIndex,
      totalBatches: totalBatches,
      status: "processed",
      timestamp: Date.now(),
    });

    // Log completion if this was the last batch
    if (isComplete) {
      console.log(
        `Completed receiving sync from ${peerId}: ${totalBatches} batches`
      );
    }
  }

  /**
   * Handle sync acknowledgment from a peer
   * @param {string} peerId - Remote peer ID
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
      // Schedule sending the next batch with a delay
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
   * @param {string} peerId - Remote peer ID
   * @param {Object} message - Message object
   * @private
   */
  _handlePut(peerId, message) {
    const { path, data, timestamp, ttl } = message;

    // Check TTL to prevent infinite message propagation
    if (ttl !== undefined && ttl <= 0) {
      return;
    }

    // Check if the update is newer than what we have
    const currentMeta = this.bullet.meta[path] || { timestamp: 0 };

    if (timestamp > currentMeta.timestamp) {
      // Apply data change locally (without broadcasting)
      this.bullet._setData(path, data, timestamp, false);

      // Update metadata
      this.bullet.meta[path] = {
        timestamp,
        source: peerId,
      };

      // Relay message to other peers
      this._relayMessage(message, peerId);
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
      this.peers.forEach((peer, peerId) => {
        // Skip peers with recent syncs
        const lastSync = peer.lastSyncAt || 0;
        const now = Date.now();

        if (now - lastSync > this.options.syncInterval / 2) {
          this._sendSyncRequest(peerId);
        }
      });
    }, this.options.syncInterval);
  }

  /**
   * Send a sync request to a peer
   * @param {string} peerId - Remote peer ID
   * @private
   */
  _sendSyncRequest(peerId) {
    // Gather last sync timestamps for each path
    const lastSyncTimes = {};

    // Include sync times from our local transaction log
    this.bullet.log.forEach((entry) => {
      if (
        !lastSyncTimes[entry.path] ||
        lastSyncTimes[entry.path] < entry.timestamp
      ) {
        lastSyncTimes[entry.path] = entry.timestamp;
      }
    });

    // Send the sync request
    this._sendToPeer(peerId, {
      id: this._generateId(),
      type: "sync-request",
      requestId: this._generateId(),
      lastSync: lastSyncTimes,
      timestamp: Date.now(),
    });
  }

  /**
   * Send a message to a specific peer
   * @param {string} peerId - Remote peer ID
   * @param {Object} message - Message to send
   * @private
   */
  _sendToPeer(peerId, message) {
    const peer = this.peers.get(peerId);

    if (!peer || !peer.socket || peer.socket.readyState !== WebSocket.OPEN) {
      console.warn(`Cannot send to peer ${peerId}: No active connection`);
      return false;
    }

    try {
      peer.socket.send(JSON.stringify(message));
      return true;
    } catch (err) {
      console.error(`Error sending to peer ${peerId}:`, err);
      return false;
    }
  }

  /**
   * Relay a message to all peers except the source
   * @param {Object} message - Message to relay
   * @param {string} sourcePeerId - Source peer ID to exclude
   * @private
   */
  _relayMessage(message, sourcePeerId) {
    if (message.ttl !== undefined && message.ttl <= 0) {
      return;
    }

    // Create a new message with decremented TTL
    const relayMessage = {
      ...message,
      id: message.id || this._generateId(),
      ttl: (message.ttl !== undefined ? message.ttl : this.options.maxTTL) - 1,
    };

    // Mark as processed to prevent loops
    this.processedMessages.add(relayMessage.id);

    // Send to all peers except source
    this.peers.forEach((peer, peerId) => {
      if (peerId !== sourcePeerId) {
        this._sendToPeer(peerId, relayMessage);
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

    // Mark as processed to prevent loops
    this.processedMessages.add(message.id);

    // Send to all peers
    this.peers.forEach((peer, peerId) => {
      this._sendToPeer(peerId, message);
    });
  }

  /**
   * Generate a unique message ID
   * @return {string} - Unique ID
   * @private
   */
  _generateId() {
    return `${this.localPeerId.substr(0, 8)}-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
  }

  /**
   * Close all connections and stop the server
   * @public
   */
  close() {
    // Stop sync interval
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    // Close all peer connections
    this.peers.forEach((peer, peerId) => {
      try {
        if (peer.socket) {
          peer.socket.close();
        }
      } catch (err) {
        console.error(`Error closing connection to ${peerId}:`, err);
      }
    });

    // Close the server if running
    if (this.server) {
      try {
        this.server.close();
      } catch (err) {
        console.error("Error closing WebSocket server:", err);
      }
    }

    // Clear all state
    this.peers.clear();
    this.activeSyncBatches.clear();
    this.processedMessages.clear();

    console.log("BulletNetwork closed");
  }
}

module.exports = BulletNetwork;
