/**
 * Bullet.js Chain Network Example
 *
 * This example creates 32 Bullet.js instances connected in a linear chain.
 * Each node connects only to its immediate neighbors (previous and next nodes).
 * This demonstrates how data propagates through a long network chain and the impact
 * of hop distance on data synchronization.
 */

const Bullet = require("../src/bullet");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

// Configuration
const NUM_NODES = 2;
const BASE_PORT = 8000;
const DATA_UPDATE_INTERVAL = 5000; // Update data every 5 seconds
const LOG_DIR = path.join(__dirname, "../data/chain_logs");

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
 * @param {number} position - Position in the chain (1 = start, NUM_NODES = end)
 */
function createPeerNode(nodeId, port, peerUrls, position) {
  // Create a worker script for this node
  const workerScript = `
    const Bullet = require('../src/bullet');
    const fs = require('fs');
    const path = require('path');
    const http = require('http');
    
    // Logging setup
    const logFile = path.join('${LOG_DIR}', 'node-${nodeId}.log');
    const logger = fs.createWriteStream(logFile, { flags: 'a' });
    
    // Custom // console.log that writes to file
    const log = (message) => {
      const timestamp = new Date().toISOString();
      const formattedMessage = \`[\${timestamp}] Node ${nodeId} (Position ${position}): \${message}\n\`;
      logger.write(formattedMessage);
      // console.log(formattedMessage);
    };
    
    // Initialize the node
    log('Starting node ${nodeId} on port ${port}');
    
    const bullet = new Bullet({
      peers: ${JSON.stringify(peerUrls)},
      server: true,
      port: ${port},
      storage: true,
      storagePath: './data/chain-node-${nodeId}',
      enableIndexing: true,
      enableMiddleware: true
    });
    
    // Node information for data path
    const nodePath = 'nodes/node${nodeId}';
    
    // Initialize node data
    bullet.get(nodePath).put({
      id: ${nodeId},
      name: 'Node ${nodeId}',
      position: ${position},
      port: ${port},
      startTime: new Date().toISOString(),
      status: 'online',
      neighbors: ${JSON.stringify(peerUrls)},
      dataUpdates: 0,
      lastUpdate: null,
      isEndpoint: ${position === 1 || position === NUM_NODES ? "true" : "false"}
    });
    
    // Subscribe to our own data
    bullet.get(nodePath).on((data) => {
      log(\`Local data updated: \${JSON.stringify(data)}\`);
    });
    
    // Subscribe to all nodes data
    bullet.get('nodes').on((data) => {
      if (data) {
        const nodeIds = Object.keys(data);
        log(\`Network has \${nodeIds.length} visible nodes\`);
      }
    });
    
    // Monitor changes from other nodes
    bullet.middleware.afterPut((path, newData, oldData) => {
      if (path.startsWith('nodes/') && !path.startsWith('nodes/node${nodeId}')) {
        log(\`Received update from \${path}: data version \${newData?.dataUpdates || 'unknown'}\`);
      }
      
      // Monitor message propagation
      if (path.startsWith('messages/')) {
        const msgParts = path.split('/');
        if (msgParts.length >= 3) {
          const origin = msgParts[2];
          log(\`Received message from origin node \${origin}: \${JSON.stringify(newData)}\`);
        }
      }
    });
    
    // Periodically update our data and post a message
    setInterval(() => {
      // Update node data
      const currentData = bullet.get(nodePath).value() || {};
      
      // bullet.get(nodePath).put({
      //   ...currentData,
      //   dataUpdates: (currentData.dataUpdates || 0) + 1,
      //   lastUpdate: new Date().toISOString(),
      //   message: \`Hello from Node ${nodeId} at \${new Date().toISOString()}\`
      // });
      
      // Every 3rd update, create a message that should propagate through the chain
      if ((currentData.dataUpdates || 0) % 3 === 0) {
        const messageId = \`msg_\${Date.now()}_\${Math.floor(Math.random() * 1000)}\`;
        const messageData = {
          from: ${nodeId},
          position: ${position},
          timestamp: Date.now(),
          text: \`Test message from Node ${nodeId} (position ${position}) at \${new Date().toISOString()}\`,
          hopCount: 0
        };
        
        // bullet.get(\`messages/${nodeId}/\${messageId}\`).put(messageData);
        log(\`Created new propagation test message: \${JSON.stringify(messageData)}\`);
      }
      
      log(\`Updated local data (update #\${currentData.dataUpdates + 1})\`);
    }, ${DATA_UPDATE_INTERVAL});
    
    // Simple HTTP server for status
    const server = http.createServer((req, res) => {
      if (req.url === '/status') {
        const networkData = bullet.get('nodes').value() || {};
        const messagesData = bullet.get('messages').value() || {};
        
        // Collect message propagation stats
        const messageStats = {};
        for (const [origin, messages] of Object.entries(messagesData)) {
          messageStats[origin] = Object.keys(messages).length;
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          nodeId: ${nodeId},
          position: ${position},
          status: 'online',
          dataUpdateCount: bullet.get(nodePath).value()?.dataUpdates || 0,
          visibleNodes: Object.keys(networkData).length,
          visibleMessages: messageStats,
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
    log('Node ${nodeId} (Position ${position}) running and connected to peers');
  `;

  // Write the worker script to a file
  const scriptFile = path.join(__dirname, `chain-node-${nodeId}-worker.js`);
  fs.writeFileSync(scriptFile, workerScript);

  // Spawn a new Node.js process to run this worker
  const nodeProcess = spawn("node", [scriptFile], {
    stdio: "inherit",
    detached: true,
  });

  // Log process info
  // console.log(
  //   `Started Node ${nodeId} (Position ${position}) with PID ${nodeProcess.pid}`
  // );

  return nodeProcess;
}

