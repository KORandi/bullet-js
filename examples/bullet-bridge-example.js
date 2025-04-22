/**
 * Bullet.js Bridge Network Example
 *
 * This example creates two separate clusters of 5 nodes each, connected by a single bridge node.
 * Each cluster forms a fully connected mesh internally, but only the bridge node connects between clusters.
 * This demonstrates how data propagates across network boundaries through bridge connections.
 */

const Bullet = require("../src/bullet");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

// Configuration
const NODES_PER_CLUSTER = 5;
const TOTAL_NODES = NODES_PER_CLUSTER * 2 + 1; // Two clusters + one bridge node
const BRIDGE_NODE_ID = NODES_PER_CLUSTER * 2 + 1;
const BASE_PORT = 8000;
const DATA_UPDATE_INTERVAL = 5000; // Update data every 5 seconds
const LOG_DIR = path.join(__dirname, "bridge_logs");

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Clear any old log files
if (fs.existsSync(LOG_DIR)) {
  fs.readdirSync(LOG_DIR).forEach((file) => {
    fs.unlinkSync(path.join(LOG_DIR, file));
  });
}

/**
 * Create a peer node that runs in a separate process
 * @param {number} nodeId - Node identifier
 * @param {number} port - Port to run the node on
 * @param {Array} peerUrls - URLs of peers to connect to
 * @param {string} clusterId - Identifier for which cluster this node belongs to ("A", "B", or "bridge")
 */
function createPeerNode(nodeId, port, peerUrls, clusterId) {
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
      const formattedMessage = \`[\${timestamp}] Node ${nodeId} (Cluster ${clusterId}): \${message}\n\`;
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
      storagePath: './data/bridge-node-${nodeId}',
      enableIndexing: true,
      enableMiddleware: true
    });
    
    // Node information for data path
    const nodePath = 'nodes/node${nodeId}';
    
    // Initialize node data
    bullet.get(nodePath).put({
      id: ${nodeId},
      name: 'Node ${nodeId}',
      cluster: '${clusterId}',
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
    
    // Subscribe to cluster-specific messages
    bullet.get('messages/${clusterId}').on((data) => {
      if (data) {
        log(\`Cluster ${clusterId} messages updated: \${JSON.stringify(data)}\`);
      }
    });
    
    // Periodically update our data and post a cluster message
    setInterval(() => {
      // Update node data
      const currentData = bullet.get(nodePath).value() || {};
      
      bullet.get(nodePath).put({
        ...currentData,
        dataUpdates: (currentData.dataUpdates || 0) + 1,
        lastUpdate: new Date().toISOString(),
        message: \`Hello from Node ${nodeId} (Cluster ${clusterId}) at \${new Date().toISOString()}\`
      });
      
      // Post a message to the cluster
      const messageId = \`msg_\${Date.now()}_\${Math.floor(Math.random() * 1000)}\`;
      bullet.get(\`messages/${clusterId}/\${messageId}\`).put({
        from: ${nodeId},
        cluster: '${clusterId}',
        text: \`Cluster ${clusterId} message from Node ${nodeId} at \${new Date().toISOString()}\`,
        timestamp: new Date().toISOString()
      });
      
      log(\`Updated local data (update #\${currentData.dataUpdates + 1}) and posted cluster message\`);
    }, ${DATA_UPDATE_INTERVAL});
    
    // Simple HTTP server for status
    const server = http.createServer((req, res) => {
      if (req.url === '/status') {
        const networkData = bullet.get('nodes').value() || {};
        const messagesA = bullet.get('messages/A').value() || {};
        const messagesB = bullet.get('messages/B').value() || {};
        const bridgeMessages = bullet.get('messages/bridge').value() || {};
        
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          nodeId: ${nodeId},
          cluster: '${clusterId}',
          status: 'online',
          network: networkData,
          reachableMessages: {
            'A': Object.keys(messagesA).length,
            'B': Object.keys(messagesB).length,
            'bridge': Object.keys(bridgeMessages).length
          },
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
    log('Node ${nodeId} (Cluster ${clusterId}) running and connected to peers');
  `;

  // Write the worker script to a file
  const scriptFile = path.join(__dirname, `bridge-node-${nodeId}-worker.js`);
  fs.writeFileSync(scriptFile, workerScript);

  // Spawn a new Node.js process to run this worker
  const nodeProcess = spawn("node", [scriptFile], {
    stdio: "inherit",
    detached: true,
  });

  // Log process info
  console.log(
    `Started Node ${nodeId} (Cluster ${clusterId}) process with PID ${nodeProcess.pid}`
  );

  return nodeProcess;
}

