/**
 * SignalingClient - Handles connection to a central signaling server
 * Enables peers behind NAT to discover each other and establish WebRTC connections
 */

const { io } = require("socket.io-client");

class SignalingClient {
  /**
   * Create a new SignalingClient
   * @param {Object} options - Signaling configuration
   * @param {string} options.server - Signaling server URL
   * @param {string} peerId - ID of this peer
   * @param {Function} onConnect - Callback when connected to signaling server
   * @param {Function} onPeerDiscovered - Callback when a new peer is discovered
   * @param {Function} onSignal - Callback when signal is received
   */
  constructor(options, peerId, onConnect, onPeerDiscovered, onSignal) {
    this.options = options;
    this.peerId = peerId;
    this.onConnect = onConnect;
    this.onPeerDiscovered = onPeerDiscovered;
    this.onSignal = onSignal;
    this.connectedPeers = new Set();
    this.socket = null;
    this.isShuttingDown = false;
  }

  /**
   * Connect to the signaling server
   */
  connect() {
    if (!this.options.server) {
      console.warn(
        "No signaling server specified, WebRTC NAT traversal will be limited"
      );
      return;
    }

    console.log(`Connecting to signaling server at ${this.options.server}`);

    this.socket = io(this.options.server, {
      reconnectionDelayMax: 10000,
      reconnection: true,
      reconnectionAttempts: 10,
    });

    this.socket.on("connect", () => {
      console.log("Connected to signaling server");

      // Register with the signaling server
      this.socket.emit("register", {
        peerId: this.peerId,
      });

      if (this.onConnect) {
        this.onConnect();
      }
    });

    this.socket.on("registered", (data) => {
      console.log(
        `Successfully registered with signaling server as ${this.peerId}`
      );

      // Update our list of known peers
      if (data.connectedPeers && Array.isArray(data.connectedPeers)) {
        data.connectedPeers.forEach((peerId) => {
          if (this.onPeerDiscovered) {
            this.onPeerDiscovered(peerId);
          }
        });
      }
    });

    this.socket.on("peer-joined", (data) => {
      if (data.peerId && data.peerId !== this.peerId) {
        console.log(`New peer joined: ${data.peerId}`);

        if (this.onPeerDiscovered) {
          this.onPeerDiscovered(data.peerId);
        }
      }
    });

    this.socket.on("peer-left", (data) => {
      if (data.peerId) {
        console.log(`Peer left: ${data.peerId}`);
        this.connectedPeers.delete(data.peerId);
      }
    });

    this.socket.on("webrtc-signal", (data) => {
      if (data.senderPeerId && data.signal) {
        if (this.onSignal) {
          this.onSignal(data.senderPeerId, data.signal, data.type);
        }
      }
    });

    this.socket.on("connection-request", (data) => {
      if (data.senderPeerId && data.connectionId) {
        console.log(`Received connection request from ${data.senderPeerId}`);

        // Accept the connection
        this.socket.emit("connection-response", {
          targetPeerId: data.senderPeerId,
          senderPeerId: this.peerId,
          connectionId: data.connectionId,
          accepted: true,
        });

        if (this.onPeerDiscovered) {
          this.onPeerDiscovered(data.senderPeerId);
        }
      }
    });

    this.socket.on("disconnect", () => {
      console.log("Disconnected from signaling server");
    });

    this.socket.on("error", (error) => {
      console.error("Signaling server error:", error);
    });
  }

  /**
   * Request a connection to a peer through the signaling server
   * @param {string} targetPeerId - Peer to connect to
   */
  requestConnection(targetPeerId) {
    if (!this.socket || !this.socket.connected) {
      console.warn(
        "Not connected to signaling server, cannot request connection"
      );
      return;
    }

    console.log(`Requesting connection to peer ${targetPeerId}`);

    this.socket.emit("request-connection", {
      targetPeerId,
      senderPeerId: this.peerId,
    });
  }

  /**
   * Send a WebRTC signal through the signaling server
   * @param {string} targetPeerId - Peer to send signal to
   * @param {Object} signal - WebRTC signal data
   * @param {string} type - Signal type (offer, answer, candidate)
   */
  sendSignal(targetPeerId, signal, type = "signal") {
    if (!this.socket || !this.socket.connected) {
      console.warn("Not connected to signaling server, cannot send signal");
      return;
    }

    this.socket.emit("webrtc-signal", {
      targetPeerId,
      senderPeerId: this.peerId,
      signal,
      type,
    });
  }

  /**
   * Close the connection to the signaling server
   */
  close() {
    this.isShuttingDown = true;

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    console.log("Closed connection to signaling server");
  }
}

module.exports = SignalingClient;
