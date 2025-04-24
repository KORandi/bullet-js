/**
 * BulletNetworkSync
 * Handles data synchronization between peers in a Bullet network
 */
const crypto = require("crypto");

class BulletNetworkSync {
  /**
   * Create a new BulletNetworkSync instance
   * @param {Object} bullet - The Bullet instance
   * @param {Object} network - The BulletNetwork instance
   * @param {Object} options - Configuration options
   */
  constructor(bullet, network, options = {}) {
    this.bullet = bullet;
    this.network = network;
    this.options = {
      chunkSize: 50, // Number of entries per chunk
      syncInterval: 5 * 60 * 1000, // 5 minutes
      initialSyncTimeout: 30 * 1000, // 30 seconds
      retryInterval: 5 * 1000, // 5 seconds
      maxSyncAttempts: 3,
      progressUpdateInterval: 10, // Every 10 chunks
      ...options,
    };

    // Track sync state for each peer
    this.syncState = new Map();

    // Initialize sync tracking
    this._initSync();
  }

  /**
   * Initialize sync system, register message handlers
   * @private
   */
  _initSync() {
    // Register message handlers with the network
    this.network.on("message", (peerId, message) => {
      if (!message || !message.type) return;

      switch (message.type) {
        case "sync-request":
          this._handleSyncRequest(peerId, message);
          break;
        case "sync-response":
          this._handleSyncResponse(peerId, message);
          break;
        case "sync-chunk":
          this._handleSyncChunk(peerId, message);
          break;
        case "sync-complete":
          this._handleSyncComplete(peerId, message);
          break;
        case "sync-progress":
          this._handleSyncProgress(peerId, message);
          break;
        case "sync-resume":
          this._handleSyncResume(peerId, message);
          break;
      }
    });

    // When a new peer connects, initiate sync after a short delay
    this.network.on("peer:connect", (peerId) => {
      setTimeout(() => {
        this.requestSync(peerId);
      }, 1000); // Short delay to ensure connection is stable
    });

    // Set up periodic syncs
    setInterval(() => {
      this._periodicSync();
    }, this.options.syncInterval);
  }

  /**
   * Request a sync from a specific peer
   * @param {string} peerId - ID of the peer to sync with
   * @param {Object} options - Sync options
   * @public
   */
  requestSync(peerId, options = {}) {
    const peerState = this._getPeerSyncState(peerId);

    // Don't request a sync if one is already in progress with this peer
    if (peerState.status === "in-progress") {
      console.log(`Sync already in progress with peer ${peerId}`);
      return;
    }

    const syncRequest = {
      type: "sync-request",
      id: this._generateId(),
      since: peerState.lastSyncTime || 0,
      partial: options.partial || false,
      paths: options.paths || [],
    };

    console.log(`Requesting sync from peer ${peerId}`);

    // Update peer sync state
    peerState.status = "requested";
    peerState.requestId = syncRequest.id;
    peerState.startTime = Date.now();
    peerState.attempts += 1;
    peerState.timeoutId = setTimeout(() => {
      this._handleSyncTimeout(peerId, syncRequest.id);
    }, this.options.initialSyncTimeout);

    // Send the request
    this.network.sendToPeer(peerId, syncRequest);

    // Emit event for monitoring
    this.network.emit("sync:requested", { peerId, request: syncRequest });
  }

  /**
   * Handle an incoming sync request from a peer
   * @param {string} peerId - ID of the requesting peer
   * @param {Object} message - The sync request message
   * @private
   */
  _handleSyncRequest(peerId, message) {
    console.log(`Received sync request from peer ${peerId}`);

    const { since, partial, paths } = message;

    // Generate sync data based on request parameters
    this._generateAndSendSyncData(peerId, message.id, since, partial, paths);
  }

