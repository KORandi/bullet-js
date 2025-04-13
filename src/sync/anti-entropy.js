/**
 * Anti-Entropy - Handles periodic synchronization to ensure data consistency
 */

class AntiEntropy {
  /**
   * Create a new AntiEntropy instance
   * @param {Object} syncManager - SyncManager instance
   */
  constructor(syncManager) {
    this.syncManager = syncManager;
    this.lastFullSync = 0;
  }

  /**
   * Run anti-entropy synchronization with peers
   * @returns {Promise<void>}
   */
  async run() {
    const syncManager = this.syncManager;
    const server = syncManager.server;

    if (syncManager.isShuttingDown) {
      console.log("Skipping anti-entropy synchronization during shutdown");
      return;
    }

    console.log("Starting anti-entropy synchronization");

    try {
      // Get list of peers
      const peers = Object.keys(server.socketManager.sockets);
      if (peers.length === 0) {
        console.log("No peers connected, skipping anti-entropy");
        return;
      }

      // Choose peers to synchronize with
      const selectedPeers = [];

      for (const peer of peers) {
        const socket = server.socketManager.sockets[peer];
        if (socket && socket.connected) {
          selectedPeers.push(peer);
          syncManager.knownNodeIds.add(peer);
        }
      }

      console.log(`Running anti-entropy with ${selectedPeers.length} peers`);

      // Get all changes to share
      const allChanges = await this._getRecentChanges();
      console.log(`Found ${allChanges.length} changes to sync`);

      // Create a batch ID for this anti-entropy run
      const batchId = `anti-entropy-${server.serverID}-${Date.now()}`;

      // First, synchronize vector clocks
      await this._syncVectorClocksWithPeers(selectedPeers, batchId);

      // Then send all data changes
      await this._syncDataWithPeers(selectedPeers, allChanges, batchId);

      // Run final vector clock sync
      await this.synchronizeVectorClocks();

      console.log("Anti-entropy synchronization completed");
    } catch (error) {
      console.error("Error during anti-entropy synchronization:", error);
    }
  }

