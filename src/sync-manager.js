/**
 * Sync Manager for P2P Server
 * Handles data synchronization with conflict resolution
 */

const VectorClock = require("./vector-clock");
const ConflictResolver = require("./conflict-resolver");

class SyncManager {
  constructor(server, options = {}) {
    this.server = server;
    this.subscriptions = new Map();
    this.processedMessages = new Set();
    this.maxMessageAge = options.maxMessageAge || 300000; // 5 minutes
    this.messageTimestamps = new Map(); // Track message timestamps
    this.vectorClock = new VectorClock();
    this.conflictResolver = new ConflictResolver(
      options.conflictResolution || {}
    );
    this.versionHistory = new Map(); // Store version history for keys
    this.maxVersions = options.maxVersions || 10; // Maximum versions to keep

    // Initialize vector clock for this node
    this.vectorClock.increment(this.server.serverID);

    // Clear processed messages periodically
    setInterval(() => this.cleanupProcessedMessages(), 60000); // Clean up every minute

    // Periodically run anti-entropy sync
    if (options.antiEntropyInterval) {
      setInterval(() => this.runAntiEntropy(), options.antiEntropyInterval);
    }
  }

  /**
   * Handle PUT operations with conflict resolution
   */
  async handlePut(data) {
    // Skip if we've already processed this message
    if (this.processedMessages.has(data.msgId)) {
      console.log(`Already processed message ${data.msgId}, skipping`);
      return false;
    }

    console.log(`Processing update for ${data.path}:`, data.value);

    // Add to processed messages to prevent loops
    this.processedMessages.add(data.msgId);
    this.messageTimestamps.set(data.msgId, Date.now());

    try {
      // Get existing data if any
      const existingData = await this.server.db.get(data.path);

      // Parse vector clock from incoming data or create new one
      const incomingVectorClock = data.vectorClock
        ? VectorClock.fromJSON(data.vectorClock)
        : new VectorClock({ [data.origin]: 1 });

      // Create the new data object
      const newData = {
        value: data.value,
        timestamp: data.timestamp,
        origin: data.origin,
        vectorClock: incomingVectorClock.toJSON(),
      };

      let finalData = newData;

      // Check for conflicts if we have existing data
      if (existingData) {
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

        // Compare vector clocks to detect conflicts
        const comparison = existingVectorClock.compare(incomingVectorClock);

        // Handle based on comparison result
        if (comparison === -1) {
          // Existing data is causally before new data, accept new data
          console.log(`Update for ${data.path} is newer, accepting`);
          finalData = newData;
        } else if (comparison === 1) {
          // Existing data is causally after new data, keep existing
          console.log(`Update for ${data.path} is older, ignoring`);
          finalData = existingData;
        } else if (comparison === 0) {
          // Concurrent updates, need to resolve conflict
          console.log(`Detected concurrent update conflict for ${data.path}`);

          // Use conflict resolver
          const resolvedData = this.conflictResolver.resolve(
            data.path,
            localData,
            remoteData
          );

          // Update vector clock of resolved data
          resolvedData.vectorClock = localData.vectorClock.merge(
            remoteData.vectorClock
          );

          // Use the resolved data
          finalData = resolvedData;
        } else {
          // Identical vector clocks
          if (data.timestamp > existingData.timestamp) {
            console.log(
              `Update for ${data.path} has newer timestamp with identical vector clock`
            );
            finalData = newData;
          } else {
            console.log(
              `Update for ${data.path} has older timestamp with identical vector clock`
            );
            finalData = existingData;
          }
        }

        // Add to version history
        this.addToVersionHistory(data.path, existingData);
      } else {
        console.log(`No existing data for ${data.path}, accepting new data`);
      }

      // If we're the origin of this data or it's a forwarded message
      if (data.origin === this.server.serverID) {
        // Update our vector clock
        this.vectorClock.increment(this.server.serverID);
        finalData.vectorClock = this.vectorClock.toJSON();
      } else {
        // Merge remote vector clock with ours
        this.vectorClock = this.vectorClock.merge(incomingVectorClock);
      }

      // Store final data in database
      await this.server.db.put(data.path, finalData);

      // Notify subscribers
      this.notifySubscribers(data.path, finalData.value);

      // Forward messages to help them propagate through the network
      // If we're the origin, broadcast to all our peers
      if (data.origin === this.server.serverID) {
        console.log(
          `Broadcasting update for ${data.path} to peers as originator`
        );
        // Include the final vector clock
        const broadcastData = {
          ...data,
          vectorClock: finalData.vectorClock,
        };
        this.server.socketManager.broadcast("put", broadcastData);
      }
      // If this is not a forwarded message and not from us, forward it to our peers
      else if (!data.forwarded) {
        console.log(
          `Forwarding update for ${data.path} from ${data.origin} to peers`
        );
        // Mark as forwarded to prevent infinite loops and include final vector clock
        const forwardData = {
          ...data,
          forwarded: true,
          vectorClock: finalData.vectorClock,
        };
        this.server.socketManager.broadcast("put", forwardData);
      }

      return finalData;
    } catch (error) {
      console.error(`Error handling PUT for ${data.path}:`, error);
      return false;
    }
  }

