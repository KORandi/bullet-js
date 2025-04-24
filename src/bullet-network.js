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
      ...options,
    };

    this.localPeerId = this.bullet.id;
    this.peers = new Map();
    this.server = null;
    this.processedMessages = new Set();

    if (this.options.server !== false) {
      this._startListening();
    }

    this._connectToPeers();
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

      case "put":
        this._handlePut(peerId, message);
        break;

      default:
        console.warn(`Unknown message type from ${peerId}:`, message.type);
    }
  }

  /**
   * Handle put operation from a peer
   * @param {string} peerId - Remote peer ID
   * @param {Object} message - Message object
   * @private
   */
  _handlePut(peerId, message) {
    const { path, data, ttl } = message;

    if (ttl !== undefined && ttl <= 0) {
      return;
    }

    const networkData =
      typeof data === "object" && data !== null
        ? { ...data, __fromNetwork: true }
        : data;

    this.bullet.setData(path, networkData, false);
    this._relayMessage(message, peerId);
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

    this.peers.forEach((_, peerId) => {
      if (peerId !== sourcePeerId) {
        this._sendToPeer(peerId, relayMessage);
      }
    });
  }

  /**
   * Broadcast a data change to all peers
   * @param {string} path - Data path
   * @param {*} data - New data
   * @public
   */
  broadcast(path, data) {
    const message = {
      id: this._generateId(),
      type: "put",
      path,
      data,
      ttl: this.options.maxTTL,
    };

    this.processedMessages.add(message.id);

    this.peers.forEach((_, peerId) => {
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
    this.processedMessages.clear();

    console.log("BulletNetwork closed");
  }
}

module.exports = BulletNetwork;
