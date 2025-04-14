/**
 * Anti-Entropy - Handles periodic synchronization to ensure data consistency
 * Pull-based implementation where peers request data rather than pushing it
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

      // Create a batch ID for this anti-entropy run
      const batchId = `anti-entropy-${server.serverID}-${Date.now()}`;

      // First, synchronize vector clocks
      await this._syncVectorClocksWithPeers(selectedPeers, batchId);

      // Request data from peers instead of pushing
      await this._requestDataFromPeers(selectedPeers, batchId);

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
   * Request data from peers (pull-based approach)
   * @private
   * @param {Array<string>} peers - Peer IDs
   * @param {string} batchId - Unique batch ID
   * @returns {Promise<void>}
   */
  async _requestDataFromPeers(peers, batchId) {
    const syncManager = this.syncManager;
    const server = syncManager.server;

    for (const peer of peers) {
      const socket = server.socketManager.sockets[peer];

      if (!socket || !socket.connected) {
        console.log(`Selected peer ${peer} is not connected, skipping`);
        continue;
      }

      // Create a unique request ID
      const requestId = `${batchId}-request-${Math.random()
        .toString(36)
        .substring(2, 9)}`;

      // Prepare the data request with our current vector clock
      const requestData = {
        requestId: requestId,
        nodeId: server.serverID,
        vectorClock: syncManager.vectorClock.toJSON(),
        timestamp: Date.now(),
      };

      // Send the data request to the peer
      console.log(`Requesting data from peer ${peer}`);
      socket.emit("anti-entropy-request", requestData);
    }

    // Give peers time to respond
    await new Promise((resolve) => setTimeout(resolve, 500));
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
   * Get all data changes for responding to anti-entropy requests
   * @private
   * @returns {Promise<Array>} - List of changes
   */
  async _getAllChanges() {
    try {
      // Get all data from the database
      return await this.syncManager.server.db.scan("");
    } catch (error) {
      console.error("Error getting changes for anti-entropy:", error);
      return [];
    }
  }

  /**
   * Handle incoming anti-entropy data request
   * @param {Object} data - Request data
   * @param {Object} socket - Socket.IO socket
   * @returns {Promise<void>}
   */
  async handleAntiEntropyRequest(data, socket) {
    const syncManager = this.syncManager;
    const server = syncManager.server;

    // Skip if shutting down
    if (syncManager.isShuttingDown) return;

    try {
      // Validate the request
      if (!data || !data.requestId || !data.nodeId || !data.vectorClock) {
        console.warn("Invalid anti-entropy request data:", data);
        return;
      }

      console.log(`Received anti-entropy request from ${data.nodeId}`);

      // Add the requesting node to known nodes
      syncManager.knownNodeIds.add(data.nodeId);

      // Get the requester's vector clock
      const requesterClock = syncManager.constructor.VectorClock.fromJSON(
        data.vectorClock
      );

      // Merge the requester's clock with our clock
      syncManager.vectorClock = syncManager.vectorClock.merge(requesterClock);

      // Get all our data to send back
      const allChanges = await this._getAllChanges();
      console.log(
        `Sending ${allChanges.length} changes in response to anti-entropy request`
      );

      // Organize data into batches to avoid overwhelming the network
      const BATCH_SIZE = 50;
      const batchCount = Math.ceil(allChanges.length / BATCH_SIZE);

      for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
        // Skip if shutting down mid-process
        if (syncManager.isShuttingDown) break;

        const startIndex = batchIndex * BATCH_SIZE;
        const endIndex = Math.min(startIndex + BATCH_SIZE, allChanges.length);
        const batchChanges = allChanges.slice(startIndex, endIndex);

        // Prepare response batch
        const responseData = {
          responseId: data.requestId,
          nodeId: server.serverID,
          vectorClock: syncManager.vectorClock.toJSON(),
          timestamp: Date.now(),
          batchIndex: batchIndex,
          totalBatches: batchCount,
          changes: batchChanges,
        };

        // Send the response batch
        socket.emit("anti-entropy-response", responseData);

        // Add a small delay between batches
        if (batchIndex < batchCount - 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      console.log(
        `Sent anti-entropy response to ${data.nodeId} in ${batchCount} batches`
      );
    } catch (error) {
      console.error("Error handling anti-entropy request:", error);
    }
  }

  /**
   * Handle incoming anti-entropy response
   * @param {Object} data - Response data
   * @returns {Promise<void>}
   */
  async handleAntiEntropyResponse(data) {
    const syncManager = this.syncManager;

    // Skip if shutting down
    if (syncManager.isShuttingDown) return;

    try {
      // Validate the response
      if (!data || !data.responseId || !data.nodeId || !data.changes) {
        console.warn("Invalid anti-entropy response data:", data);
        return;
      }

      console.log(
        `Received anti-entropy response batch ${data.batchIndex + 1}/${data.totalBatches} from ${data.nodeId} with ${data.changes.length} changes`
      );

      // Add the responding node to known nodes
      syncManager.knownNodeIds.add(data.nodeId);

      // Merge vector clocks
      if (data.vectorClock) {
        const remoteClock = syncManager.constructor.VectorClock.fromJSON(
          data.vectorClock
        );
        syncManager.vectorClock = syncManager.vectorClock.merge(remoteClock);
      }

      // Process each change
      for (const change of data.changes) {
        // Skip if shutting down mid-process
        if (syncManager.isShuttingDown) break;

        // Prepare the data for processing
        const syncData = {
          path: change.path,
          value: change.value,
          timestamp: change.timestamp,
          origin: change.origin || data.nodeId,
          vectorClock: data.vectorClock,
          msgId: `anti-entropy-${data.responseId}-${change.path}`,
          forwarded: true,
          antiEntropy: true,
        };

        // Process the update through the sync manager
        await syncManager.handlePut(syncData);
      }

      if (data.batchIndex === data.totalBatches - 1) {
        console.log(
          `Completed processing anti-entropy response from ${data.nodeId}`
        );
      }
    } catch (error) {
      console.error("Error handling anti-entropy response:", error);
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
