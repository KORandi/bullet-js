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

/**
 * Create a network of interconnected servers for testing
 * @param {number} count - Number of servers to create
 * @param {number} basePort - Starting port number
 * @param {string} dbPathPrefix - Prefix for database paths
 * @param {Object} options - Additional options
 * @returns {Array<P2PServer>} - Array of server instances
 */
function createTestNetwork(
  count,
  basePort = 3000,
  dbPathPrefix = "./db-server",
  options = {}
) {
  const servers = [];

  for (let i = 0; i < count; i++) {
    const port = basePort + i;
    const dbPath = `${dbPathPrefix}${i + 1}`;

    // Create peers list - each server connects to previous servers
    const peers = [];
    for (let j = 0; j < i; j++) {
      peers.push(`http://localhost:${basePort + j}`);
    }

    // Create server with provided options
    const server = new P2PServer({
      port,
      dbPath,
      peers,
      ...options,
    });

    servers.push(server);
  }

  return servers;
}

// Export the main class and utilities
module.exports = {
  P2PServer,
  VectorClock,
  ConflictResolver,
  createServer,
  createTestNetwork,
  getDefaultConfig,
};
