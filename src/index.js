/**
 * Main entry point for the P2P Server module
 */

const P2PServer = require("./core/server");
const VectorClock = require("./sync/vector-clock");
const ConflictResolver = require("./sync/conflict-resolver");
const { getDefaultConfig } = require("./core/config");

/**
 * Create a new P2P Server instance
 * @param {Object} options - Server configuration
 * @returns {P2PServer} - New server instance
 */
function createServer(options = {}) {
  return new P2PServer(options);
}

// Export the main class and utilities
module.exports = {
  P2PServer,
  VectorClock,
  ConflictResolver,
  createServer,
  getDefaultConfig,
};