  /**
   * Synchronize vector clocks with peers
   * @private
   * @param {Array<string>} peers - Peer IDs
   * @param {string} batchId - Unique batch ID
   * @returns {Promise<void>}
   */
  async _syncVectorClocksWithPeers(peers, batchId) {
    const syncManager = this.syncManager;
    const server = syncManager.server;

    for (const peer of peers) {
      const socket = server.socketManager.sockets[peer];

      if (!socket || !socket.connected) continue;

      // Send vector clock synchronization message
      const syncMessage = {
        type: "vector-clock-sync",
        vectorClock: syncManager.vectorClock.toJSON(),
        nodeId: server.serverID,
        timestamp: Date.now(),
        syncId: `${batchId}-clock-${Math.random()
          .toString(36)
          .substring(2, 9)}`,
      };

      socket.emit("vector-clock-sync", syncMessage);
    }

    // Wait for vector clock exchanges to process
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  /**
   * Synchronize data with peers
   * @private
   * @param {Array<string>} peers - Peer IDs
   * @param {Array<Object>} changes - Data changes
   * @param {string} batchId - Unique batch ID
   * @returns {Promise<void>}
   */
  async _syncDataWithPeers(peers, changes, batchId) {
    const syncManager = this.syncManager;
    const server = syncManager.server;

    for (const peer of peers) {
      const socket = server.socketManager.sockets[peer];

      if (!socket || !socket.connected) {
        console.log(`Selected peer ${peer} is not connected, skipping`);
        continue;
      }

      let syncCount = 0;

      for (const change of changes) {
        // Skip if shutting down mid-process
        if (syncManager.isShuttingDown) break;

        // Create a unique message ID
        const msgId = `${batchId}-${syncCount}-${Math.random()
          .toString(36)
          .substring(2, 9)}`;

        // Prepare sync data with current vector clock
        const syncData = {
          path: change.path,
          value: change.value,
          timestamp: change.timestamp,
          origin: change.origin,
          vectorClock: syncManager.vectorClock.toJSON(),
          msgId: msgId,
          forwarded: true,
          antiEntropy: true,
        };

        // Send to the selected peer
        socket.emit("put", syncData);
        syncCount++;

        // Add a small delay every 20 items to prevent flooding
        if (syncCount % 20 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }

      console.log(`Sent ${syncCount} changes to peer ${peer} for anti-entropy`);
    }
  }

  /**
   * Synchronize vector clocks across nodes
   * @returns {Promise<void>}
   */
  async synchronizeVectorClocks() {
    const syncManager = this.syncManager;
    const server = syncManager.server;

    // Skip if shutting down
    if (syncManager.isShuttingDown) return;

    // Don't run too frequently
    const now = Date.now();
    if (now - this.lastFullSync < 1000) return;
    this.lastFullSync = now;

    try {
      // Get connections
      const sockets = server.socketManager.sockets;
      if (Object.keys(sockets).length === 0) return;

      // Prepare synchronization message
      const syncMessage = {
        type: "vector-clock-sync",
        vectorClock: syncManager.vectorClock.toJSON(),
        nodeId: server.serverID,
        timestamp: now,
        syncId: `${server.serverID}-${now}-${Math.random()
          .toString(36)
          .substring(2, 9)}`,
      };

      // Send to all connected peers
      let syncCount = 0;
      for (const [peerId, socket] of Object.entries(sockets)) {
        if (socket && socket.connected) {
          // Track this node ID
          syncManager.knownNodeIds.add(peerId);

          // Send synchronization message
          socket.emit("vector-clock-sync", syncMessage);
          syncCount++;
        }
      }

      // Ensure all known node IDs are in our vector clock
      for (const nodeId of syncManager.knownNodeIds) {
        if (!(nodeId in syncManager.vectorClock.clock)) {
          syncManager.vectorClock.clock[nodeId] = 0;
        }
      }

      if (syncManager.debugMode && syncCount > 0) {
        console.log(
          `Sent vector clock sync to ${syncCount} peers: ${syncManager.vectorClock.toString()}`
        );
      }
    } catch (error) {
      console.error("Error synchronizing vector clocks:", error);
    }
  }

  /**
   * Get recent changes for anti-entropy sync
   * @private
   * @returns {Promise<Array>} - List of changes
   */
  async _getRecentChanges() {
    try {
      // Get all data from the database
      return await this.syncManager.server.db.scan("");
    } catch (error) {
      console.error("Error getting changes for anti-entropy:", error);
      return [];
    }
  }

  /**
   * Handle incoming vector clock synchronization
   * @param {Object} data - Sync message data
   * @param {Object} socket - Socket.IO socket
   * @returns {Promise<void>}
   */
  async handleVectorClockSync(data, socket) {
    const syncManager = this.syncManager;

    // Skip if shutting down
    if (syncManager.isShuttingDown) return;

    try {
      // Validate the data
      if (!data || !data.vectorClock || !data.nodeId) {
        console.warn("Invalid vector clock sync data:", data);
        return;
      }

      // Track this node ID
      syncManager.knownNodeIds.add(data.nodeId);

      // Convert to VectorClock instance
      const remoteClock = syncManager.constructor.VectorClock.fromJSON(
        data.vectorClock
      );

      // Merge the remote clock with our clock
      syncManager.vectorClock = syncManager.vectorClock.merge(remoteClock);

      // Ensure all known node IDs are in our vector clock
      for (const nodeId of syncManager.knownNodeIds) {
        if (!(nodeId in syncManager.vectorClock.clock)) {
          syncManager.vectorClock.clock[nodeId] = 0;
        }
      }

      if (syncManager.debugMode) {
        console.log(
          `Received vector clock sync from ${
            data.nodeId
          }, merged to: ${syncManager.vectorClock.toString()}`
        );
      }

      // Send our merged clock back to help convergence
      const responseMessage = {
        type: "vector-clock-sync-response",
        vectorClock: syncManager.vectorClock.toJSON(),
        nodeId: syncManager.server.serverID,
        timestamp: Date.now(),
        inResponseTo: data.syncId,
      };

      if (socket && socket.connected) {
        socket.emit("vector-clock-sync-response", responseMessage);
      }
    } catch (error) {
      console.error("Error handling vector clock sync:", error);
    }
  }

  /**
   * Handle response to vector clock synchronization
   * @param {Object} data - Response data
   * @returns {Promise<void>}
   */
  async handleVectorClockSyncResponse(data) {
    const syncManager = this.syncManager;

    // Skip if shutting down
    if (syncManager.isShuttingDown) return;

    try {
      // Validate the data
      if (!data || !data.vectorClock || !data.nodeId) {
        console.warn("Invalid vector clock sync response data:", data);
        return;
      }

      // Track this node ID
      syncManager.knownNodeIds.add(data.nodeId);

      // Convert to VectorClock instance
      const remoteClock = syncManager.constructor.VectorClock.fromJSON(
        data.vectorClock
      );

      // Merge the remote clock with our clock
      syncManager.vectorClock = syncManager.vectorClock.merge(remoteClock);

      // Ensure all known node IDs are in our vector clock
      for (const nodeId of syncManager.knownNodeIds) {
        if (!(nodeId in syncManager.vectorClock.clock)) {
          syncManager.vectorClock.clock[nodeId] = 0;
        }
      }

      if (syncManager.debugMode) {
        console.log(
          `Received vector clock sync response from ${
            data.nodeId
          }, merged to: ${syncManager.vectorClock.toString()}`
        );
      }
    } catch (error) {
      console.error("Error handling vector clock sync response:", error);
    }
  }
}

module.exports = AntiEntropy;
