/**
 * SyncManager - Handles data synchronization between peers
 * Coordinates vector clocks and conflict resolution
 */

const VectorClock = require("./vector-clock");
const ConflictResolver = require("./conflict-resolver");
const AntiEntropy = require("./anti-entropy");

class SyncManager {
  /**
   * Create a new SyncManager
   * @param {Object} server - P2PServer instance
   * @param {Object} syncOptions - Synchronization options
   * @param {Object} conflictOptions - Conflict resolution options
   */
  constructor(server, syncOptions = {}, conflictOptions = {}) {
    this.server = server;
    this.subscriptions = new Map();
    this.processedMessages = new Set();
    this.messageTimestamps = new Map();
    this.versionHistory = new Map();
    this.knownNodeIds = new Set([server.serverID]);
    this.isShuttingDown = false;

    // Initialize configuration
    this.maxMessageAge = syncOptions.maxMessageAge || 300000; // 5 minutes
    this.maxVersions = syncOptions.maxVersions || 10;
    this.debugMode = syncOptions.debugMode || false;

    // Initialize components
    this.vectorClock = new VectorClock();
    this.vectorClock.increment(this.server.serverID);

    this.conflictResolver = new ConflictResolver(conflictOptions);

    // Make VectorClock class available to components that need it
    this.constructor.VectorClock = VectorClock;

    // Initialize AntiEntropy after setting up vectorClock
    this.antiEntropy = new AntiEntropy(this);

    // Initialize cleanup and sync intervals
    this._setupIntervals(syncOptions);
  }

  /**
   * Set up periodic maintenance intervals
   * @private
   */
  _setupIntervals(options) {
    // Message cleanup interval
    this.cleanupInterval = setInterval(() => {
      if (!this.isShuttingDown) {
        this._cleanupProcessedMessages();
      }
    }, 60000); // Every minute

    // Anti-entropy sync interval
    if (options.antiEntropyInterval) {
      this.antiEntropyInterval = setInterval(() => {
        if (!this.isShuttingDown) {
          this.runAntiEntropy().catch((err) =>
            console.error("Anti-entropy error:", err)
          );
        }
      }, options.antiEntropyInterval);
    }

    // Vector clock synchronization interval
    this.clockSyncInterval = setInterval(() => {
      if (!this.isShuttingDown) {
        this.synchronizeVectorClocks().catch((err) =>
          console.error("Vector clock sync error:", err)
        );
      }
    }, 2000); // Every 2 seconds
  }

  /**
   * Get current vector clock
   * @returns {Object} - Vector clock as JSON
   */
  getVectorClock() {
    return this.vectorClock.toJSON();
  }

  /**
   * Prepare for shutdown
   */
  prepareForShutdown() {
    this.isShuttingDown = true;

    // Clear all intervals
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.antiEntropyInterval) clearInterval(this.antiEntropyInterval);
    if (this.clockSyncInterval) clearInterval(this.clockSyncInterval);

