/**
 * Bullet.js Circle Network Example
 *
 * This example creates 14 Bullet.js instances connected in a circle topology.
 * Each node connects to exactly two peers: the next and previous node in the circle.
 */

const Bullet = require("../src/bullet");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

// Configuration
const NUM_NODES = 14;
const BASE_PORT = 8000;
const DATA_UPDATE_INTERVAL = 5000; // Update data every 5 seconds
const LOG_DIR = path.join(__dirname, "logs");

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Clear any old log files
fs.readdirSync(LOG_DIR).forEach((file) => {
  fs.unlinkSync(path.join(LOG_DIR, file));
});

/**
 * Create a peer node that runs in a separate process
 * @param {number} nodeId - Node identifier
 * @param {number} port - Port to run the node on
 * @param {Array} peerUrls - URLs of peers to connect to
 */
function createPeerNode(nodeId, port, peerUrls) {
  // Create a worker script for this node
  const workerScript = `
    const Bullet = require('../src/bullet');
    const fs = require('fs');
    const path = require('path');
    const http = require('http');
    
    // Logging setup
    const logFile = path.join('${LOG_DIR}', 'node-${nodeId}.log');
    const logger = fs.createWriteStream(logFile, { flags: 'a' });
    
    // Custom console log that writes to file
    const log = (message) => {
      const timestamp = new Date().toISOString();
      const formattedMessage = \`[\${timestamp}] Node ${nodeId}: \${message}\n\`;
      logger.write(formattedMessage);
      console.log(formattedMessage);
    };
    
    // Initialize the node
    log('Starting node ${nodeId} on port ${port}');
    
    const bullet = new Bullet({
      peers: ${JSON.stringify(peerUrls)},
      server: true,
      port: ${port},
      storage: true,
      storagePath: './data/node-${nodeId}',
      enableIndexing: true,
      enableMiddleware: true,
      syncInterval: 1000
    });
    
    // Node information for data path
    const nodePath = 'nodes/node${nodeId}';
    
    // Initialize node data
    bullet.get(nodePath).put({
      id: ${nodeId},
      name: 'Node ${nodeId}',
      port: ${port},
      startTime: new Date().toISOString(),
      status: 'online',
      neighbors: ${JSON.stringify(peerUrls)},
      dataUpdates: 0,
      lastUpdate: null
    });
    
    // Subscribe to our own data
    bullet.get(nodePath).on((data) => {
      log(\`Local data updated: \${JSON.stringify(data)}\`);
    });
    
    // Subscribe to all nodes data
    bullet.get('nodes').on((data) => {
      if (data) {
        const nodeIds = Object.keys(data);
        log(\`Network has \${nodeIds.length} visible nodes: \${nodeIds.join(', ')}\`);
      }
    });
    
    // Monitor changes from other nodes
    bullet.middleware.afterPut((path, newData, oldData) => {
      if (path.startsWith('nodes/') && !path.startsWith('nodes/node${nodeId}')) {
        log(\`Received update from \${path}: \${JSON.stringify(newData)}\`);
      }
    });
    
    // Periodically update our data
    setInterval(() => {
      const currentData = bullet.get(nodePath).value() || {};
      
      bullet.get(nodePath).put({
        ...currentData,
        dataUpdates: (currentData.dataUpdates || 0) + 1,
        lastUpdate: new Date().toISOString(),
        message: \`Hello from Node ${nodeId} at \${new Date().toISOString()}\`
      });
      
      log(\`Updated local data (update #\${currentData.dataUpdates + 1})\`);
    }, ${DATA_UPDATE_INTERVAL});
    
    // Simple HTTP server for status
    const server = http.createServer((req, res) => {
      if (req.url === '/status') {
        const networkData = bullet.get('nodes').value() || {};
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          nodeId: ${nodeId},
          status: 'online',
          network: networkData,
          timestamp: new Date().toISOString()
        }, null, 2));
      } else {
        res.statusCode = 404;
        res.end('Not found');
      }
    });
    
    server.listen(${port + 1000}, () => {
      log(\`HTTP status server running at http://localhost:${port + 1000}\`);
    });
    
    // Handle process termination
    process.on('SIGINT', () => {
      log('Shutting down gracefully');
      bullet.get(nodePath).put({
        ...bullet.get(nodePath).value(),
        status: 'offline',
        shutdownTime: new Date().toISOString()
      });
      
      setTimeout(() => {
        bullet.close();
        server.close();
        logger.end();
        process.exit(0);
      }, 1000);
    });
    
    // Keep process alive
    log('Node ${nodeId} running and connected to peers');
  `;

  // Write the worker script to a file
  const scriptFile = path.join(__dirname, `node-${nodeId}-worker.js`);
  fs.writeFileSync(scriptFile, workerScript);

  // Spawn a new Node.js process to run this worker
  const nodeProcess = spawn("node", [scriptFile], {
    stdio: "inherit",
    detached: true,
  });

  // Log process info
  console.log(`Started Node ${nodeId} process with PID ${nodeProcess.pid}`);

  return nodeProcess;
}

