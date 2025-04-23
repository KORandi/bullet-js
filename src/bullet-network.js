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
      batchDelay: 13,
      ...options,
    };

    this.localPeerId = this.bullet.id;

    this.peers = new Map();

    this.server = null;

    this.processedMessages = new Set();

    this.activeSyncBatches = new Map();

    if (this.options.server !== false) {
      this._startListening();
    }

    this._connectToPeers();

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

    if (remotePeerId === this.localPeerId) {
      console.warn("Rejecting connection from self");
      socket.close();
      return;
    }

    console.log(`Incoming connection from peer: ${remotePeerId}`);

    const existingPeer = this.peers.get(remotePeerId);

    if (
      existingPeer &&
      existingPeer.socket &&
      existingPeer.socket.readyState === WebSocket.OPEN
    ) {
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

        socket.send(
          JSON.stringify({
            type: "handshake",
            id: this._generateId(),
            peerId: this.localPeerId,
            timestamp: Date.now(),
          })
        );

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

              if (remotePeerId === this.localPeerId) {
                console.warn("Connected to self, closing connection");
                socket.close();
                return;
              }

              socket.removeListener("message", handleHandshake);

              this._setupPeerConnection(socket, remotePeerId, true, peerUrl);

              this._sendInitSyncRequest(remotePeerId);
            }
          } catch (err) {
            console.error("Error handling handshake:", err);
          }
        };

        socket.on("message", handleHandshake);
      });

      socket.on("error", (error) => {
        console.error(`Error connecting to peer ${peerUrl}:`, error);

        setTimeout(() => {
          this._connectToPeer(peerUrl);
        }, 5000);
      });
    } catch (err) {
      console.error(`Failed to connect to peer ${peerUrl}:`, err);

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
    const peerInfo = {
      peerId,
      socket,
      outbound,
      url: peerUrl,
      connectedAt: Date.now(),
      lastSyncAt: 0,
    };

    this.peers.set(peerId, peerInfo);

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

      this.peers.delete(peerId);

      this.activeSyncBatches.delete(peerId);

      if (outbound && peerUrl && this.options.peers.includes(peerUrl)) {
        console.log(`Will attempt to reconnect to ${peerUrl} in 5 seconds`);
        setTimeout(() => {
          this._connectToPeer(peerUrl);
        }, 5000);
      }
    });

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
      case "handshake":
      case "handshake-response":
        break;

      case "sync-request":
        this._handleSyncRequest(peerId, message);
        break;

      case "sync-request-full":
        this._handleSyncRequest(peerId, message, true);
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
   * @param {boolean} full - Force full update
   * @private
   */
  async _handleSyncRequest(peerId, message, full = false) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.socket || peer.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const requestId = message.requestId || this._generateId();
    const lastSync = message.lastSync || {};

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

    const allUpdates = await this._getUpdatesSince(lastSync, full);

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

    const start = currentBatch * this.options.batchSize;
    const end = Math.min(start + this.options.batchSize, updates.length);
    const batchUpdates = updates.slice(start, end);
    const isLastBatch = currentBatch === totalBatches - 1;

    try {
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

    updates.forEach((update) => {
      const currentMeta = this.bullet.meta[update.path] || { timestamp: 0 };

      if (update.timestamp > currentMeta.timestamp) {
        this.bullet._setData(update.path, update.data, update.timestamp, false);

        this.bullet.meta[update.path] = {
          timestamp: update.timestamp,
          source: peerId,
        };
      }
    });

    const peer = this.peers.get(peerId);
    if (peer) {
      peer.lastSyncAt = message.timestamp;
    }

    this._sendToPeer(peerId, {
      id: this._generateId(),
      type: "sync-ack",
      requestId: requestId,
      batchIndex: batchIndex,
      totalBatches: totalBatches,
      status: "processed",
      timestamp: Date.now(),
    });

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

    if (!this.activeSyncBatches.has(peerId)) {
      console.log(
        `Received sync-ack from ${peerId} but no active sync session found`
      );
      return;
    }

    const batchInfo = this.activeSyncBatches.get(peerId);

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

    if (batchInfo.currentBatch < batchInfo.totalBatches) {
      setTimeout(() => {
        this._sendNextSyncBatch(peerId);
      }, this.options.batchDelay);
    } else {
      console.log(`Completed sync session with ${peerId}`);

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

      this._relayMessage(message, peerId);
    }
  }

  /**
   * Get updates since the given timestamps
   * @param {Object} lastSync - Map of paths to timestamps
   * @param {boolean} full - Force full update
   * @return {Array} - Array of updates
   * @private
   */
  async _getUpdatesSince(lastSync, full = false) {
    const updates = [];
    if (!full || this.bullet.enableStorageLog) {
      for (const entry of this.bullet.log) {
        const pathTimestamp = lastSync[entry.path] || 0;

        if (entry.timestamp > pathTimestamp) {
          updates.push({
            path: entry.path,
            data: entry.data,
            timestamp: entry.timestamp,
          });
        }
      }
    } else {
      const iterator = this.bullet.storage.getHistoryIterator({
        reverse: true,
      });

      await iterator.forEach((entry) => {
        updates.push({
          path: entry.path,
          data: entry.data,
          timestamp: entry.timestamp,
        });
      });
    }

    return updates;
  }

  /**
   * Start the periodic sync cycle
   * @private
   */
  _startSyncCycle() {
    this.syncInterval = setInterval(() => {
      this.peers.forEach((peer, peerId) => {
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
    const lastSyncTimes = {};

    this.bullet.log.forEach((entry) => {
      if (
        !lastSyncTimes[entry.path] ||
        lastSyncTimes[entry.path] < entry.timestamp
      ) {
        lastSyncTimes[entry.path] = entry.timestamp;
      }
    });

    this._sendToPeer(peerId, {
      id: this._generateId(),
      type: "sync-request",
      requestId: this._generateId(),
      lastSync: lastSyncTimes,
      timestamp: Date.now(),
    });
  }

  _sendInitSyncRequest(peerId) {
    this._sendToPeer(peerId, {
      id: this._generateId(),
      type: "sync-request-full",
      requestId: this._generateId(),
      lastSync: null,
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

    const relayMessage = {
      ...message,
      id: message.id || this._generateId(),
      ttl: (message.ttl !== undefined ? message.ttl : this.options.maxTTL) - 1,
    };

    this.processedMessages.add(relayMessage.id);

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

    this.processedMessages.add(message.id);

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
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.peers.forEach((peer, peerId) => {
      try {
        if (peer.socket) {
          peer.socket.close();
        }
      } catch (err) {
        console.error(`Error closing connection to ${peerId}:`, err);
      }
    });

    if (this.server) {
      try {
        this.server.close();
      } catch (err) {
        console.error("Error closing WebSocket server:", err);
      }
    }

    this.peers.clear();
    this.activeSyncBatches.clear();
    this.processedMessages.clear();

    console.log("BulletNetwork closed");
  }
}

module.exports = BulletNetwork;