/**
 * Create a bridged network of two clusters
 */
function createBridgedNetwork() {
  const nodes = [];
  const peerUrls = {};

  // Generate URLs for all nodes
  for (let i = 1; i <= TOTAL_NODES; i++) {
    const port = BASE_PORT + i - 1;
    peerUrls[i] = `ws://localhost:${port}`;
  }

  // Create cluster A nodes (IDs 1-5)
  for (let i = 1; i <= NODES_PER_CLUSTER; i++) {
    const nodeId = i;
    const port = BASE_PORT + nodeId - 1;

    // Connect to all other nodes in cluster A
    const nodePeers = [];

    // Connect to other nodes in the same cluster
    for (let j = 1; j <= NODES_PER_CLUSTER; j++) {
      if (j !== nodeId) {
        nodePeers.push(peerUrls[j]);
      }
    }

    // Only connect first node to bridge node
    if (nodeId === 1) {
      nodePeers.push(peerUrls[BRIDGE_NODE_ID]);
    }

    const nodeProcess = createPeerNode(nodeId, port, nodePeers, "A");
    nodes.push({ id: nodeId, port, process: nodeProcess, cluster: "A" });
  }

  // Create cluster B nodes (IDs 6-10)
  for (let i = 1; i <= NODES_PER_CLUSTER; i++) {
    const nodeId = NODES_PER_CLUSTER + i;
    const port = BASE_PORT + nodeId - 1;

    // Connect to all other nodes in cluster B
    const nodePeers = [];

    // Connect to other nodes in the same cluster
    for (let j = 1; j <= NODES_PER_CLUSTER; j++) {
      const peerId = NODES_PER_CLUSTER + j;
      if (peerId !== nodeId) {
        nodePeers.push(peerUrls[peerId]);
      }
    }

    // Only connect first node in cluster B to bridge node
    if (i === 1) {
      nodePeers.push(peerUrls[BRIDGE_NODE_ID]);
    }

    const nodeProcess = createPeerNode(nodeId, port, nodePeers, "B");
    nodes.push({ id: nodeId, port, process: nodeProcess, cluster: "B" });
  }

  // Create bridge node (ID 11)
  const bridgeNodeId = BRIDGE_NODE_ID;
  const bridgePort = BASE_PORT + bridgeNodeId - 1;

  // Bridge connects to just one node in each cluster (first node in cluster A and first node in cluster B)
  const bridgePeers = [
    peerUrls[1], // First node in cluster A
    peerUrls[NODES_PER_CLUSTER + 1], // First node in cluster B
  ];

  const bridgeProcess = createPeerNode(
    bridgeNodeId,
    bridgePort,
    bridgePeers,
    "bridge"
  );
  nodes.push({
    id: bridgeNodeId,
    port: bridgePort,
    process: bridgeProcess,
    cluster: "bridge",
  });

  return nodes;
}

/**
 * Create a monitoring server to get network status
 */
