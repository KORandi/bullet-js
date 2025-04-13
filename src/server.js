/* eslint-disable @typescript-eslint/no-require-imports */
/**
 *  P2P Server - Main Server Class
 * With improved synchronization and conflict resolution
 */

const express = require("express");
const { createServer } = require("http");
const { randomBytes } = require("crypto");
const DatabaseManager = require("./database");
const SocketManager = require("./socket-manager");
const SyncManager = require("./sync-manager");

class P2PServer {
  constructor(options = {}) {
    // Server configuration
    this.port = options.port || 3000;
    this.dbPath = options.dbPath || "./db";
    this.peers = options.peers || [];
    this.serverID = randomBytes(8).toString("hex");
    this.syncOptions = options.sync || {};
    this.conflictOptions = options.conflict || {};
    this.isShuttingDown = false;

    // Initialize Express and HTTP server
    this.app = express();
    this.server = createServer(this.app);

    // Configure Express middleware
    this.app.use(express.json());

    // Set up API routes
    this.setupRoutes();

    // Initialize managers
    this.db = new DatabaseManager(this.dbPath);
    this.socketManager = new SocketManager(this);

    // Initialize the sync manager with conflict resolution
    this.syncManager = new SyncManager(this, {
      maxMessageAge: this.syncOptions.maxMessageAge || 300000,
      maxVersions: this.syncOptions.maxVersions || 10,
      antiEntropyInterval: this.syncOptions.antiEntropyInterval || 60000, // 1 minute
      conflictResolution: {
        defaultStrategy:
          this.conflictOptions.defaultStrategy || "last-write-wins",
        pathStrategies: this.conflictOptions.pathStrategies || {},
        customResolvers: this.conflictOptions.customResolvers || {},
      },
    });
  }

  /**
   * Set up Express API routes
   */
  setupRoutes() {
    // GET endpoint to retrieve data
    this.app.get("/api/:path(*)", async (req, res) => {
      try {
        const path = req.params.path;
        const data = await this.get(path);

        if (data === null) {
          return res.status(404).json({ error: "Not found" });
        }

        res.json({ path, data });
      } catch (error) {
        console.error(`API error getting ${req.params.path}:`, error);
        res.status(500).json({ error: "Server error" });
      }
    });

    // PUT endpoint to store data
    this.app.put("/api/:path(*)", async (req, res) => {
      try {
        const path = req.params.path;
        const value = req.body;

        const result = await this.put(path, value);
        res.json(result);
      } catch (error) {
        console.error(`API error putting ${req.params.path}:`, error);
        res.status(500).json({ error: "Server error" });
      }
    });

    // DELETE endpoint
    this.app.delete("/api/:path(*)", async (req, res) => {
      try {
        const path = req.params.path;
        const result = await this.del(path);

        if (!result) {
          return res.status(404).json({ error: "Not found" });
        }

        res.json({ success: true, path });
      } catch (error) {
        console.error(`API error deleting ${req.params.path}:`, error);
        res.status(500).json({ error: "Server error" });
      }
    });

    // SCAN endpoint to query data by prefix
    this.app.get("/api/scan/:prefix(*)", async (req, res) => {
      try {
        const prefix = req.params.prefix;
        const limit = req.query.limit ? parseInt(req.query.limit) : undefined;

        const results = await this.scan(prefix, { limit });
        res.json(results);
      } catch (error) {
        console.error(`API error scanning ${req.params.prefix}:`, error);
        res.status(500).json({ error: "Server error" });
      }
    });

    // Get version history for a path
    this.app.get("/api/history/:path(*)", async (req, res) => {
      try {
        const path = req.params.path;
        const history = this.syncManager.getVersionHistory(path);

        res.json({ path, history });
      } catch (error) {
        console.error(
          `API error getting history for ${req.params.path}:`,
          error
        );
        res.status(500).json({ error: "Server error" });
      }
    });

    // Get server status
    this.app.get("/api/status", (req, res) => {
      try {
        const connections = this.socketManager.getConnectionStatus();

        res.json({
          serverID: this.serverID,
          port: this.port,
          peers: connections.peerCount,
          uptime: process.uptime(),
          vectorClock: this.syncManager.vectorClock.toJSON(),
        });
      } catch (error) {
        console.error("API error getting status:", error);
        res.status(500).json({ error: "Server error" });
      }
    });
  }

  /**
   * Start the server
   */
  start() {
    // Setup socket events and connect to peers
    this.socketManager.init(this.server);
    this.socketManager.connectToPeers(this.peers);

    // Start HTTP server
    this.server.listen(this.port, () => {
      console.log(
        ` P2P Server started on port ${this.port} with ID: ${this.serverID}`
      );
      console.log(`Database path: ${this.dbPath}`);
      console.log(`Known peers: ${this.peers.join(", ") || "none"}`);
      console.log(
        `Conflict resolution strategy: ${
          this.conflictOptions.defaultStrategy || "last-write-wins"
        }`
      );
    });
  }