    console.log("SyncManager prepared for shutdown");
  }

  /**
   * Handle PUT operations with conflict resolution
   * @param {Object} data - Data object with path, value, timestamp, etc.
   * @returns {Promise<Object>} - Processed data
   */
  async handlePut(data) {
    // Skip if shutting down
    if (this.isShuttingDown) {
      console.log(`Skipping data processing during shutdown for ${data.path}`);
      return null;
    }

    // Skip already processed messages
    if (data.msgId && this.processedMessages.has(data.msgId)) {
      if (this.debugMode) {
        console.log(`Already processed message ${data.msgId}, skipping`);
      }
      return null;
    }

    // Skip if we've already seen this message (our server ID is in the visited servers list)
    if (
      Array.isArray(data.visitedServers) &&
      data.visitedServers.includes(this.server.serverID)
    ) {
      if (this.debugMode) {
        console.log(
          `Already visited server ${this.server.serverID}, skipping to prevent loops`
        );
      }
      return null;
    }

    // Mark message as processed
    if (data.msgId) {
      this.processedMessages.add(data.msgId);
      this.messageTimestamps.set(data.msgId, Date.now());
    }

    try {
      // Get existing data
      const existingData = await this.server.db.get(data.path);

      // Add origin to known nodes
      if (data.origin) this.knownNodeIds.add(data.origin);

      // Parse incoming vector clock
      const incomingVectorClock = data.vectorClock
        ? VectorClock.fromJSON(data.vectorClock)
        : new VectorClock({ [data.origin || this.server.serverID]: 1 });

      // Create new data object
      const newData = {
        value: data.value,
        timestamp: data.timestamp || Date.now(),
        origin: data.origin || this.server.serverID,
        vectorClock: incomingVectorClock.toJSON(),
      };

      // Process and resolve conflicts
      const finalData = await this._resolveConflicts(
        data.path,
        existingData,
        newData,
        incomingVectorClock
      );

      // Store data in database
      await this.server.db.put(data.path, finalData);

      // Notify subscribers
      this._notifySubscribers(data.path, finalData.value);

      // Propagate changes to peers if not shutting down and not part of anti-entropy
      if (!this.isShuttingDown && !data.antiEntropy) {
        this._propagateChanges(data, finalData);
      }

      return finalData;
    } catch (error) {
      console.error(`Error handling PUT for ${data.path}:`, error);
      return null;
    }
  }

  /**
   * Resolve conflicts between existing and new data
   * @private
   */
  async _resolveConflicts(path, existingData, newData, incomingVectorClock) {
    let finalData = newData;

    // Handle conflicts if we have existing data
    if (existingData) {
      // Add to version history
      this._addToVersionHistory(path, existingData);

      // Ensure existing data has a valid vector clock
      const existingVectorClock = existingData.vectorClock
        ? VectorClock.fromJSON(existingData.vectorClock)
        : new VectorClock();

      // Create full objects for conflict resolution
      const localData = {
        ...existingData,
        vectorClock: existingVectorClock,
      };

      const remoteData = {
        ...newData,
        vectorClock: incomingVectorClock,
      };

      // Compare vector clocks
      const comparison = existingVectorClock.compare(incomingVectorClock);

      // Get conflict resolution strategy for this path
      const strategy = this.conflictResolver.getStrategyForPath(path);

      // Handle different comparison results
      if (comparison === -1) {
        // Existing data is causally before new data
        console.log(
          `Update for ${path} is newer (vector clock), checking for merge opportunity`
        );

        if (
          strategy === "merge-fields" &&
          typeof existingData.value === "object" &&
          typeof newData.value === "object"
        ) {
          // Use field merging to preserve fields
          finalData = this.conflictResolver.mergeFields(
            path,
            existingData,
            newData
          );
        } else {
          // For other strategies, accept newer data
          finalData = newData;
        }
      } else if (comparison === 0 || comparison === 2) {
        // Concurrent updates or identical vector clocks
        if (comparison === 0) {
          console.log(`Detected concurrent update conflict for ${path}`);
        } else {
          console.log(
            `Identical vector clocks for ${path}, using conflict resolution`
          );
        }

        // Apply conflict resolution strategy
        finalData = this.conflictResolver.resolve(path, localData, remoteData);
      }
    }

    // Always merge with our vector clock
    this.vectorClock = this.vectorClock.merge(incomingVectorClock);

    // Increment our clock if we're the origin
    if (newData.origin === this.server.serverID) {
      this.vectorClock.increment(this.server.serverID);
    }

    // Ensure all known node IDs are in our vector clock
    for (const nodeId of this.knownNodeIds) {
      if (!(nodeId in this.vectorClock.clock)) {
        this.vectorClock.clock[nodeId] = 0;
      }
    }

    // Update final data with merged vector clock
    finalData.vectorClock = this.vectorClock.toJSON();

    return finalData;
  }

  /**
   * Propagate changes to peers
   * @private
   */
  _propagateChanges(originalData, finalData) {
    // Skip if shutting down
    if (this.isShuttingDown) {
      console.log(
        `Skipping message propagation during shutdown for ${originalData.path}`
      );
      return;
    }

    // Prepare data to broadcast with our merged vector clock
    const broadcastData = {
      ...originalData,
      vectorClock: this.vectorClock.toJSON(),
    };

    // Initialize visited servers array if it doesn't exist
    const visitedServers = Array.isArray(broadcastData.visitedServers)
      ? broadcastData.visitedServers
      : [];

    // Add current server ID to the list of visited servers
    if (!visitedServers.includes(this.server.serverID)) {
      visitedServers.push(this.server.serverID);
    }

    // Forward messages to help them propagate
    if (originalData.origin === this.server.serverID) {
      console.log(
        `Broadcasting update for ${originalData.path} to peers as originator`
      );

      this.server.socketManager.broadcast("put", {
        ...broadcastData,
        visitedServers,
      });
    } else {
      console.log(
        `Forwarding update for ${originalData.path} from ${originalData.origin || "unknown"} to peers`
      );
      console.log(
        `Message has visited ${visitedServers.length} servers: [${visitedServers.join(", ")}]`
      );

      this.server.socketManager.broadcast("put", {
        ...broadcastData,
        visitedServers,
      });
    }
  }

  /**
   * Add data to version history
   * @private
   */
  _addToVersionHistory(path, data) {
    if (this.isShuttingDown) return;

    if (!this.versionHistory.has(path)) {
      this.versionHistory.set(path, []);
    }

    const history = this.versionHistory.get(path);

    // Add to history
    history.push({
      timestamp: data.timestamp,
      vectorClock: data.vectorClock,
      value: data.value,
      origin: data.origin,
    });

    // Sort by timestamp (newest first)
    history.sort((a, b) => b.timestamp - a.timestamp);

    // Limit history size
    if (history.length > this.maxVersions) {
      this.versionHistory.set(path, history.slice(0, this.maxVersions));
    }
  }

  /**
   * Get version history for a path
   * @param {string} path - Data path
   * @returns {Array} - Version history
   */
  getVersionHistory(path) {
    return this.versionHistory.get(path) || [];
  }

  /**
   * Subscribe to changes at a path
   * @param {string} path - Path to subscribe to
   * @param {Function} callback - Callback function
   * @returns {Function} - Unsubscribe function
   */
  subscribe(path, callback) {
    if (this.isShuttingDown) {
      throw new Error("Cannot subscribe during shutdown");
    }

    if (!this.subscriptions.has(path)) {
      this.subscriptions.set(path, new Set());
    }

    this.subscriptions.get(path).add(callback);
    console.log(`New subscription added for ${path}`);

    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(path);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscriptions.delete(path);
        }
        console.log(`Subscription removed for ${path}`);
      }
    };
  }

  /**
   * Notify subscribers of changes
   * @private
   */
  _notifySubscribers(path, value) {
    if (this.isShuttingDown) {
      console.log(
        `Skipping subscriber notifications during shutdown for ${path}`
      );
      return;
    }

    const pathParts = path.split("/");

    // Check all subscription paths
    this.subscriptions.forEach((subscribers, subscribedPath) => {
      const subscribedParts = subscribedPath.split("/");
      let isMatch = false;

      // Case 1: Exact match
      if (path === subscribedPath) {
        isMatch = true;
      }
      // Case 2: Path is a child of subscription
      else if (pathParts.length > subscribedParts.length) {
        isMatch = true;
        for (let i = 0; i < subscribedParts.length; i++) {
          if (subscribedParts[i] !== pathParts[i]) {
            isMatch = false;
            break;
          }
        }
      }
      // Case 3: Subscription is a child of path
      else if (subscribedParts.length > pathParts.length) {
        isMatch = true;
        for (let i = 0; i < pathParts.length; i++) {
          if (pathParts[i] !== subscribedParts[i]) {
            isMatch = false;
            break;
          }
        }
      }

      // Notify matching subscribers
      if (isMatch) {
        console.log(
          `Found ${subscribers.size} subscribers for ${subscribedPath} matching ${path}`
        );

        subscribers.forEach((callback) => {
          try {
            callback(value, path);
          } catch (error) {
            console.error(
              `Error in subscriber callback for ${subscribedPath}:`,
              error
            );
          }
        });
      }
    });
  }

  /**
   * Run anti-entropy synchronization
   * @returns {Promise<void>}
   */
  async runAntiEntropy() {
    if (this.isShuttingDown) {
      console.log("Skipping anti-entropy synchronization during shutdown");
      return;
    }

    return this.antiEntropy.run();
  }

  /**
   * Synchronize vector clocks with peers
   * @returns {Promise<void>}
   */
  async synchronizeVectorClocks() {
    if (this.isShuttingDown) return;

    return this.antiEntropy.synchronizeVectorClocks();
  }

  /**
   * Handle vector clock synchronization (delegated to antiEntropy)
   * @param {Object} data - Sync message data
   * @param {Object} socket - Socket.IO socket
   * @returns {Promise<void>}
   */
  async handleVectorClockSync(data, socket) {
    return this.antiEntropy.handleVectorClockSync(data, socket);
  }

  /**
   * Handle vector clock synchronization response (delegated to antiEntropy)
   * @param {Object} data - Response data
   * @returns {Promise<void>}
   */
  async handleVectorClockSyncResponse(data) {
    return this.antiEntropy.handleVectorClockSyncResponse(data);
  }

  /**
   * Clean up old processed messages
   * @private
   */
  _cleanupProcessedMessages() {
    if (this.isShuttingDown) return;

    const now = Date.now();
    let removedCount = 0;

    // Remove messages older than maxMessageAge
    for (const [msgId, timestamp] of this.messageTimestamps.entries()) {
      if (now - timestamp > this.maxMessageAge) {
        this.processedMessages.delete(msgId);
        this.messageTimestamps.delete(msgId);
        removedCount++;
      }
    }

    if (removedCount > 0 && this.debugMode) {
      console.log(
        `Cleaned up ${removedCount} old messages, ${this.processedMessages.size} remaining`
      );
    }
  }

  /**
   * Set conflict resolution strategy for a path
   * @param {string} path - Data path or prefix
   * @param {string} strategy - Strategy name
   */
  setConflictStrategy(path, strategy) {
    this.conflictResolver.setStrategy(path, strategy);
  }

  /**
   * Register a custom conflict resolver
   * @param {string} path - Data path or prefix
   * @param {Function} resolverFn - Resolver function
   */
  registerConflictResolver(path, resolverFn) {
    this.conflictResolver.registerCustomResolver(path, resolverFn);
  }
}

module.exports = SyncManager;
