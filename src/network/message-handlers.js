/**
 * Message Handlers for P2P Server
 * Processes WebSocket messages from peers
 */

/**
 * Set up socket message handlers
 * @param {Object} socket - Socket.IO socket instance
 * @param {Object} server - P2PServer instance
 * @param {boolean} [isIncoming=true] - Whether this is an incoming connection
 */
function setupMessageHandlers(socket, server, isIncoming = true) {
  const connectionType = isIncoming ? "incoming" : "outgoing";

  // Handle 'put' messages (data updates)
  socket.on("put", (data) => {
    // Ignore if shutting down
    if (server.isShuttingDown) {
      console.log("Ignoring put message during shutdown");
      return;
    }

    console.log(
      `Received put from ${connectionType} socket ${socket.id} for ${data.path}`
    );

    // Try to determine the peer ID
    let senderId = null;
    if (isIncoming) {
      // For incoming connections, try to find in socket mapping
      for (const [id, s] of Object.entries(server.socketManager.sockets)) {
        if (s === socket) {
          senderId = id;
          break;
        }
      }
    } else {
      // For outgoing connections, we can get it from URL mapping
      for (const [url, s] of Object.entries(
        server.socketManager.socketsByUrl
      )) {
        if (s === socket) {
          senderId = server.socketManager.urlToPeerId[url];
          break;
        }
      }
    }

    // Add sender info to data
    if (senderId) {
      data.sender = senderId;
    }

    // Process the update
    server.syncManager.handlePut(data);
  });

  // Handle vector clock synchronization
  socket.on("vector-clock-sync", (data) => {
    if (server.isShuttingDown) return;

    // Process via sync manager
    if (server.syncManager) {
      server.syncManager.handleVectorClockSync(data, socket);
    }
  });

  // Handle vector clock synchronization responses
  socket.on("vector-clock-sync-response", (data) => {
    if (server.isShuttingDown) return;

    // Process via sync manager
    if (server.syncManager) {
      server.syncManager.handleVectorClockSyncResponse(data);
    }
  });

  // Handle disconnect event
  socket.on("disconnect", () => {
    // This is handled by SocketManager's connection tracking
    console.log(
      `Socket ${socket.id} disconnected (${connectionType} connection)`
    );
  });
}

/**
 * Set up handlers for vector clock synchronization
 * @param {Object} server - P2PServer instance
 */
function handleVectorClockSync(data, socket, server) {
  // Skip if shutting down
  if (server.isShuttingDown) return;

  try {
    // Validate the data
    if (!data || !data.vectorClock || !data.nodeId) {
      console.warn("Invalid vector clock sync data:", data);
      return;
    }

    // Handle via sync manager
    server.syncManager.handleVectorClockSync(data, socket);
  } catch (error) {
    console.error("Error handling vector clock sync:", error);
  }
}

/**
 * Handle response to vector clock synchronization
 * @param {Object} data - Response data
 * @param {Object} server - P2PServer instance
 */
function handleVectorClockSyncResponse(data, server) {
  // Skip if shutting down
  if (server.isShuttingDown) return;

  try {
    server.syncManager.handleVectorClockSyncResponse(data);
  } catch (error) {
    console.error("Error handling vector clock sync response:", error);
  }
}

module.exports = {
  setupMessageHandlers,
  handleVectorClockSync,
  handleVectorClockSyncResponse,
};
