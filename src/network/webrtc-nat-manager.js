/**
 * WebRTCNATManager - Specialized manager for WebRTC connections that can traverse NAT
 * Uses a signaling server to connect peers that would otherwise be unreachable
 */

const SimplePeer = require("simple-peer");
const wrtc = require("@roamhq/wrtc"); // Používáme vylepšenou verzi wrtc
const SignalingClient = require("./signaling-client");

class WebRTCNATManager {
  /**
   * Create a new WebRTCNATManager
   * @param {Object} options - WebRTC configuration options
   * @param {Object} server - P2PServer instance
   */
  constructor(options, server) {
    this.server = server;
    this.enabled = options.enabled || false;
    this.connections = new Map(); // peerID -> { peer, connected }
    this.pendingConnections = new Map(); // peerId -> { initiator }
    this.isShuttingDown = false;

    // WebRTC configuration with STUN servers
    this.config = {
      iceServers: [
        {
          urls: options.stunServers || [
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302",
          ],
        },
      ],
    };

    // Get signaling server URL
    this.signalingServer = options.signalingServer || null;

    // Create signaling client if signaling server is configured
    if (this.signalingServer) {
      this.signalingClient = new SignalingClient(
        { server: this.signalingServer },
        server.serverID,
        () => this.onSignalingConnected(),
        (peerId) => this.onPeerDiscovered(peerId),
        (peerId, signal, type) => this.onSignalReceived(peerId, signal, type)
      );
    } else {
      this.signalingClient = null;
    }

    console.log(
      "WebRTC NAT traversal manager created with config:",
      JSON.stringify(this.config, null, 2)
    );

    if (this.signalingServer) {
      console.log(`Using signaling server: ${this.signalingServer}`);
    } else {
      console.log(
        "No signaling server configured. WebRTC connections will only work with direct peer connections or over local network."
      );
    }
  }

  /**
   * Initialize the WebRTC NAT manager
   */
  init() {
    if (!this.enabled) {
      console.log("WebRTC is disabled, skipping initialization");
      return;
    }

    try {
      // Check if WebRTC implementation is available
      if (!wrtc) {
        console.warn(
          "WebRTC implementation (@roamhq/wrtc package) not available, WebRTC will be disabled"
        );
        this.enabled = false;
        return;
      }

      // Connect to signaling server if configured
      if (this.signalingClient) {
        this.signalingClient.connect();
      }

      console.log("WebRTC NAT traversal manager initialized successfully");
    } catch (error) {
      console.error("Error initializing WebRTC NAT manager:", error);
      this.enabled = false;
    }
  }

  /**
   * Handler for when signaling server connects
   */
  onSignalingConnected() {
    console.log(
      "Connected to signaling server, can now establish WebRTC connections with NAT traversal"
    );

    // Notify server that we can accept WebRTC connections
    if (this.server.socketManager) {
      this.server.socketManager.webrtcEnabled = true;
    }
  }

  /**
   * Handler for when a peer is discovered via signaling server
   * @param {string} peerId - The discovered peer ID
   */
  onPeerDiscovered(peerId) {
    if (this.isShuttingDown || !this.enabled) return;

    console.log(`Discovered peer via signaling server: ${peerId}`);

    // Initiate WebRTC connection if we don't have one already
    if (!this.connections.has(peerId) && !this.pendingConnections.has(peerId)) {
      this.connectToPeer(peerId);
    }
  }

  /**
   * Handler for received WebRTC signals (offers, answers, candidates)
   * @param {string} peerId - Peer ID sending the signal
   * @param {Object} signal - The WebRTC signal
   * @param {string} type - Signal type (optional)
   */
  onSignalReceived(peerId, signal, type) {
    if (this.isShuttingDown || !this.enabled) return;

    // Get existing connection or create new one
    let peerConnection = this.connections.get(peerId);

    if (peerConnection && peerConnection.peer) {
      // Use existing connection
      try {
        peerConnection.peer.signal(signal);
      } catch (error) {
        console.error(`Error processing signal from peer ${peerId}:`, error);
      }
    } else if (type === "offer") {
      // Create new peer connection as non-initiator (answering)
      console.log(
        `Creating new peer connection in response to offer from ${peerId}`
      );
      this.createPeerConnection(peerId, false);

      // Mark as pending
      this.pendingConnections.set(peerId, { initiator: false });

      // Process the signal with the new peer
      const newConnection = this.connections.get(peerId);
      if (newConnection && newConnection.peer) {
        try {
          newConnection.peer.signal(signal);
        } catch (error) {
          console.error(`Error processing offer from peer ${peerId}:`, error);
        }
      }
    } else {
      console.warn(
        `Received signal from ${peerId} but no connection exists and it's not an offer`
      );
    }
  }