/**
 * Create a chain network of nodes
 */
function createChainNetwork() {
  const nodes = [];

  // First, prepare peer URLs for each node
  const peerUrls = {};
  for (let i = 1; i <= NUM_NODES; i++) {
    const port = BASE_PORT + i - 1;
    peerUrls[i] = `ws://localhost:${port}`;
  }

  // Create each node with connections only to previous and next nodes
  for (let i = 1; i <= NUM_NODES; i++) {
    const nodeId = i;
    const port = BASE_PORT + nodeId - 1;
    const position = i;

    // Connect only to adjacent nodes in the chain
    const nodePeers = [];

    // Connect to previous node (if not first node)
    if (position > 1) {
      nodePeers.push(peerUrls[position - 1]);
    }

    // Connect to next node (if not last node)
    if (position < NUM_NODES) {
      nodePeers.push(peerUrls[position + 1]);
    }

    const nodeProcess = createPeerNode(nodeId, port, nodePeers, position);
    nodes.push({ id: nodeId, port, process: nodeProcess, position });
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
        for (let i = 1; i <= NUM_NODES; i++) {
          const nodeId = i;
          const statusPort = BASE_PORT + i - 1 + 1000;

          try {
            const nodeStatus = await fetchNodeStatus(
              `http://localhost:${statusPort}/status`
            );
            statuses.push({
              nodeId,
              position: i,
              status: "online",
              ...nodeStatus,
            });
          } catch (error) {
            statuses.push({
              nodeId,
              position: i,
              status: "error",
              error: error.message,
            });
          }
        }

        // Sort by position
        statuses.sort((a, b) => a.position - b.position);

        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            {
              networkSize: NUM_NODES,
              topology: "chain",
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
    } else if (req.url === "/visualization") {
      // Simple network visualization
      const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Bullet.js Chain Network Visualization</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f8f9fa; }
            .container { max-width: 1400px; margin: 0 auto; background-color: white; padding: 20px; 
                      border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #333; }
            .network { display: flex; flex-direction: column; align-items: center; margin-top: 30px; }
            .chain-container { display: flex; flex-wrap: wrap; justify-content: center; gap: 5px; width: 100%; margin: 20px 0; }
            .node { border: 1px solid #333; border-radius: 50%; width: 40px; height: 40px; 
                   display: flex; align-items: center; justify-content: center; 
                   font-weight: bold; cursor: pointer; position: relative; margin: 10px; }
            .node:hover { box-shadow: 0 0 8px rgba(0,0,0,0.3); }
            .node-connector { height: 2px; width: 30px; background-color: #666; display: inline-block; }
            .message-count { position: absolute; top: -8px; right: -8px; background-color: #ff5722; 
                          color: white; border-radius: 50%; width: 18px; height: 18px; 
                          font-size: 10px; display: flex; align-items: center; justify-content: center; }
            .status-panel { margin-top: 30px; border: 1px solid #ddd; padding: 15px; border-radius: 5px; }
            .refresh { margin-top: 20px; padding: 10px 15px; background-color: #4CAF50; color: white; 
                      border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
            .refresh:hover { background-color: #45a049; }
            .heat-map { width: 100%; height: 100px; margin: 20px 0; border: 1px solid #ddd; position: relative; }
            .heat-map-label { font-size: 12px; color: #666; margin-bottom: 5px; }
            .tooltip { position: absolute; background-color: rgba(0,0,0,0.8); color: white; 
                      padding: 5px 10px; border-radius: 4px; font-size: 12px; pointer-events: none;
                      white-space: nowrap; display: none; z-index: 1000; }
            .legend { display: flex; justify-content: center; margin-top: 10px; }
            .legend-item { display: flex; align-items: center; margin: 0 10px; }
            .legend-color { width: 15px; height: 15px; margin-right: 5px; border-radius: 2px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background-color: #f2f2f2; }
            tr:hover { background-color: #f5f5f5; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Bullet.js Chain Network Visualization</h1>
            <p>This visualization shows a chain of ${NUM_NODES} nodes where each node only connects to its immediate neighbors.</p>
            
            <div class="network">
              <div class="chain-container" id="chain-container">
                <!-- Nodes will be added dynamically by JavaScript -->
              </div>
              
              <div class="heat-map-label">Message Propagation Heat Map (shows how messages spread through the chain)</div>
              <div class="heat-map" id="heat-map"></div>
              
              <div class="legend">
                <div class="legend-item">
                  <div class="legend-color" style="background-color: rgb(0, 100, 0);"></div>
                  <span>Many Messages</span>
                </div>
                <div class="legend-item">
                  <div class="legend-color" style="background-color: rgb(255, 255, 0);"></div>
                  <span>Some Messages</span>
                </div>
                <div class="legend-item">
                  <div class="legend-color" style="background-color: rgb(200, 0, 0);"></div>
                  <span>Few Messages</span>
                </div>
                <div class="legend-item">
                  <div class="legend-color" style="background-color: rgb(200, 200, 200);"></div>
                  <span>No Messages</span>
                </div>
              </div>
              
              <div class="status-panel" id="status-panel">
                <h3>Network Status</h3>
                <div id="status-content">Loading status information...</div>
              </div>
              
              <button class="refresh" onclick="fetchStatus()">Refresh Status</button>
            </div>
          </div>
          
          <div class="tooltip" id="tooltip"></div>
          
          <script>
            const numNodes = ${NUM_NODES};
            const chainContainer = document.getElementById('chain-container');
            const tooltip = document.getElementById('tooltip');
            let networkData = [];
            
            // Create chain nodes
            function createChainNodes() {
              chainContainer.innerHTML = '';
              
              for (let i = 1; i <= numNodes; i++) {
                // Create node
                const nodeEl = document.createElement('div');
                nodeEl.className = 'node';
                nodeEl.id = 'node-' + i;
                nodeEl.textContent = i;
                nodeEl.dataset.position = i;
                nodeEl.onclick = () => showNodeDetails(i);
                nodeEl.onmouseover = (e) => {
                  tooltip.style.display = 'block';
                  tooltip.style.left = (e.pageX + 10) + 'px';
                  tooltip.style.top = (e.pageY + 10) + 'px';
                  const nodeData = networkData.find(n => n.nodeId === i);
                  if (nodeData) {
                    tooltip.innerHTML = \`Node \${i} (Position \${i})<br>
                      Updates: \${nodeData.dataUpdateCount || 0}<br>
                      Visible nodes: \${nodeData.visibleNodes || 0}\`;
                  } else {
                    tooltip.textContent = \`Node \${i} (Position \${i})\`;
                  }
                };
                nodeEl.onmouseout = () => {
                  tooltip.style.display = 'none';
                };
                chainContainer.appendChild(nodeEl);
                
                // Add connector if not the last node
                if (i < numNodes) {
                  const connector = document.createElement('div');
                  connector.className = 'node-connector';
                  chainContainer.appendChild(connector);
                }
              }
            }
            
            // Update heat map visualization
            function updateHeatMap(data) {
              const heatMap = document.getElementById('heat-map');
              heatMap.innerHTML = '';
              
              if (!data || data.length === 0) return;
              
              // Get all message origins
              const allOrigins = new Set();
              let maxMessages = 0;
              
              data.forEach(node => {
                if (node.visibleMessages) {
                  Object.keys(node.visibleMessages).forEach(origin => {
                    allOrigins.add(origin);
                    const count = node.visibleMessages[origin] || 0;
                    if (count > maxMessages) maxMessages = count;
                  });
                }
              });
              
              // Convert to array and sort
              const origins = Array.from(allOrigins).sort();
              
              // Calculate cell size
              const cellWidth = 100 / numNodes;
              const cellHeight = 100 / origins.length;
              
              // Create cells
              for (let y = 0; y < origins.length; y++) {
                const origin = origins[y];
                
                for (let x = 0; x < numNodes; x++) {
                  const nodeId = x + 1;
                  const nodeData = data.find(n => n.nodeId === nodeId);
                  
                  // Get message count
                  let messageCount = 0;
                  if (nodeData && nodeData.visibleMessages && nodeData.visibleMessages[origin]) {
                    messageCount = nodeData.visibleMessages[origin];
                  }
                  
                  // Calculate color based on message count
                  const intensity = maxMessages > 0 ? messageCount / maxMessages : 0;
                  let color;
                  
                  if (intensity === 0) {
                    color = 'rgb(200, 200, 200)'; // Gray for no messages
                  } else if (intensity < 0.3) {
                    color = \`rgb(\${200 + Math.floor(intensity * 55)}, 0, 0)\`; // Red for few messages
                  } else if (intensity < 0.7) {
                    color = \`rgb(\${Math.floor(255 * (1 - intensity))}, \${Math.floor(255 * intensity)}, 0)\`; // Yellow for some messages
                  } else {
                    color = \`rgb(0, \${Math.floor(100 + intensity * 155)}, 0)\`; // Green for many messages
                  }
                  
                  // Create cell
                  const cell = document.createElement('div');
                  cell.style.position = 'absolute';
                  cell.style.left = (x * cellWidth) + '%';
                  cell.style.top = (y * cellHeight) + '%';
                  cell.style.width = cellWidth + '%';
                  cell.style.height = cellHeight + '%';
                  cell.style.backgroundColor = color;
                  cell.style.border = '1px solid #fff';
                  cell.style.cursor = 'pointer';
                  
                  // Add tooltip 
                  cell.onmouseover = (e) => {
                    tooltip.style.display = 'block';
                    tooltip.style.left = (e.pageX + 10) + 'px';
                    tooltip.style.top = (e.pageY + 10) + 'px';
                    tooltip.innerHTML = \`Origin: Node \${origin}<br>
                                        Receiver: Node \${nodeId}<br>
                                        Messages: \${messageCount}\`;
                  };
                  cell.onmouseout = () => {
                    tooltip.style.display = 'none';
                  };
                  
                  heatMap.appendChild(cell);
                }
              }
              
              // Add Y-axis labels (origins)
              for (let y = 0; y < origins.length; y++) {
                const origin = origins[y];
                const label = document.createElement('div');
                label.style.position = 'absolute';
                label.style.right = '100%';
                label.style.top = (y * cellHeight + cellHeight/2 - 8) + '%';
                label.style.fontSize = '10px';
                label.style.color = '#333';
                label.style.marginRight = '5px';
                label.textContent = 'From ' + origin;
                heatMap.appendChild(label);
              }
              
              // Add X-axis labels (node positions)
              for (let x = 0; x < numNodes; x += Math.max(1, Math.floor(numNodes / 10))) {
                const nodeId = x + 1;
                const label = document.createElement('div');
                label.style.position = 'absolute';
                label.style.left = (x * cellWidth + cellWidth/2 - 8) + '%';
                label.style.top = '100%';
                label.style.fontSize = '10px';
                label.style.color = '#333';
                label.style.marginTop = '5px';
                label.textContent = nodeId;
                heatMap.appendChild(label);
              }
            }
            
            // Create the initial chain visualization
            createChainNodes();
            
            // Fetch network status
            async function fetchStatus() {
              try {
                const response = await fetch('/status');
                const data = await response.json();
                
                networkData = data.nodes;
                
                // Update node status indicators
                networkData.forEach(node => {
                  const nodeEl = document.getElementById('node-' + node.nodeId);
                  if (!nodeEl) return;
                  
                  // Update node appearance based on status
                  if (node.status === 'online') {
                    nodeEl.style.backgroundColor = '#81c784';
                    nodeEl.style.opacity = 1;
                    
                    // Add message count indicator
                    let totalMessages = 0;
                    if (node.visibleMessages) {
                      Object.values(node.visibleMessages).forEach(count => {
                        totalMessages += count;
                      });
                    }
                    
                    // Only show message count if there are messages
                    if (totalMessages > 0) {
                      let messageCountEl = nodeEl.querySelector('.message-count');
                      if (!messageCountEl) {
                        messageCountEl = document.createElement('div');
                        messageCountEl.className = 'message-count';
                        nodeEl.appendChild(messageCountEl);
                      }
                      messageCountEl.textContent = totalMessages;
                    }
                  } else {
                    nodeEl.style.backgroundColor = '#e57373';
                    nodeEl.style.opacity = 0.6;
                  }
                });
                
                // Update heat map
                updateHeatMap(networkData);
                
                // Update status panel
                const statusContent = document.getElementById('status-content');
                
                // Count online nodes
                const onlineCount = networkData.filter(node => node.status === 'online').length;
                
                let html = '<div style="margin-bottom: 15px;">';
                html += '<strong>Network:</strong> ' + onlineCount + ' of ' + numNodes + ' nodes online';
                html += ' | <strong>Updated:</strong> ' + new Date(data.timestamp).toLocaleTimeString();
                html += '</div>';
                
                // Create a table of node stats
                html += '<table>';
                html += '<tr><th>Node</th><th>Position</th><th>Updates</th><th>Visible Nodes</th><th>Message Sources</th><th>Status</th></tr>';
                
                // Sort nodes by position
                const sortedNodes = [...networkData].sort((a, b) => a.position - b.position);
                
                sortedNodes.forEach(node => {
                  let messageSources = 'None';
                  if (node.visibleMessages && Object.keys(node.visibleMessages).length > 0) {
                    messageSources = Object.keys(node.visibleMessages).join(', ');
                  }
                  
                  html += '<tr>' + 
                          '<td>' + node.nodeId + '</td>' + 
                          '<td>' + node.position + '</td>' + 
                          '<td>' + (node.dataUpdateCount || 0) + '</td>' + 
                          '<td>' + (node.visibleNodes || 0) + '</td>' + 
                          '<td>' + messageSources + '</td>' + 
                          '<td>' + node.status + '</td>' + 
                          '</tr>';
                });
                
                html += '</table>';
                statusContent.innerHTML = html;
                
              } catch (error) {
                console.error('Error fetching status:', error);
                document.getElementById('status-content').innerHTML = 
                  '<div style="color: red;">Error fetching network status. The monitor server might be down.</div>';
              }
            }
            
            function showNodeDetails(nodeId) {
              const nodeData = networkData.find(n => n.nodeId === nodeId);
              if (!nodeData) {
                alert('No data available for Node ' + nodeId);
                return;
              }
              
              let messageInfo = 'None';
              if (nodeData.visibleMessages && Object.keys(nodeData.visibleMessages).length > 0) {
                messageInfo = '';
                for (const [origin, count] of Object.entries(nodeData.visibleMessages)) {
                  messageInfo += 'From Node ' + origin + ': ' + count + ' messages\\n';
                }
              }
              
              alert('Node ' + nodeId + ' (Position ' + nodeData.position + ')\\n' +
                    'Status: ' + nodeData.status + '\\n' +
                    'Data Updates: ' + (nodeData.dataUpdateCount || 0) + '\\n' +
                    'Visible Nodes: ' + (nodeData.visibleNodes || 0) + '\\n\\n' +
                    'Visible Messages:\\n' + messageInfo);
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

  server.listen(monitorPort, () => {});

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
  // console.log(`Starting a chain network with ${NUM_NODES} nodes`);

  // Create the chain network
  const nodes = createChainNetwork();

  // Create a monitor server
  const monitorServer = createMonitorServer();

  // console.log("\nNetwork initialization complete");
  // console.log(`Started ${nodes.length} nodes in a linear chain`);
  // console.log(`Each node connects only to its immediate neighbors`);
  // console.log(
  //   `Nodes will update their data every ${DATA_UPDATE_INTERVAL / 1000} seconds`
  // );
  // console.log(`Log files are stored in the '${LOG_DIR}' directory`);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    // console.log("\nShutting down chain network...");

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
        `chain-node-${node.id}-worker.js`
      );
      if (fs.existsSync(scriptFile)) {
        fs.unlinkSync(scriptFile);
      }
    });

    // console.log("Shutdown complete");
    process.exit(0);
  });

  // console.log("\nPress Ctrl+C to stop the network");
}

// Run the main function
main();
