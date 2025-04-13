/**
 * Test helpers for working with P2P server networks
 */

const fs = require("fs");
const path = require("path");
const rimraf = require("rimraf");
const { createServer, P2PServer } = require("../../src");

/**
 * Wait for a specified amount of time
 * @param {number} ms - Time to wait in milliseconds
 * @returns {Promise<void>}
 */
async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clean up server resources and databases
 * @param {Array<Object>} servers - Array of server instances
 * @returns {Promise<void>}
 */
async function cleanupServers(servers) {
  // Close all servers
  const closePromises = [];
  for (const server of servers) {
    if (server) {
      closePromises.push(
        server.close().catch((err) => {
          console.error("Error closing server:", err);
        })
      );
    }
  }

  await Promise.all(closePromises);

  // Wait a moment for connections to fully close
  await wait(100);
}

/**
 * Clean up test databases
 * @param {string} dbPathPattern - Path pattern to match (e.g. './test/temp/')
 * @returns {Promise<void>}
 */
async function cleanupDatabases(dbPathPattern) {
  if (fs.existsSync(path.dirname(dbPathPattern))) {
    rimraf.sync(path.dirname(dbPathPattern));
    console.log(`Cleaned up databases matching ${dbPathPattern}`);
  }
}

/**
 * Create a test network with a specific topology
 * @param {number} nodeCount - Number of nodes
 * @param {Array<Array<number>>} connections - Connection matrix (indices of nodes to connect to)
 * @param {string} dbPathPrefix - Prefix for database paths
 * @param {Object} options - Additional options
 * @returns {Array<Object>} - Array of server instances
 */
function createNetworkWithTopology(
  nodeCount,
  connections,
  dbPathPrefix,
  options = {}
) {
  const servers = [];

  for (let i = 0; i < nodeCount; i++) {
    const port = 4001 + i;
    const peerIndices = connections[i] || [];

    // Create peer URLs from indices
    const peers = peerIndices.map((idx) => `http://localhost:${4001 + idx}`);

    // Create server
    servers.push(
      createServer({
        port,
        dbPath: `${dbPathPrefix}${i + 1}`,
        peers,
        ...options,
      })
    );
  }

  return servers;
}

/**
 * Create a star topology network (one central node, all others connect to it)
 * @param {number} nodeCount - Number of nodes
 * @param {number} basePort - Starting port number
 * @param {string} dbPathPrefix - Prefix for database paths
 * @param {Object} options - Additional options
 * @returns {Array<Object>} - Array of server instances
 */
function createStarNetwork(nodeCount, basePort, dbPathPrefix, options = {}) {
  const connections = [];

  // First node is the hub, connects to no one
  connections.push([]);

  // All other nodes connect to the hub (node 0)
  for (let i = 1; i < nodeCount; i++) {
    connections.push([0]);
  }

  return createNetworkWithTopology(
    nodeCount,
    connections,
    dbPathPrefix,
    options
  );
}

/**
 * Create a ring topology network (each node connects to the previous one)
 * @param {number} nodeCount - Number of nodes
 * @param {number} basePort - Starting port number
 * @param {string} dbPathPrefix - Prefix for database paths
 * @param {Object} options - Additional options
 * @returns {Array<Object>} - Array of server instances
 */
function createRingNetwork(nodeCount, basePort, dbPathPrefix, options = {}) {
  const connections = [];

  // First node connects to the last
  connections.push([nodeCount - 1]);

  // Each node connects to the previous one
  for (let i = 1; i < nodeCount; i++) {
    connections.push([i - 1]);
  }

  return createNetworkWithTopology(
    nodeCount,
    connections,
    dbPathPrefix,
    options
  );
}

/**
 * Create a fully connected network (each node connects to all others)
 * @param {number} nodeCount - Number of nodes
 * @param {number} basePort - Starting port number
 * @param {string} dbPathPrefix - Prefix for database paths
 * @param {Object} options - Additional options
 * @returns {Array<Object>} - Array of server instances
 */
function createFullyConnectedNetwork(
  nodeCount,
  basePort,
  dbPathPrefix,
  options = {}
) {
  const connections = [];

  for (let i = 0; i < nodeCount; i++) {
    const peers = [];
    for (let j = 0; j < nodeCount; j++) {
      if (i !== j) {
        peers.push(j);
      }
    }
    connections.push(peers);
  }

  return createNetworkWithTopology(
    nodeCount,
    connections,
    dbPathPrefix,
    options
  );
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

module.exports = {
  wait,
  cleanupServers,
  cleanupDatabases,
  createNetworkWithTopology,
  createStarNetwork,
  createRingNetwork,
  createFullyConnectedNetwork,
  createTestNetwork,
};