function createMonitorServer() {
  const monitorPort = BASE_PORT + TOTAL_NODES + 1000;

  const server = http.createServer(async (req, res) => {
    if (req.url === "/status") {
      // Get status from all nodes
      const statuses = [];

      try {
        for (let i = 1; i <= TOTAL_NODES; i++) {
          const nodeId = i;
          const statusPort = BASE_PORT + i - 1 + 1000;

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

        // Group nodes by cluster
        const clusterA = statuses.filter((node) => node.cluster === "A");
        const clusterB = statuses.filter((node) => node.cluster === "B");
        const bridgeNode = statuses.filter((node) => node.cluster === "bridge");

        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            {
              networkSize: TOTAL_NODES,
              clusterASize: NODES_PER_CLUSTER,
              clusterBSize: NODES_PER_CLUSTER,
              timestamp: new Date().toISOString(),
              topology: {
                clusterA: clusterA.map((n) => n.nodeId),
                clusterB: clusterB.map((n) => n.nodeId),
                bridge: bridgeNode.map((n) => n.nodeId),
              },
              messageStats: statuses.reduce((acc, node) => {
                if (node.reachableMessages) {
                  acc.push({
                    nodeId: node.nodeId,
                    cluster: node.cluster,
                    reachableMessages: node.reachableMessages,
                  });
                }
                return acc;
              }, []),
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
    } else if (req.url === "/visualization") {
      // Simple network visualization
      const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Bullet.js Bridge Network Visualization</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
            .container { max-width: 1200px; margin: 0 auto; }
            .network { display: flex; flex-direction: column; align-items: center; }
            .clusters { display: flex; justify-content: space-between; width: 100%; margin: 50px 0; }
            .cluster { border: 1px solid #ccc; border-radius: 10px; padding: 20px; width: 45%; }
            .cluster-title { text-align: center; font-size: 20px; font-weight: bold; margin-bottom: 20px; }
            .nodes { display: flex; flex-wrap: wrap; justify-content: center; }
            .node { border: 1px solid #333; border-radius: 50%; width: 60px; height: 60px; margin: 10px; 
                   display: flex; align-items: center; justify-content: center; 
                   font-weight: bold; cursor: pointer; }
            .node.cluster-a { background-color: #ffcccc; }
            .node.cluster-b { background-color: #ccccff; }
            .node.bridge { background-color: #ccffcc; width: 80px; height: 80px; }
            .bridge-container { margin: 20px 0; }
            .connections { position: relative; width: 100%; height: 100px; }
            .connection { position: absolute; height: 2px; background-color: #666; transform-origin: left center; }
            .status-panel { margin-top: 30px; border: 1px solid #ccc; padding: 15px; border-radius: 5px; }
            .refresh { margin-top: 20px; padding: 10px; background-color: #4CAF50; color: white; 
                      border: none; border-radius: 4px; cursor: pointer; }
            .refresh:hover { background-color: #45a049; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Bullet.js Bridge Network Visualization</h1>
            <p>This visualization shows two clusters of nodes connected by a single bridge node.</p>
            
            <div class="network">
              <div class="clusters">
                <div class="cluster">
                  <div class="cluster-title">Cluster A</div>
                  <div class="nodes" id="cluster-a-nodes"></div>
                </div>
                
                <div class="cluster">
                  <div class="cluster-title">Cluster B</div>
                  <div class="nodes" id="cluster-b-nodes"></div>
                </div>
              </div>
              
              <div class="bridge-container">
                <div class="node bridge" id="bridge-node">Bridge</div>
              </div>
              
              <div class="connections" id="connections"></div>
              
              <div class="status-panel" id="status-panel">
                <h3>Network Status</h3>
                <div id="status-content">Loading status information...</div>
              </div>
              
              <button class="refresh" onclick="fetchStatus()">Refresh Status</button>
            </div>
          </div>
          
          <script>
            // Create nodes
            const clusterAContainer = document.getElementById('cluster-a-nodes');
            const clusterBContainer = document.getElementById('cluster-b-nodes');
            
            for (let i = 1; i <= ${NODES_PER_CLUSTER}; i++) {
              const node = document.createElement('div');
              node.className = 'node cluster-a';
              node.id = 'node-' + i;
              node.textContent = i;
              node.onclick = () => showNodeDetails(i);
              clusterAContainer.appendChild(node);
            }
            
            for (let i = ${NODES_PER_CLUSTER + 1}; i <= ${
        NODES_PER_CLUSTER * 2
      }; i++) {
              const node = document.createElement('div');
              node.className = 'node cluster-b';
              node.id = 'node-' + i;
              node.textContent = i;
              node.onclick = () => showNodeDetails(i);
              clusterBContainer.appendChild(node);
            }
            
            const bridgeNode = document.getElementById('bridge-node');
            bridgeNode.textContent = ${BRIDGE_NODE_ID};
            bridgeNode.onclick = () => showNodeDetails(${BRIDGE_NODE_ID});
            
            // Fetch network status
            function fetchStatus() {
              fetch('/status')
                .then(response => response.json())
                .then(data => {
                  // Update status panel
                  const statusContent = document.getElementById('status-content');
                  
                  let html = '<ul>';
                  html += '<li><strong>Network Size:</strong> ' + data.networkSize + ' nodes</li>';
                  html += '<li><strong>Updated:</strong> ' + new Date(data.timestamp).toLocaleTimeString() + '</li>';
                  html += '</ul>';
                  
                  html += '<h4>Message Propagation:</h4>';
                  html += '<table style="width:100%; border-collapse: collapse;">';
                  html += '<tr><th style="text-align:left; padding:5px; border-bottom:1px solid #ddd;">Node</th>' + 
                          '<th style="text-align:left; padding:5px; border-bottom:1px solid #ddd;">Cluster</th>' + 
                          '<th style="text-align:left; padding:5px; border-bottom:1px solid #ddd;">A Messages</th>' + 
                          '<th style="text-align:left; padding:5px; border-bottom:1px solid #ddd;">B Messages</th>' + 
                          '<th style="text-align:left; padding:5px; border-bottom:1px solid #ddd;">Bridge Messages</th></tr>';
                          
                  data.messageStats.forEach(stats => {
                    html += '<tr>' + 
                            '<td style="padding:5px; border-bottom:1px solid #ddd;">Node ' + stats.nodeId + '</td>' + 
                            '<td style="padding:5px; border-bottom:1px solid #ddd;">' + stats.cluster + '</td>' + 
                            '<td style="padding:5px; border-bottom:1px solid #ddd;">' + stats.reachableMessages.A + '</td>' + 
                            '<td style="padding:5px; border-bottom:1px solid #ddd;">' + stats.reachableMessages.B + '</td>' + 
                            '<td style="padding:5px; border-bottom:1px solid #ddd;">' + stats.reachableMessages.bridge + '</td>' + 
                            '</tr>';
                  });
                  
                  html += '</table>';
                  
                  statusContent.innerHTML = html;
                  
                  // Update node status
                  data.nodes.forEach(node => {
                    const nodeElement = document.getElementById('node-' + node.nodeId);
                    if (nodeElement) {
                      if (node.status === 'online') {
                        nodeElement.style.opacity = 1;
                      } else {
                        nodeElement.style.opacity = 0.3;
                      }
                    }
                  });
                })
                .catch(error => {
                  console.error('Error fetching status:', error);
                  document.getElementById('status-content').innerHTML = 
                    '<div style="color: red;">Error fetching network status. The monitor server might be down.</div>';
                });
            }
            
            function showNodeDetails(nodeId) {
              // Fetch specific node status
              fetch('/status')
                .then(response => response.json())
                .then(data => {
                  const node = data.nodes.find(n => n.nodeId === nodeId);
                  if (node) {
                    alert('Node ' + nodeId + ' (Cluster ' + node.cluster + ')\\n' +
                          'Status: ' + node.status + '\\n' +
                          'Connected to: ' + node.network.nodes['node'+nodeId].neighbors.length + ' peers\\n' +
                          'Reachable Messages: A(' + node.reachableMessages.A + 
                          '), B(' + node.reachableMessages.B + 
                          '), Bridge(' + node.reachableMessages.bridge + ')');
                  } else {
                    alert('Node ' + nodeId + ' information not available');
                  }
                })
                .catch(error => {
                  console.error('Error fetching node details:', error);
                  alert('Error fetching node details: ' + error.message);
                });
            }
            
            // Initial fetch
            fetchStatus();
            // Auto-refresh every 10 seconds
            setInterval(fetchStatus, 10000);
          </script>
        </body>
      </html>
      `;

      res.setHeader("Content-Type", "text/html");
      res.end(html);
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
    console.log(
      `View network visualization at http://localhost:${monitorPort}/visualization`
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
  console.log(
    `Starting a bridged network with ${TOTAL_NODES} nodes (${NODES_PER_CLUSTER} nodes per cluster + 1 bridge node)`
  );

  // Create the bridged network
  const nodes = createBridgedNetwork();

  // Create a monitor server
  const monitorServer = createMonitorServer();

  console.log("\nNetwork initialization complete");
  console.log(`Started ${nodes.length} nodes in the bridged topology:`);
  console.log(
    `- Cluster A: Nodes 1-${NODES_PER_CLUSTER} (Only Node 1 connects to bridge)`
  );
  console.log(
    `- Cluster B: Nodes ${NODES_PER_CLUSTER + 1}-${
      NODES_PER_CLUSTER * 2
    } (Only Node ${NODES_PER_CLUSTER + 1} connects to bridge)`
  );
  console.log(
    `- Bridge Node: Node ${BRIDGE_NODE_ID} (Connects only to Node 1 and Node ${
      NODES_PER_CLUSTER + 1
    })`
  );
  console.log(
    `Nodes will update their data every ${DATA_UPDATE_INTERVAL / 1000} seconds`
  );
  console.log(`Log files are stored in the '${LOG_DIR}' directory`);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down bridge network...");

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
      const scriptFile = path.join(
        __dirname,
        `bridge-node-${node.id}-worker.js`
      );
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