/**
 * Create a circle topology of peer nodes
 */
function createCircleNetwork() {
  const nodes = [];

  // First, prepare peer URLs for each node
  const peerUrls = [];

  for (let i = 0; i < NUM_NODES; i++) {
    const port = BASE_PORT + i;
    peerUrls.push(`ws://localhost:${port}`);
  }

  // Create each node with connections to previous and next node in circle
  for (let i = 0; i < NUM_NODES; i++) {
    const nodeId = i + 1; // Node IDs start from 1
    const port = BASE_PORT + i;

    // In a circle, connect to the nodes before and after this one
    const prevIdx = (i - 1 + NUM_NODES) % NUM_NODES;
    const nextIdx = (i + 1) % NUM_NODES;

    // Only connect to immediate neighbors
    const nodePeers = [peerUrls[prevIdx], peerUrls[nextIdx]];

    const nodeProcess = createPeerNode(nodeId, port, nodePeers);
    nodes.push({ id: nodeId, port, process: nodeProcess });
  }

  return nodes;
}

/**
 * Create a monitoring server to get network status
 */
function createMonitorServer() {
  const monitorPort = BASE_PORT + NUM_NODES + 1000;

  const server = http.createServer(async (req, res) => {
    if (req.url === "/status") {
      // Get status from all nodes
      const statuses = [];

      try {
        for (let i = 0; i < NUM_NODES; i++) {
          const nodeId = i + 1;
          const statusPort = BASE_PORT + i + 1000;

          try {
            const nodeStatus = await fetchNodeStatus(
              `http://localhost:${statusPort}/status`
            );
            statuses.push({
              nodeId,
              status: "online",
              ...nodeStatus,
            });
          } catch (error) {
            statuses.push({
              nodeId,
              status: "error",
              error: error.message,
            });
          }
        }

        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            {
              networkSize: NUM_NODES,
              timestamp: new Date().toISOString(),
              nodes: statuses,
            },
            null,
            2
          )
        );
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: error.message }));
      }
    } else {
      res.statusCode = 404;
      res.end("Not found");
    }
  });

  server.listen(monitorPort, () => {
    console.log(`Monitor server running at http://localhost:${monitorPort}`);
    console.log(
      `View network status at http://localhost:${monitorPort}/status`
    );
  });

  return server;
}

/**
 * Fetch status from a node
 * @param {string} url - Status URL
 * @return {Promise} - Node status
 */
function fetchNodeStatus(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(
              new Error(
                `Failed to parse response from ${url}: ${error.message}`
              )
            );
          }
        });
      })
      .on("error", (error) => {
        reject(new Error(`Failed to connect to ${url}: ${error.message}`));
      });
  });
}

/**
 * Main function to start the network
 */
function main() {
  console.log(`Starting a circle network with ${NUM_NODES} nodes`);

  // Create the circle network
  const nodes = createCircleNetwork();

  // Create a monitor server
  const monitorServer = createMonitorServer();

  console.log("\nNetwork initialization complete");
  console.log(`Started ${nodes.length} nodes in a circle topology`);
  console.log(
    `Each node is connected to 2 peers (previous and next in circle)`
  );
  console.log(
    `Nodes will update their data every ${DATA_UPDATE_INTERVAL / 1000} seconds`
  );
  console.log(`Log files are stored in the '${LOG_DIR}' directory`);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down circle network...");

    // Close monitor server
    monitorServer.close();

    // Kill node processes
    nodes.forEach((node) => {
      try {
        process.kill(-node.process.pid, "SIGINT");
      } catch (error) {
        console.error(`Error stopping node ${node.id}: ${error.message}`);
      }
    });

    // Remove temp script files
    nodes.forEach((node) => {
      const scriptFile = path.join(__dirname, `node-${node.id}-worker.js`);
      if (fs.existsSync(scriptFile)) {
        fs.unlinkSync(scriptFile);
      }
    });

    console.log("Shutdown complete");
    process.exit(0);
  });

  console.log("\nPress Ctrl+C to stop the network");
}

// Run the main function
main();
