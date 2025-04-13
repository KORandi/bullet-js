/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * P2P Server - Main Server Class
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

    // Initialize Express and HTTP server
    this.app = express();
    this.server = createServer(this.app);

    // Initialize managers
    this.db = new DatabaseManager(this.dbPath);
    this.syncManager = new SyncManager(this);
    this.socketManager = new SocketManager(this);
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
        `P2P Server started on port ${this.port} with ID: ${this.serverID}`
      );
      console.log(`Database path: ${this.dbPath}`);
      console.log(`Known peers: ${this.peers.join(", ") || "none"}`);
    });
  }

  /**
   * Public API: Put data
   */
  async put(path, value) {
    const timestamp = Date.now();
    const msgId = randomBytes(16).toString("hex");

    const data = {
      path,
      value,
      timestamp,
      msgId,
      origin: this.serverID,
    };

    await this.syncManager.handlePut(data);
    return { path, value, timestamp };
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
   * Public API: Delete data
   */
  async del(path) {
    try {
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
    return this.syncManager.subscribe(path, callback);
  }

  /**
   * Utility function to scan database entries by prefix
   */
  async scan(prefix, options = {}) {
    return this.db.scan(prefix, options);
  }

  /**
   * Close the server and database
   */
  async close() {
    return new Promise((resolve, reject) => {
      this.server.close(async (err) => {
        if (err) {
          console.error("Error closing HTTP server:", err);
        }

        try {
          await this.db.close();
          console.log("Database closed");
          resolve();
        } catch (dbErr) {
          console.error("Error closing database:", dbErr);
          reject(dbErr);
        }
      });
    });
  }
}

module.exports = P2PServer;