  /**
   * Generate and send sync data to a peer
   * @param {string} peerId - ID of the peer to send to
   * @param {string} requestId - Original request ID
   * @param {number} since - Timestamp to sync from
   * @param {boolean} partial - Whether this is a partial sync
   * @param {Array} paths - Specific paths to sync (if partial)
   * @private
   */
  _generateAndSendSyncData(peerId, requestId, since, partial, paths) {
    // Prepare the data
    const entries = this._collectSyncData(since, partial, paths);
    const totalEntries = entries.length;
    const chunks = this._chunkSyncData(entries);

    console.log(
      `Sending ${totalEntries} entries in ${chunks.length} chunks to peer ${peerId}`
    );

    // Send initial sync response with metadata
    this.network.sendToPeer(peerId, {
      type: "sync-response",
      id: this._generateId(),
      requestId: requestId,
      totalChunks: chunks.length,
      totalEntries: totalEntries,
      timestamp: Date.now(),
    });

    // Send each chunk
    chunks.forEach((chunk, index) => {
      this.network.sendToPeer(peerId, {
        type: "sync-chunk",
        id: this._generateId(),
        requestId: requestId,
        chunkIndex: index,
        totalChunks: chunks.length,
        entries: chunk,
        isLastChunk: index === chunks.length - 1,
      });

      // Send progress updates periodically for large syncs
      if (
        chunks.length > 10 &&
        index % this.options.progressUpdateInterval === 0
      ) {
        this.network.sendToPeer(peerId, {
          type: "sync-progress",
          id: this._generateId(),
          requestId: requestId,
          chunkIndex: index,
          totalChunks: chunks.length,
          progress: Math.floor((index / chunks.length) * 100),
        });
      }
    });

    // Send final completion message
    this.network.sendToPeer(peerId, {
      type: "sync-complete",
      id: this._generateId(),
      requestId: requestId,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle sync response from a peer
   * @param {string} peerId - ID of the responding peer
   * @param {Object} message - The sync response message
   * @private
   */
  _handleSyncResponse(peerId, message) {
    const peerState = this._getPeerSyncState(peerId);
    const { requestId, totalChunks, totalEntries, timestamp } = message;

    // Verify this is the response to our request
    if (peerState.requestId !== requestId) {
      console.warn(
        `Received sync response with unknown request ID from ${peerId}`
      );
      return;
    }

    // Clear timeout for the initial request
    if (peerState.timeoutId) {
      clearTimeout(peerState.timeoutId);
      peerState.timeoutId = null;
    }

    // Update peer sync state
    peerState.status = "in-progress";
    peerState.totalChunks = totalChunks;
    peerState.totalEntries = totalEntries;
    peerState.receivedChunks = new Set();
    peerState.syncStartTime = timestamp;
    peerState.lastActivity = Date.now();

    console.log(
      `Starting sync with peer ${peerId}: ${totalEntries} entries in ${totalChunks} chunks`
    );

    // Set a timeout for the entire sync process
    peerState.syncTimeoutId = setTimeout(() => {
      this._handleSyncTimeout(peerId, requestId);
    }, Math.max(30000, totalChunks * 1000)); // At least 30 seconds or 1 second per chunk

    // Emit event for monitoring
    this.network.emit("sync:started", {
      peerId,
      totalChunks,
      totalEntries,
      timestamp,
    });
  }

  /**
   * Handle a sync chunk from a peer
   * @param {string} peerId - ID of the peer
   * @param {Object} message - The sync chunk message
   * @private
   */
  _handleSyncChunk(peerId, message) {
    const peerState = this._getPeerSyncState(peerId);
    const { requestId, chunkIndex, totalChunks, entries, isLastChunk } =
      message;

    // Verify this is for the current sync
    if (peerState.requestId !== requestId) {
      console.warn(
        `Received sync chunk with unknown request ID from ${peerId}`
      );
      return;
    }

    // Update peer sync state
    peerState.lastActivity = Date.now();
    peerState.receivedChunks.add(chunkIndex);

    console.log(
      `Received chunk ${chunkIndex + 1}/${totalChunks} from peer ${peerId}`
    );

    // Process each entry in the chunk
    this._processSyncEntries(entries, peerId);

    // Check if all chunks have been received
    if (peerState.receivedChunks.size === totalChunks || isLastChunk) {
      this._finishSync(peerId, requestId);
    }

    // Emit event for monitoring
    this.network.emit("sync:chunk", {
      peerId,
      chunkIndex,
      totalChunks,
      progress: Math.floor((peerState.receivedChunks.size / totalChunks) * 100),
    });
  }

  /**
   * Handle a sync progress update from a peer
   * @param {string} peerId - ID of the peer
   * @param {Object} message - The progress message
   * @private
   */
  _handleSyncProgress(peerId, message) {
    const { requestId, chunkIndex, totalChunks, progress } = message;

    console.log(
      `Sync progress from peer ${peerId}: ${progress}% (chunk ${
        chunkIndex + 1
      }/${totalChunks})`
    );

    // Emit event for monitoring
    this.network.emit("sync:progress", {
      peerId,
      chunkIndex,
      totalChunks,
      progress,
    });
  }

  /**
   * Handle a sync completion message from a peer
   * @param {string} peerId - ID of the peer
   * @param {Object} message - The completion message
   * @private
   */
  _handleSyncComplete(peerId, message) {
    const peerState = this._getPeerSyncState(peerId);
    const { requestId } = message;

    // Verify this is for the current sync
    if (peerState.requestId !== requestId) {
      console.warn(
        `Received sync complete with unknown request ID from ${peerId}`
      );
      return;
    }

    // Check if we have all chunks
    if (peerState.receivedChunks.size < peerState.totalChunks) {
      const missingChunks = this._getMissingChunks(peerState);
      console.warn(
        `Sync marked complete but missing ${missingChunks.length} chunks from peer ${peerId}. Requesting missing chunks.`
      );

      // Request missing chunks
      this._requestMissingChunks(peerId, requestId, missingChunks);
      return;
    }

    this._finishSync(peerId, requestId);
  }

  /**
   * Handle a sync resume request from a peer
   * @param {string} peerId - ID of the peer
   * @param {Object} message - The resume message
   * @private
   */
  _handleSyncResume(peerId, message) {
    const { requestId, missingChunks } = message;

    console.log(
      `Received request to resume sync from peer ${peerId}: ${missingChunks.length} missing chunks`
    );

    // Find the original sync data and send only the missing chunks
    // This would require storing the sync data temporarily, which could be memory intensive
    // For simplicity, we'll just regenerate the data but only send the requested chunks
    // A more sophisticated implementation would cache the chunks

    // For this implementation, we'll just acknowledge and restart
    this.network.sendToPeer(peerId, {
      type: "sync-response",
      id: this._generateId(),
      requestId: requestId,
      resuming: true,
      missingChunks: missingChunks.length,
    });

    // Here we'd ideally only send the missing chunks, but for simplicity
    // we'll just trigger a new full sync
    setTimeout(() => {
      this.requestSync(peerId);
    }, 1000);
  }

  /**
   * Finish a sync process with a peer
   * @param {string} peerId - ID of the peer
   * @param {string} requestId - The request ID of the sync
   * @private
   */
  _finishSync(peerId, requestId) {
    const peerState = this._getPeerSyncState(peerId);

    // Clear any pending timeouts
    if (peerState.syncTimeoutId) {
      clearTimeout(peerState.syncTimeoutId);
      peerState.syncTimeoutId = null;
    }

    // Update peer sync state
    peerState.status = "complete";
    peerState.lastSyncTime = Date.now();
    peerState.lastSyncDuration = peerState.lastSyncTime - peerState.startTime;
    peerState.attempts = 0;

    console.log(
      `Completed sync with peer ${peerId} in ${peerState.lastSyncDuration}ms`
    );

    // Emit event for monitoring
    this.network.emit("sync:complete", {
      peerId,
      duration: peerState.lastSyncDuration,
      entriesProcessed: peerState.totalEntries,
    });
  }

  /**
   * Handle a sync timeout
   * @param {string} peerId - ID of the peer
   * @param {string} requestId - The request ID of the sync
   * @private
   */
  _handleSyncTimeout(peerId, requestId) {
    const peerState = this._getPeerSyncState(peerId);

    // Verify this is for the current sync
    if (peerState.requestId !== requestId) {
      return;
    }

    console.warn(`Sync with peer ${peerId} timed out`);

    // Check if we should retry
    if (peerState.attempts < this.options.maxSyncAttempts) {
      console.log(
        `Retrying sync with peer ${peerId} (attempt ${peerState.attempts + 1}/${
          this.options.maxSyncAttempts
        })`
      );

      // If we have some chunks, attempt to resume
      if (
        peerState.status === "in-progress" &&
        peerState.receivedChunks &&
        peerState.receivedChunks.size > 0
      ) {
        this._resumeSync(peerId, requestId);
      } else {
        // Otherwise, request a fresh sync after a delay
        setTimeout(() => {
          this.requestSync(peerId);
        }, this.options.retryInterval);
      }
    } else {
      // Mark sync as failed
      peerState.status = "failed";
      console.error(
        `Sync with peer ${peerId} failed after ${peerState.attempts} attempts`
      );

      // Emit event for monitoring
      this.network.emit("sync:failed", {
        peerId,
        attempts: peerState.attempts,
        reason: "timeout",
      });
    }
  }

  /**
   * Request a sync resume with a peer for missing chunks
   * @param {string} peerId - ID of the peer
   * @param {string} requestId - The original request ID
   * @param {Array} missingChunks - Array of missing chunk indices
   * @private
   */
  _requestMissingChunks(peerId, requestId, missingChunks) {
    this.network.sendToPeer(peerId, {
      type: "sync-resume",
      id: this._generateId(),
      requestId: requestId,
      missingChunks: missingChunks,
    });

    // Update peer state
    const peerState = this._getPeerSyncState(peerId);
    peerState.lastActivity = Date.now();

    // Reset timeout for the resumed sync
    if (peerState.syncTimeoutId) {
      clearTimeout(peerState.syncTimeoutId);
    }

    peerState.syncTimeoutId = setTimeout(() => {
      this._handleSyncTimeout(peerId, requestId);
    }, Math.max(10000, missingChunks.length * 1000)); // 10 seconds or 1 second per chunk

    // Emit event for monitoring
    this.network.emit("sync:resume-requested", {
      peerId,
      missingChunks: missingChunks.length,
    });
  }

  /**
   * Resume a sync with a peer
   * @param {string} peerId - ID of the peer
   * @param {string} requestId - The original request ID
   * @private
   */
  _resumeSync(peerId, requestId) {
    const peerState = this._getPeerSyncState(peerId);
    const missingChunks = this._getMissingChunks(peerState);

    console.log(
      `Attempting to resume sync with peer ${peerId}: ${missingChunks.length} missing chunks`
    );

    this._requestMissingChunks(peerId, requestId, missingChunks);
  }

  /**
   * Get missing chunks from a peer's sync state
   * @param {Object} peerState - The peer's sync state
   * @return {Array} - Array of missing chunk indices
   * @private
   */
  _getMissingChunks(peerState) {
    const missingChunks = [];

    if (!peerState.totalChunks || !peerState.receivedChunks) {
      return missingChunks;
    }

    for (let i = 0; i < peerState.totalChunks; i++) {
      if (!peerState.receivedChunks.has(i)) {
        missingChunks.push(i);
      }
    }

    return missingChunks;
  }

  /**
   * Process a batch of sync entries
   * @param {Array} entries - Array of sync entries
   * @param {string} peerId - ID of the source peer
   * @private
   */
  _processSyncEntries(entries, peerId) {
    for (const entry of entries) {
      const { path, data, vectorClock, deleted } = entry;

      if (deleted) {
        // Handle deleted entries
        this.bullet.setData(path, null, false);
      } else {
        // Add network flags to the data
        const networkData =
          typeof data === "object" && data !== null
            ? { ...data, __fromNetwork: true, __vectorClock: vectorClock }
            : data;

        // Let the HAM algorithm resolve any conflicts
        this.bullet.setData(path, networkData, false);
      }
    }
  }

  /**
   * Collect data for synchronization
   * @param {number} since - Timestamp to sync from
   * @param {boolean} partial - Whether this is a partial sync
   * @param {Array} paths - Specific paths to sync (if partial)
   * @return {Array} - Array of sync entries
   * @private
   */
  _collectSyncData(since, partial, paths) {
    if (partial && Array.isArray(paths) && paths.length > 0) {
      return this._collectPartialSyncData(paths, since);
    }
    return this._collectFullSyncData(since);
  }

  /**
   * Collect full sync data
   * @param {number} since - Timestamp to sync from
   * @return {Array} - Array of sync entries
   * @private
   */
  _collectFullSyncData(since) {
    const entries = [];

    // Helper function to traverse the store recursively
    const traverse = (obj, path = "") => {
      if (typeof obj !== "object" || obj === null) {
        const metaPath = path.substring(1); // Remove leading slash
        const meta = this.bullet.meta[metaPath] || {};

        // Skip entries that haven't changed since the 'since' timestamp
        if (since > 0 && meta.lastModified && meta.lastModified < since) {
          return;
        }

        entries.push({
          path: metaPath,
          data: obj,
          vectorClock: meta.vectorClock || {},
          lastModified: meta.lastModified || 0,
          deleted: false,
        });

        return;
      }

      for (const [key, value] of Object.entries(obj)) {
        const newPath = path + "/" + key;

        if (
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value)
        ) {
          // For nested objects, recursively traverse
          traverse(value, newPath);
        } else {
          // For leaf nodes or arrays, add them directly
          const metaPath = newPath.substring(1); // Remove leading slash
          const meta = this.bullet.meta[metaPath] || {};

          // Skip entries that haven't changed since the 'since' timestamp
          if (since > 0 && meta.lastModified && meta.lastModified < since) {
            continue;
          }

          entries.push({
            path: metaPath,
            data: value,
            vectorClock: meta.vectorClock || {},
            lastModified: meta.lastModified || 0,
            deleted: false,
          });
        }
      }
    };

    traverse(this.bullet.store);

    // Also include deleted entries that have metadata
    for (const [path, meta] of Object.entries(this.bullet.meta)) {
      if (meta.deleted && (!since || meta.lastModified > since)) {
        entries.push({
          path,
          data: null,
          vectorClock: meta.vectorClock || {},
          lastModified: meta.lastModified || 0,
          deleted: true,
        });
      }
    }

    return entries;
  }

  /**
   * Collect partial sync data for specific paths
   * @param {Array} paths - Array of paths to sync
   * @param {number} since - Timestamp to sync from
   * @return {Array} - Array of sync entries
   * @private
   */
  _collectPartialSyncData(paths, since) {
    const entries = [];

    for (const path of paths) {
      const data = this.bullet._getData(path);
      const meta = this.bullet.meta[path] || {};

      // Skip entries that haven't changed since the 'since' timestamp
      if (since > 0 && meta.lastModified && meta.lastModified < since) {
        continue;
      }

      if (data === null && meta.deleted) {
        entries.push({
          path,
          data: null,
          vectorClock: meta.vectorClock || {},
          lastModified: meta.lastModified || 0,
          deleted: true,
        });
      } else {
        entries.push({
          path,
          data,
          vectorClock: meta.vectorClock || {},
          lastModified: meta.lastModified || 0,
          deleted: false,
        });
      }
    }

    return entries;
  }

  /**
   * Chunk sync data into manageable pieces
   * @param {Array} entries - Array of sync entries
   * @return {Array} - Array of entry chunks
   * @private
   */
  _chunkSyncData(entries) {
    const chunks = [];
    const chunkSize = this.options.chunkSize;

    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      chunks.push(chunk);
    }

    return chunks;
  }

  /**
   * Perform a periodic sync with all connected peers
   * @private
   */
  _periodicSync() {
    const now = Date.now();
    const connectedPeers = Array.from(this.network.peers.keys());

    for (const peerId of connectedPeers) {
      const peerState = this._getPeerSyncState(peerId);

      // Don't sync if:
      // 1. A sync is already in progress
      // 2. The last sync was less than syncInterval ago
      // 3. The peer is in a failed state and hasn't been reconnected
      if (
        peerState.status === "in-progress" ||
        (peerState.lastSyncTime &&
          now - peerState.lastSyncTime < this.options.syncInterval) ||
        (peerState.status === "failed" &&
          peerState.attempts >= this.options.maxSyncAttempts)
      ) {
        continue;
      }

      console.log(`Initiating periodic sync with peer ${peerId}`);
      this.requestSync(peerId);
    }
  }

  /**
   * Get or create sync state for a peer
   * @param {string} peerId - ID of the peer
   * @return {Object} - Peer sync state object
   * @private
   */
  _getPeerSyncState(peerId) {
    if (!this.syncState.has(peerId)) {
      this.syncState.set(peerId, {
        status: "initial", // initial, requested, in-progress, complete, failed
        lastSyncTime: 0,
        lastSyncDuration: 0,
        attempts: 0,
        requestId: null,
        totalChunks: 0,
        totalEntries: 0,
        receivedChunks: new Set(),
        timeoutId: null,
        syncTimeoutId: null,
        startTime: 0,
        lastActivity: 0,
      });
    }

    return this.syncState.get(peerId);
  }

  /**
   * Generate a unique ID
   * @return {string} - Unique ID
   * @private
   */
  _generateId() {
    const random = crypto.randomBytes(8).toString("hex");
    return `sync-${Date.now()}-${random}`;
  }

  /**
   * Get sync statistics for monitoring/debugging
   * @return {Object} - Sync statistics
   * @public
   */
  getSyncStats() {
    const stats = {
      peers: {},
      totalSyncs: 0,
      activeSyncs: 0,
      failedSyncs: 0,
      lastSyncTime: 0,
    };

    for (const [peerId, state] of this.syncState.entries()) {
      stats.peers[peerId] = {
        status: state.status,
        lastSyncTime: state.lastSyncTime,
        lastSyncDuration: state.lastSyncDuration,
        attempts: state.attempts,
        progress:
          state.status === "in-progress" && state.totalChunks > 0
            ? Math.floor((state.receivedChunks.size / state.totalChunks) * 100)
            : 0,
      };

      if (state.status === "in-progress") {
        stats.activeSyncs++;
      }

      if (state.status === "failed") {
        stats.failedSyncs++;
      }

      if (state.lastSyncTime > stats.lastSyncTime) {
        stats.lastSyncTime = state.lastSyncTime;
      }

      if (state.lastSyncTime > 0) {
        stats.totalSyncs++;
      }
    }

    return stats;
  }

  /**
   * Reset sync state for a peer
   * @param {string} peerId - ID of the peer
   * @public
   */
  resetPeerSync(peerId) {
    const peerState = this._getPeerSyncState(peerId);

    // Clear any pending timeouts
    if (peerState.timeoutId) {
      clearTimeout(peerState.timeoutId);
    }

    if (peerState.syncTimeoutId) {
      clearTimeout(peerState.syncTimeoutId);
    }

    // Reset the state
    peerState.status = "initial";
    peerState.attempts = 0;
    peerState.requestId = null;

    console.log(`Reset sync state for peer ${peerId}`);
  }

  /**
   * Clean up resources when shutting down
   * @public
   */
  close() {
    // Clear all timeouts
    for (const [peerId, state] of this.syncState.entries()) {
      if (state.timeoutId) {
        clearTimeout(state.timeoutId);
      }

      if (state.syncTimeoutId) {
        clearTimeout(state.syncTimeoutId);
      }
    }

    this.syncState.clear();
    console.log("BulletNetworkSync closed");
  }
}

module.exports = BulletNetworkSync;