  /**
   * Public API: Put data with vector clock
   */
  async put(path, value) {
    if (this.isShuttingDown) {
      throw new Error("Server is shutting down, cannot accept new data");
    }

    const timestamp = Date.now();
    const msgId = randomBytes(16).toString("hex");

    // Increment our vector clock for this operation
    this.syncManager.vectorClock.increment(this.serverID);

    const data = {
      path,
      value,
      timestamp,
      msgId,
      origin: this.serverID,
      vectorClock: this.syncManager.vectorClock.toJSON(),
    };

    const result = await this.syncManager.handlePut(data);
    return {
      path,
      value: result.value,
      timestamp: result.timestamp,
      vectorClock: result.vectorClock,
    };
  }

  /**
   * Public API: Get data
   */
  async get(path) {
    try {
      const data = await this.db.get(path);

      // Check if data exists and has a value property
      if (data && typeof data === "object" && "value" in data) {
        return data.value;
      }

      // If data exists but doesn't have the expected structure
      if (data) {
        console.warn(
          `Retrieved data at ${path} doesn't have expected structure:`,
          data
        );
      } else {
        console.log(`No data found at ${path}`);
      }

      return null;
    } catch (error) {
      if (
        error.notFound ||
        error.code === "LEVEL_NOT_FOUND" ||
        error.type === "NotFoundError"
      ) {
        console.log(`Data not found for path: ${path}`);
        return null;
      }
      console.error(`Error getting data at ${path}:`, error);
      throw error;
    }
  }

  /**
   * Public API: Delete data (implemented as setting value to null)
   */
  async del(path) {
    try {
      if (this.isShuttingDown) {
        throw new Error("Server is shutting down, cannot delete data");
      }

      // Check if the path exists first
      const exists = await this.get(path);

      if (exists === null) {
        return false;
      }

      // Soft delete by setting value to null with timestamp
      await this.put(path, null);
      return true;
    } catch (error) {
      console.error(`Error deleting ${path}:`, error);
      return false;
    }
  }

  /**
   * Public API: Subscribe to changes
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
   * Utility function to scan database entries by prefix
   */
  async scan(prefix, options = {}) {
    return this.db.scan(prefix, options);
  }

  /**
   * Get version history for a path
   */
  getVersionHistory(path) {
    return this.syncManager.getVersionHistory(path);
  }

  /**
   * Configure conflict resolution strategy for a path
   */
  setConflictStrategy(path, strategy) {
    this.syncManager.conflictResolver.setStrategy(path, strategy);
  }

  /**
   * Register a custom conflict resolver for a path
   */
  registerConflictResolver(path, resolverFn) {
    this.syncManager.conflictResolver.registerCustomResolver(path, resolverFn);
  }

  /**
   * Force anti-entropy synchronization
   */
  async runAntiEntropy() {
    if (this.isShuttingDown) {
      console.log("Skipping anti-entropy during shutdown");
      return;
    }
    return this.syncManager.runAntiEntropy();
  }

  /**
   * Close the server and database
   */
  async close() {
    // Mark as shutting down to prevent new operations
    this.isShuttingDown = true;
    console.log(`Server ${this.serverID} beginning shutdown process`);

    return new Promise((resolve, reject) => {
      // First stop sync manager's intervals
      if (this.syncManager) {
        this.syncManager.prepareForShutdown();
        console.log(`Server ${this.serverID} stopped sync manager intervals`);
      }

      // Close socket connections
      if (this.socketManager) {
        try {
          this.socketManager.closeAllConnections();
          console.log(`Server ${this.serverID} closed socket connections`);
        } catch (socketErr) {
          console.error(
            `Server ${this.serverID} error closing sockets:`,
            socketErr
          );
        }
      }

      // Give a small pause for sockets to fully disconnect
      setTimeout(() => {
        // Close HTTP server
        this.server.close(async (err) => {
          if (err) {
            console.error(
              `Server ${this.serverID} error closing HTTP server:`,
              err
            );
          } else {
            console.log(`Server ${this.serverID} HTTP server closed`);
          }

          try {
            // Finally close the database
            await this.db.close();
            console.log(`Server ${this.serverID} database closed`);
            resolve();
          } catch (dbErr) {
            console.error(
              `Server ${this.serverID} error closing database:`,
              dbErr
            );
            reject(dbErr);
          }
        });
      }, 500); // Short delay to allow sockets to disconnect
    });
  }
}

module.exports = P2PServer;
