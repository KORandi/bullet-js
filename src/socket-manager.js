/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Enhanced SocketManager for P2P Server
 * Improves peer tracking and message broadcasting
 */

const socketIO = require("socket.io");
const { io: ioClient } = require("socket.io-client");

class SocketManager {
  constructor(server) {
    this.server = server;
    this.sockets = {}; // Map of peerID -> socket
    this.socketsByUrl = {}; // Map of url -> socket
    this.urlToPeerId = {}; // Map of url -> peerID
    this.peerIdToUrl = {}; // Map of peerID -> url
    this.io = null;
    this.myUrl = null;
  }

  /**
   * Initialize socket server
   */
  init(httpServer) {
    this.io = socketIO(httpServer);
    this.myUrl = `http://localhost:${this.server.port}`;

    this.io.on("connection", (socket) => {
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
      });

      socket.on("put", (data) => {
        console.log(`Received put from socket ${socket.id} for ${data.path}`);

        // Try to determine the peer ID
        let senderId = null;
        for (const [id, s] of Object.entries(this.sockets)) {
          if (s === socket) {
            senderId = id;
            break;
          }
        }

        // Add sender info to data
        if (senderId) {
          data.sender = senderId;
        }

        this.server.syncManager.handlePut(data);
      });

      socket.on("disconnect", () => {
        // Find and remove the disconnected socket
        let peerID = null;
        let peerUrl = null;

        // Find by socket
        for (const [id, s] of Object.entries(this.sockets)) {
          if (s.id === socket.id) {
            peerID = id;
            peerUrl = this.peerIdToUrl[id];
            break;
          }
        }

        // Remove all references
        if (peerID) {
          delete this.sockets[peerID];

          if (peerUrl) {
            delete this.socketsByUrl[peerUrl];
            delete this.peerIdToUrl[peerID];
            delete this.urlToPeerId[peerUrl];
          }

          console.log(
            `Peer disconnected: ${peerID} at ${peerUrl || "unknown"}`
          );
        } else {
          // If we couldn't find by ID, try by socket.id directly
          for (const [url, s] of Object.entries(this.socketsByUrl)) {
            if (s.id === socket.id) {
              delete this.socketsByUrl[url];
              console.log(`Socket disconnected from ${url}`);
              break;
            }
          }
        }
      });
    });
  }

  /**
   * Connect to known peers
   */
  connectToPeers(peerURLs) {
    peerURLs.forEach((url) => {
      try {
        // Skip self connections
        if (url === this.myUrl) {
          console.log(`Skipping self-connection to ${url}`);
          return;
        }

        console.log(`Attempting to connect to peer: ${url}`);
        const socket = ioClient(url);

        // Store socket by URL immediately
        this.socketsByUrl[url] = socket;

        socket.on("connect", () => {
          console.log(`Connected to peer: ${url}`);

          // Identify ourselves to the peer
          socket.emit("identify", {
            serverID: this.server.serverID,
            url: this.myUrl,
          });
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

        socket.on("put", (data) => {
          console.log(`Received put from peer ${url} for ${data.path}`);

          // Add sender info
          const peerId = this.urlToPeerId[url];
          if (peerId) {
            data.sender = peerId;
          } else {
            data.sender = url;
          }

          this.server.syncManager.handlePut(data);
        });

        socket.on("connect_error", (error) => {
          console.error(`Failed to connect to peer ${url}:`, error.message);
        });
      } catch (err) {
        console.error(`Error setting up connection to peer ${url}:`, err);
      }
    });
  }

  /**
   * Improved broadcast to use both ID and URL mappings with forwarding
   */
  broadcast(event, data) {
    // Get all connected peers, filter out ourselves
    const idPeers = Object.keys(this.sockets).filter(
      (id) => id !== this.server.serverID
    );
    const urlPeers = Object.keys(this.socketsByUrl);

    console.log(`Socket peers by ID: ${idPeers.join(", ") || "none"}`);
    console.log(`Socket peers by URL: ${urlPeers.join(", ") || "none"}`);

    // Add forwarding flag to prevent infinite loops
    // If this is already a forwarded message, don't add the flag again
    if (!data.forwarded) {
      data = { ...data, forwarded: false };
    }

    // Track which peers we've sent to
    const sentToPeers = new Set();
    let peerCount = 0;

    // First, send by peer ID (these are confirmed peers)
    for (const peerId of idPeers) {
      // Skip ourselves
      if (peerId === this.server.serverID) continue;

      // Skip if already sent
      if (sentToPeers.has(peerId)) continue;

      // Get the socket
      const socket = this.sockets[peerId];
      if (socket && socket.connected) {
        console.log(`Sending ${event} to peer ${peerId}`);
        socket.emit(event, data);
        sentToPeers.add(peerId);
        peerCount++;
      }
    }

    // Then send by URL for any remaining peers
    for (const url of urlPeers) {
      // Get the peer ID if known
      const peerId = this.urlToPeerId[url];

      // Skip if we already sent to this peer by ID
      if (peerId && sentToPeers.has(peerId)) continue;

      // Get the socket
      const socket = this.socketsByUrl[url];
      if (socket && socket.connected) {
        console.log(`Sending ${event} to peer at ${url}`);
        socket.emit(event, data);
        if (peerId) sentToPeers.add(peerId);
        peerCount++;
      }
    }

    console.log(`Broadcasting ${event} for ${data.path} to ${peerCount} peers`);
    return peerCount;
  }

  /**
   * Get the connection status
   */
  getConnectionStatus() {
    return {
      peersById: Object.keys(this.sockets),
      peersByUrl: Object.keys(this.socketsByUrl),
      peerCount: Object.keys(this.sockets).length,
    };
  }
}

module.exports = SocketManager;
