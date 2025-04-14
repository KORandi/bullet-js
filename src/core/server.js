/**
 * P2PServer - Main Server Class
 * Coordinates all components of the P2P synchronization system
 */

const express = require("express");
const { createServer } = require("http");
const { randomBytes } = require("crypto");

// Import core managers
const DatabaseManager = require("./database-manager");

// Import network components
const SocketManager = require("../network/socket-manager");

// Import sync components
const SyncManager = require("../sync/sync-manager");
const { getDefaultConfig, validateConfig } = require("./config");
const merge = require("deepmerge");
const deepmerge = require("deepmerge");

class P2PServer {
  /**
   * Create a new P2P Server instance
   * @param {Object} options - Server configuration options
   */
  constructor(options = {}) {
    const config = deepmerge(getDefaultConfig(), options);
    validateConfig(config);

    // Server identification and configuration
    this.serverID = randomBytes(8).toString("hex");
    this.port = config.port;
    this.dbPath = config.dbPath;
    this.peers = config.peers || [];
    this.isShuttingDown = false;

    // Initialize Express and HTTP server
    this.app = express();
    this.app.use(express.json());
    this.server = createServer(this.app);

    // Initialize core components
    this.db = new DatabaseManager(this.dbPath);
    this.socketManager = new SocketManager(this);
    this.syncManager = new SyncManager(
      this,
      config.sync || {},
      config.conflict || {}
    );
  }

  /**
   * Start the server and connect to peers
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve) => {
      // Initialize socket connections
      this.socketManager.init(this.server);

      // Connect to peers
      this.socketManager.connectToPeers(this.peers);

      // Start HTTP server
      this.server.listen(this.port, () => {
        console.log(
          `P2P Server started on port ${this.port} with ID: ${this.serverID}`
        );
        console.log(`Database path: ${this.dbPath}`);
        console.log(`Known peers: ${this.peers.join(", ") || "none"}`);
        resolve();
      });
    });
  }

  /**
   * Store data at the specified path and synchronize with peers
   * @param {string} path - Data path
   * @param {any} value - Data value
   * @returns {Promise<Object>} - Result with timestamp and vector clock
   */
  async put(path, value) {
    if (this.isShuttingDown) {
      throw new Error("Server is shutting down, cannot accept new data");
    }

    // Create data object with metadata
    const data = {
      path,
      value,
      timestamp: Date.now(),
      msgId: randomBytes(16).toString("hex"),
      origin: this.serverID,
      vectorClock: this.syncManager.getVectorClock(),
    };

    // Process through sync manager
    const result = await this.syncManager.handlePut(data);

    return {
      path,
      value: result.value,
      timestamp: result.timestamp,
      vectorClock: result.vectorClock,
    };
  }

  /**
   * Retrieve data from the specified path
   * @param {string} path - Data path
   * @returns {Promise<any>} - Data value
   */
  async get(path) {
    try {
      const data = await this.db.get(path);

      if (data && typeof data === "object" && "value" in data) {
        return data.value;
      }

      return null;
    } catch (error) {
      if (
        error.notFound ||
        error.code === "LEVEL_NOT_FOUND" ||
        error.type === "NotFoundError"
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete data at the specified path
   * @param {string} path - Data path
   * @returns {Promise<boolean>} - Success indicator
   */
  async del(path) {
    try {
      if (this.isShuttingDown) {
        throw new Error("Server is shutting down, cannot delete data");
      }

      // Check if path exists
      const exists = await this.get(path);

      if (exists === null) {
        return false;
      }

      // Soft delete by setting value to null
      await this.put(path, null);
      return true;
    } catch (error) {
      console.error(`Error deleting ${path}:`, error);
      return false;
    }
  }

  /**
   * Subscribe to changes at a path or prefix
   * @param {string} path - Path prefix to subscribe to
   * @param {Function} callback - Function called on changes
   * @returns {Promise<Function>} - Unsubscribe function
   */
  async subscribe(path, callback) {
    if (this.isShuttingDown) {
      throw new Error(
        "Server is shutting down, cannot accept new subscriptions"
      );
    }

    return this.syncManager.subscribe(path, callback);
  }

  /**
   * Scan database entries by prefix
   * @param {string} prefix - Path prefix
   * @param {Object} options - Scan options
   * @returns {Promise<Array>} - Matching entries
   */
  async scan(prefix, options = {}) {
    return this.db.scan(prefix, options);
  }

  /**
   * Get version history for a path
   * @param {string} path - Data path
   * @returns {Array} - Version history
   */
  getVersionHistory(path) {
    return this.syncManager.getVersionHistory(path);
  }

  /**
   * Set conflict resolution strategy for a path
   * @param {string} path - Data path or prefix
   * @param {string} strategy - Strategy name
   */
  setConflictStrategy(path, strategy) {
    this.syncManager.setConflictStrategy(path, strategy);
  }

  /**
   * Register a custom conflict resolver
   * @param {string} path - Data path or prefix
   * @param {Function} resolverFn - Resolver function
   */
  registerConflictResolver(path, resolverFn) {
    this.syncManager.registerConflictResolver(path, resolverFn);
  }

  /**
   * Run anti-entropy synchronization
   * @param {string} path - Data path or prefix
   * @returns {Promise<void>}
   */
  async runAntiEntropy(path = "") {
    if (this.isShuttingDown) {
      console.log("Skipping anti-entropy during shutdown");
      return;
    }

    return this.syncManager.runAntiEntropy(path);
  }

  /**
   * Close server and database connections
   * @returns {Promise<void>}
   */
  async close() {
    this.isShuttingDown = true;
    console.log(`Server ${this.serverID} beginning shutdown process`);

    return new Promise(async (resolve, reject) => {
      try {
        // Stop sync manager first
        if (this.syncManager) {
          this.syncManager.prepareForShutdown();
          console.log(`Server ${this.serverID} stopped sync manager`);
        }

        // Close socket connections
        if (this.socketManager) {
          this.socketManager.closeAllConnections();
          console.log(`Server ${this.serverID} closed socket connections`);
        }

        // Small delay for sockets to disconnect
        await new Promise((r) => setTimeout(r, 500));

        // Close HTTP server
        this.server.close(async () => {
          try {
            // Finally close the database
            await this.db.close();
            console.log(`Server ${this.serverID} database closed`);
            resolve();
          } catch (dbErr) {
            reject(dbErr);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = P2PServer;