  /**
   * Add data to version history
   */
  addToVersionHistory(path, data) {
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
   */
  getVersionHistory(path) {
    return this.versionHistory.get(path) || [];
  }

  /**
   * Subscribe to changes at a path
   */
  subscribe(path, callback) {
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
   * Notify subscribers when data changes
   */
  notifySubscribers(path, value) {
    console.log(`Checking subscriptions for ${path}`);

    // Process both exact and prefix matches
    const pathParts = path.split("/");

    // Check all subscription paths
    this.subscriptions.forEach((subscribers, subscribedPath) => {
      const subscribedParts = subscribedPath.split("/");
      let isMatch = false;

      // Case 1: Exact match
      if (path === subscribedPath) {
        isMatch = true;
      }
      // Case 2: Path is a child of subscription (e.g. 'users/123' matches 'users')
      else if (pathParts.length > subscribedParts.length) {
        isMatch = true;
        for (let i = 0; i < subscribedParts.length; i++) {
          if (subscribedParts[i] !== pathParts[i]) {
            isMatch = false;
            break;
          }
        }
      }
      // Case 3: Subscription is a child of path (e.g. 'users' matches 'users/123')
      else if (subscribedParts.length > pathParts.length) {
        isMatch = true;
        for (let i = 0; i < pathParts.length; i++) {
          if (pathParts[i] !== subscribedParts[i]) {
            isMatch = false;
            break;
          }
        }
      }

      // If there's a match, notify all subscribers
      if (isMatch) {
        console.log(
          `Found ${subscribers.size} subscribers for ${subscribedPath} matching ${path}`
        );

        subscribers.forEach((callback) => {
          try {
            console.log(
              `Calling subscriber callback for ${subscribedPath} with path ${path}`
            );
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
   * Run anti-entropy synchronization with peers
   * This helps ensure consistency across nodes even for missed updates
   */
  async runAntiEntropy() {
    console.log("Starting anti-entropy synchronization");

    try {
      // Get list of peers
      const peers = Object.keys(this.server.socketManager.sockets);
      if (peers.length === 0) {
        console.log("No peers connected, skipping anti-entropy");
        return;
      }

      // Select a random peer
      const randomPeer = peers[Math.floor(Math.random() * peers.length)];
      const socket = this.server.socketManager.sockets[randomPeer];

      if (!socket || !socket.connected) {
        console.log(
          `Selected peer ${randomPeer} is not connected, skipping anti-entropy`
        );
        return;
      }

      console.log(`Running anti-entropy with peer ${randomPeer}`);

      // Request peer's vector clock
      // (This would need a new message type in the socket protocol)
      // socket.emit("getVectorClock", { requestId: requestId });

      // For now, we'll implement a simpler version:
      // Scan our database for recent changes and send them to the peer
      const recentChanges = await this.getRecentChanges();

      for (const change of recentChanges) {
        const syncData = {
          path: change.path,
          value: change.value,
          timestamp: change.timestamp,
          origin: change.origin,
          vectorClock: change.vectorClock,
          msgId: `anti-entropy-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 9)}`,
          forwarded: true,
        };

        // Send directly to the selected peer
        socket.emit("put", syncData);
      }

      console.log(
        `Sent ${recentChanges.length} changes to peer ${randomPeer} for anti-entropy`
      );
    } catch (error) {
      console.error("Error during anti-entropy synchronization:", error);
    }
  }

  /**
   * Get recent changes for anti-entropy sync
   */
  async getRecentChanges() {
    try {
      // This implementation depends on what your database scan supports
      // For now, we'll scan the entire database
      const allData = await this.server.db.scan("");

      // Filter and limit to changes in last hour
      const oneHourAgo = Date.now() - 3600000;
      return allData.filter((item) => item.timestamp > oneHourAgo);
    } catch (error) {
      console.error("Error getting recent changes:", error);
      return [];
    }
  }

  /**
   * Clean up old processed messages to prevent memory leaks
   */
  cleanupProcessedMessages() {
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

    if (removedCount > 0) {
      console.log(
        `Cleaned up ${removedCount} old messages, ${this.processedMessages.size} remaining`
      );
    }
  }
}

module.exports = SyncManager;