  /**
   * Create a WebRTC peer connection
   * @param {string} peerId - Remote peer ID
   * @param {boolean} initiator - Whether this peer is the initiator
   * @returns {Object} Peer connection information
   */
  createPeerConnection(peerId, initiator = false) {
    // Check if we already have this connection
    if (this.connections.has(peerId)) {
      const existing = this.connections.get(peerId);
      if (existing.connected) {
        return existing;
      }

      // Clean up old connection if it exists but isn't connected
      if (existing.peer) {
        try {
          existing.peer.destroy();
        } catch (e) {
          // Ignore errors during cleanup
        }
      }
    }

    console.log(
      `Creating new WebRTC peer connection with ${peerId} (initiator: ${initiator})`
    );

    // Create the peer with our WebRTC configuration
    const peer = new SimplePeer({
      initiator,
      wrtc,
      trickle: true,
      config: this.config,
    });

    // Store connection info
    const peerInfo = {
      peer,
      connected: false,
      initiator,
      peerId,
      createdAt: Date.now(),
    };

    this.connections.set(peerId, peerInfo);

    // Set up event handlers
    peer.on("error", (err) => {
      console.error(`WebRTC error with peer ${peerId}:`, err.message);
      this.handlePeerFailure(peerId);
    });

    peer.on("signal", (data) => {
      // Send signal through signaling server if available
      if (this.signalingClient) {
        this.signalingClient.sendSignal(
          peerId,
          data,
          initiator ? "offer" : "answer"
        );
      } else {
        console.warn(
          `No signaling mechanism available to send signal to ${peerId}`
        );
      }
    });

    peer.on("connect", () => {
      console.log(`WebRTC connection established with peer ${peerId}`);
      peerInfo.connected = true;

      // Remove from pending connections
      this.pendingConnections.delete(peerId);

      // Notify the socket manager about the new connection
      if (this.server.socketManager) {
        this.server.socketManager.registerWebRTCPeer(peerId, peer);
      }

      // Start synchronization process
      this.initiateSync(peerId);
    });

    peer.on("close", () => {
      console.log(`WebRTC connection closed with peer ${peerId}`);
      this.handlePeerDisconnect(peerId);
    });

    peer.on("data", (data) => {
      try {
        // Parse the message
        const message = JSON.parse(data.toString());
        const { type, ...payload } = message;

        // Handle different message types
        switch (type) {
          case "put":
            if (this.server.syncManager) {
              this.server.syncManager.handlePut(payload);
            }
            break;

          case "vector-clock-sync":
            if (this.server.syncManager) {
              this.server.syncManager.handleVectorClockSync(payload, {
                emit: (eventName, data) => {
                  this.sendToPeer(peerId, eventName, data);
                },
                id: `webrtc-${peerId}`,
                connected: true,
              });
            }
            break;

          case "vector-clock-sync-response":
            if (this.server.syncManager) {
              this.server.syncManager.handleVectorClockSyncResponse(payload);
            }
            break;

          case "anti-entropy-request":
            if (this.server.syncManager) {
              this.server.syncManager.handleAntiEntropyRequest(payload, {
                emit: (eventName, data) => {
                  this.sendToPeer(peerId, eventName, data);
                },
                id: `webrtc-${peerId}`,
                connected: true,
              });
            }
            break;

          case "anti-entropy-response":
            if (this.server.syncManager) {
              this.server.syncManager.handleAntiEntropyResponse(payload);
            }
            break;

          default:
            console.warn(
              `Unknown WebRTC message type from peer ${peerId}:`,
              type
            );
        }
      } catch (error) {
        console.error(
          `Error processing WebRTC message from peer ${peerId}:`,
          error
        );
      }
    });

    return peerInfo;
  }

  /**
   * Initiate synchronization with a newly connected peer
   * @param {string} peerId - Peer ID to sync with
   */
  initiateSync(peerId) {
    if (this.isShuttingDown || !this.enabled) return;

    // Immediately synchronize vector clocks
    if (this.server.syncManager) {
      const syncMessage = {
        type: "vector-clock-sync",
        vectorClock: this.server.syncManager.getVectorClock(),
        nodeId: this.server.serverID,
        timestamp: Date.now(),
        syncId: `webrtc-init-${this.server.serverID}-${Date.now()}`,
      };

      this.sendToPeer(peerId, "vector-clock-sync", syncMessage);

      // Run anti-entropy to sync data
      setTimeout(() => {
        if (!this.isShuttingDown && this.server.syncManager) {
          this.server.syncManager.runAntiEntropy();
        }
      }, 1000);
    }
  }

  /**
   * Handle peer disconnection
   * @param {string} peerId - Peer ID that disconnected
   */
  handlePeerDisconnect(peerId) {
    const peerInfo = this.connections.get(peerId);

    if (peerInfo) {
      peerInfo.connected = false;

      // Notify the socket manager
      if (this.server.socketManager) {
        this.server.socketManager.unregisterWebRTCPeer(peerId);
      }
    }

    // Remove from connections map
    this.connections.delete(peerId);
    this.pendingConnections.delete(peerId);
  }

