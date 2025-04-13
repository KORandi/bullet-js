/**
 * Improved Sync Manager for P2P Server
 * Handles data synchronization with multi-hop forwarding
 */

class SyncManager {
  constructor(server) {
    this.server = server;
    this.subscriptions = new Map();
    this.processedMessages = new Set();
    this.maxMessageAge = 300000; // 5 minutes
    this.messageTimestamps = new Map(); // Track message timestamps

    // Clear processed messages periodically
    setInterval(() => this.cleanupProcessedMessages(), 60000); // Clean up every minute
  }

  /**
   * Handle PUT operations with multi-hop forwarding
   * This allows updates to propagate through the network even if
   * the originator doesn't have a direct connection to all nodes.
   */
  async handlePut(data) {
    // Skip if we've already processed this message
    if (this.processedMessages.has(data.msgId)) {
      console.log(`Already processed message ${data.msgId}, skipping`);
      return false;
    }

    console.log(`Updating data at ${data.path}:`, data.value);

    // Add to processed messages to prevent loops
    this.processedMessages.add(data.msgId);
    this.messageTimestamps.set(data.msgId, Date.now());

    try {
      // Store in database
      await this.server.db.put(data.path, {
        value: data.value,
        timestamp: data.timestamp,
        origin: data.origin,
      });

      // Notify subscribers
      this.notifySubscribers(data.path, data.value);

      // Forward messages to help them propagate through the network
      // If we're the origin, broadcast to all our peers
      if (data.origin === this.server.serverID) {
        console.log(
          `Broadcasting update for ${data.path} to peers as originator`
        );
        this.server.socketManager.broadcast("put", data);
      }
      // If this is not a forwarded message and not from us, forward it to our peers
      else if (!data.forwarded) {
        console.log(
          `Forwarding update for ${data.path} from ${data.origin} to peers`
        );
        // Mark as forwarded to prevent infinite loops
        const forwardData = { ...data, forwarded: true };
        this.server.socketManager.broadcast("put", forwardData);
      }

      return true;
    } catch (error) {
      console.error(`Error handling PUT for ${data.path}:`, error);
      return false;
    }
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