  /**
   * Handle peer connection failure
   * @param {string} peerId - Peer ID that failed
   */
  handlePeerFailure(peerId) {
    // Clean up the failed connection
    this.handlePeerDisconnect(peerId);

    // If this was a pending connection, try again with a delay
    if (this.pendingConnections.has(peerId)) {
      const pendingInfo = this.pendingConnections.get(peerId);
      this.pendingConnections.delete(peerId);

      // Try again if we were the initiator, with exponential backoff
      if (pendingInfo.initiator && pendingInfo.retryCount < 3) {
        const retryDelay = Math.pow(2, pendingInfo.retryCount || 0) * 1000;
        console.log(`Scheduling retry for peer ${peerId} in ${retryDelay}ms`);

        setTimeout(() => {
          if (!this.isShuttingDown && this.enabled) {
            console.log(`Retrying connection to peer ${peerId}`);
            this.connectToPeer(peerId, (pendingInfo.retryCount || 0) + 1);
          }
        }, retryDelay);
      }
    }
  }

  /**
   * Connect to a peer via WebRTC
   * @param {string} peerId - Peer ID to connect to
   * @param {number} retryCount - Number of previous retry attempts
   * @returns {Promise<boolean>} Whether connection was initiated successfully
   */
  async connectToPeer(peerId, retryCount = 0) {
    if (this.isShuttingDown || !this.enabled) return false;

    // Don't connect to ourselves
    if (peerId === this.server.serverID) {
      return false;
    }

    // Check if already connected
    if (this.connections.has(peerId)) {
      const peerInfo = this.connections.get(peerId);
      if (peerInfo.connected) {
        return true;
      }
    }

    // Check if already pending
    if (this.pendingConnections.has(peerId)) {
      return true;
    }

    console.log(`Initiating WebRTC connection to peer ${peerId}`);

    try {
      // Record pending connection
      this.pendingConnections.set(peerId, {
        initiator: true,
        retryCount: retryCount,
      });

      // Create a new peer connection as initiator
      this.createPeerConnection(peerId, true);

      return true;
    } catch (error) {
      console.error(
        `Error initiating WebRTC connection to peer ${peerId}:`,
        error
      );
      this.pendingConnections.delete(peerId);
      return false;
    }
  }

  /**
   * Send a message to a peer via WebRTC
   * @param {string} peerId - Peer ID
   * @param {string} eventName - Event name (message type)
   * @param {Object} data - Message data
   * @returns {boolean} Whether message was sent successfully
   */
  sendToPeer(peerId, eventName, data) {
    if (this.isShuttingDown || !this.enabled) return false;

    const peerInfo = this.connections.get(peerId);

    if (!peerInfo || !peerInfo.connected) {
      return false;
    }

    try {
      // Create message with type field for event name
      const message = {
        type: eventName,
        ...data,
      };

      // Send message as string
      peerInfo.peer.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error(`Error sending WebRTC message to peer ${peerId}:`, error);
      return false;
    }
  }

  /**
   * Check if connected to a peer via WebRTC
   * @param {string} peerId - Peer ID to check
   * @returns {boolean} Whether connected to this peer
   */
  isConnectedToPeer(peerId) {
    if (!this.enabled) return false;

    const peerInfo = this.connections.get(peerId);
    return !!(peerInfo && peerInfo.connected);
  }

  /**
   * Broadcast a message to all connected WebRTC peers
   * @param {string} eventName - Event name
   * @param {Object} data - Message data
   * @returns {number} Number of peers message was sent to
   */
  broadcast(eventName, data) {
    if (this.isShuttingDown || !this.enabled) return 0;

    let sentCount = 0;

    for (const [peerId, peerInfo] of this.connections.entries()) {
      if (peerInfo.connected && this.sendToPeer(peerId, eventName, data)) {
        sentCount++;
      }
    }

    return sentCount;
  }

  /**
   * Get connection statistics
   * @returns {Object} Connection statistics
   */
  getConnectionStats() {
    const connectedPeers = [];
    const pendingPeers = [];

    for (const [peerId, peerInfo] of this.connections.entries()) {
      if (peerInfo.connected) {
        connectedPeers.push(peerId);
      } else {
        pendingPeers.push(peerId);
      }
    }

    return {
      connectedPeers,
      pendingPeers,
      connectedCount: connectedPeers.length,
      pendingCount: pendingPeers.length,
      totalCount: this.connections.size,
      signalingConnected: this.signalingClient
        ? this.signalingClient.socket && this.signalingClient.socket.connected
        : false,
    };
  }

  /**
   * Close all WebRTC connections
   */
  closeAllConnections() {
    this.isShuttingDown = true;
    console.log("Closing all WebRTC NAT connections");

    // Close signaling client
    if (this.signalingClient) {
      this.signalingClient.close();
    }

    // Close all peer connections
    for (const [peerId, peerInfo] of this.connections.entries()) {
      try {
        console.log(`Closing WebRTC connection to peer ${peerId}`);
        if (peerInfo.peer) {
          peerInfo.peer.destroy();
        }
      } catch (error) {
        console.error(
          `Error closing WebRTC connection to peer ${peerId}:`,
          error
        );
      }
    }

    this.connections.clear();
    this.pendingConnections.clear();
  }
}

module.exports = WebRTCNATManager;
