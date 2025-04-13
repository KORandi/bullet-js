/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Debug script to test the P2P Server synchronization across 14 nodes
 * with log output saved to a file
 */

const P2PServer = require("./src/server");
const fs = require("fs");
const rimraf = require("rimraf");

// Number of nodes to create
const NODE_COUNT = 14;
const BASE_PORT = 3001;
const LOG_FILE = "p2p-debug-log.txt";

// Setup logging
class Logger {
  constructor(filename) {
    this.filename = filename;
    // Clear the log file at the start
    fs.writeFileSync(this.filename, "");

    // Capture console.log, console.error, and console.warn
    this.originalLog = console.log;
    this.originalError = console.error;
    this.originalWarn = console.warn;

    console.log = (...args) => {
      this.originalLog(...args);
      this.appendToLog("LOG", ...args);
    };

    console.error = (...args) => {
      this.originalError(...args);
      this.appendToLog("ERROR", ...args);
    };

    console.warn = (...args) => {
      this.originalWarn(...args);
      this.appendToLog("WARN", ...args);
    };
  }

  appendToLog(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = args
      .map((arg) => {
        if (typeof arg === "object") {
          return JSON.stringify(arg);
        }
        return String(arg);
      })
      .join(" ");

    fs.appendFileSync(this.filename, `[${timestamp}] [${level}] ${message}\n`);
  }

  restore() {
    console.log = this.originalLog;
    console.error = this.originalError;
    console.warn = this.originalWarn;
  }
}

// Initialize logger
const logger = new Logger(LOG_FILE);
console.log(`Logging output to ${LOG_FILE}`);

// Clear existing databases before starting
const clearDbs = () => {
  for (let i = 1; i <= NODE_COUNT; i++) {
    const dbPath = `./db-server${i}`;
    if (fs.existsSync(dbPath)) {
      rimraf.sync(dbPath);
      console.log(`Cleared database: ${dbPath}`);
    }
  }
};

// Helper to create a URL for a node
const getNodeUrl = (nodeIndex) =>
  `http://localhost:${BASE_PORT + nodeIndex - 1}`;

// Main test function
async function runTest() {
  console.log("=== Clearing databases ===");
  clearDbs();

  console.log(`\n=== Starting ${NODE_COUNT} P2P Server Nodes ===`);

  // Create servers with a complex connection topology
  // Each node connects to a subset of the previous nodes
  const servers = [];

  for (let i = 1; i <= NODE_COUNT; i++) {
    const port = BASE_PORT + i - 1;
    const dbPath = `./db-server${i}`;

    // Create peer list: connect to a selection of previous nodes
    const peers = [];

    if (i > 1) {
      // Connect to the first node (hub and spoke)
      peers.push(getNodeUrl(1));

      // Connect to some additional nodes based on a pattern
      // This creates a more realistic network topology
      for (let j = 2; j < i; j++) {
        // Connect to nodes that are prime numbers or divisible by 3
        if (isPrime(j) || j % 3 === 0) {
          peers.push(getNodeUrl(j));
        }
      }
    }

    // Create the server
    const server = new P2PServer({
      port,
      dbPath,
      peers,
    });

    servers.push(server);
    server.start();
    console.log(
      `Started server ${i} on port ${port} with peers: ${
        peers.join(", ") || "none"
      }`
    );
  }

  // Helper to get a human-readable node name
  const getNodeName = (index) => `Node-${index + 1}`;

  // Wait for connections to be established
  console.log("\n=== Waiting for peer connections to establish ===");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  try {
    // Debug: Check peer connections
    console.log("\n=== Debug: Checking Peer Connections ===");
    servers.forEach((server, i) => {
      console.log(
        `${getNodeName(i)} connected to ${
          Object.keys(server.socketManager.sockets).length
        } peers`
      );
    });

    // Test 1: First node writes data, all others read it
    console.log("\n=== Test 1: First node writes, all others read ===");
    await servers[0].put("global/config", {
      appName: "P2P Test",
      version: "1.0.0",
    });
    console.log(`${getNodeName(0)} wrote global/config`);

    // Wait for data to sync
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // All nodes read the data
    let test1Pass = true;
    for (let i = 1; i < servers.length; i++) {
      const data = await servers[i].get("global/config");
      const result = data && data.appName === "P2P Test";
      console.log(
        `${getNodeName(i)} read global/config:`,
        result ? "✅" : "❌",
        data || "null"
      );
      if (!result) test1Pass = false;
    }
    console.log(`Test 1 Overall Result: ${test1Pass ? "PASS ✅" : "FAIL ❌"}`);

    // Test 2: Last node writes data, random nodes read it
    console.log("\n=== Test 2: Last node writes, random nodes read ===");
    await servers[NODE_COUNT - 1].put("products/master", {
      items: ["Laptop", "Phone", "Tablet"],
      updated: Date.now(),
    });
    console.log(`${getNodeName(NODE_COUNT - 1)} wrote products/master`);

    // Wait for data to sync
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Random nodes read the data
    let test2Pass = true;
    const sampleNodes = [
      0,
      Math.floor(NODE_COUNT / 3),
      Math.floor(NODE_COUNT / 2),
      NODE_COUNT - 2,
    ];
    for (const i of sampleNodes) {
      const data = await servers[i].get("products/master");
      const result =
        data && Array.isArray(data.items) && data.items.length === 3;
      console.log(
        `${getNodeName(i)} read products/master:`,
        result ? "✅" : "❌",
        data ? `(${data.items.length} items)` : "null"
      );
      if (!result) test2Pass = false;
    }
    console.log(`Test 2 Overall Result: ${test2Pass ? "PASS ✅" : "FAIL ❌"}`);

    // Test 3: Middle node updates data, check propagation to both ends
    console.log(
      "\n=== Test 3: Middle node updates, check propagation to both ends ==="
    );
    const middleIndex = Math.floor(NODE_COUNT / 2);
    await servers[middleIndex].put("products/master", {
      items: ["Laptop", "Phone", "Tablet", "Watch", "Headphones"],
      updated: Date.now(),
      modifiedBy: `Node-${middleIndex + 1}`,
    });
    console.log(`${getNodeName(middleIndex)} updated products/master`);

    // Wait for data to sync
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // First and last nodes read the updated data
    const firstNodeData = await servers[0].get("products/master");
    const lastNodeData = await servers[NODE_COUNT - 1].get("products/master");

    const firstResult =
      firstNodeData &&
      Array.isArray(firstNodeData.items) &&
      firstNodeData.items.length === 5;
    const lastResult =
      lastNodeData &&
      Array.isArray(lastNodeData.items) &&
      lastNodeData.items.length === 5;

    console.log(
      `${getNodeName(0)} read updated products/master:`,
      firstResult ? "✅" : "❌",
      firstNodeData ? `(${firstNodeData.items.length} items)` : "null"
    );
    console.log(
      `${getNodeName(NODE_COUNT - 1)} read updated products/master:`,
      lastResult ? "✅" : "❌",
      lastNodeData ? `(${lastNodeData.items.length} items)` : "null"
    );

    console.log(
      `Test 3 Overall Result: ${
        firstResult && lastResult ? "PASS ✅" : "FAIL ❌"
      }`
    );

    // Test 4: Multiple nodes write simultaneously, check data consistency
    console.log(
      "\n=== Test 4: Multiple nodes write simultaneously, check data consistency ==="
    );

    // Several nodes write to different paths simultaneously
    const writePromises = [];
    for (let i = 0; i < NODE_COUNT; i += 3) {
      const promise = servers[i].put(`users/user${i}`, {
        name: `User ${i}`,
        nodeId: i,
        timestamp: Date.now(),
      });
      writePromises.push(promise);
    }

    await Promise.all(writePromises);
    console.log("Multiple nodes wrote user data simultaneously");

    // Wait for data to sync
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check data consistency across all nodes
    let test4Pass = true;

    // For each piece of data that was written
    for (let dataIndex = 0; dataIndex < NODE_COUNT; dataIndex += 3) {
      const path = `users/user${dataIndex}`;
      const expectedName = `User ${dataIndex}`;

      // Check a sample of nodes
      const sampleNodes = [
        0,
        Math.floor(NODE_COUNT / 4),
        Math.floor(NODE_COUNT / 2),
        NODE_COUNT - 1,
      ];

      for (const nodeIndex of sampleNodes) {
        const data = await servers[nodeIndex].get(path);
        const result = data && data.name === expectedName;

        if (!result) {
          console.log(
            `${getNodeName(nodeIndex)} read ${path}:`,
            result ? "✅" : "❌",
            data || "null"
          );
          test4Pass = false;
        }
      }
    }

    console.log(`Test 4 Overall Result: ${test4Pass ? "PASS ✅" : "FAIL ❌"}`);

    // Test 5: Subscription across multiple nodes
    console.log("\n=== Test 5: Subscription across multiple nodes ===");

    const notificationResults = new Array(NODE_COUNT).fill(false);
    const unsubscribeFunctions = [];

    // Have each node subscribe to changes in 'notification/broadcast'
    for (let i = 0; i < NODE_COUNT; i++) {
      const unsubscribe = await servers[i].subscribe(
        "notification",
        (value, path) => {
          console.log(
            `${getNodeName(i)} received notification for ${path}:`,
            value
          );
          notificationResults[i] = true;
        }
      );
      unsubscribeFunctions.push(unsubscribe);
    }

    console.log("All nodes subscribed to notification topic");

    // Middle node broadcasts a notification
    await servers[middleIndex].put("notification/broadcast", {
      message: "Important system notification",
      priority: "high",
      timestamp: Date.now(),
    });

    console.log(`${getNodeName(middleIndex)} broadcast a notification`);

    // Wait for notifications to propagate
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Unsubscribe all nodes
    unsubscribeFunctions.forEach((unsubscribe, i) => {
      unsubscribe();
      console.log(`${getNodeName(i)} unsubscribed from notification topic`);
    });

    // Count how many nodes received the notification
    const notifiedCount = notificationResults.filter(Boolean).length;
    console.log(
      `${notifiedCount} out of ${NODE_COUNT} nodes received the notification`
    );
    console.log(
      `Test 5 Overall Result: ${
        notifiedCount === NODE_COUNT ? "PASS ✅" : "FAIL ❌"
      }`
    );

    // Test 6: Network scan
    console.log("\n=== Test 6: Network-wide scanning ===");

    // Write some additional scan data to random nodes
    for (let i = 0; i < NODE_COUNT; i += 2) {
      await servers[i].put(`scan/item${i}`, {
        nodeId: i,
        value: `Value from ${getNodeName(i)}`,
      });
    }

    console.log("Multiple nodes wrote scan data");

    // Wait for data to sync
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Random node performs a scan
    const scanNodeIndex = Math.floor(Math.random() * NODE_COUNT);
    const scanResults = await servers[scanNodeIndex].scan("scan/");

    console.log(
      `${getNodeName(scanNodeIndex)} performed scan and found ${
        scanResults.length
      } items`
    );

    // At least half the expected items should be found
    const expectedItems = Math.ceil(NODE_COUNT / 2);
    console.log(
      `Test 6 Overall Result: ${
        scanResults.length >= expectedItems ? "PASS ✅" : "FAIL ❌"
      }`
    );

    // Summary of all tests
    console.log("\n=== Test Summary ===");
    console.log(`Test 1 (Global Config): ${test1Pass ? "PASS ✅" : "FAIL ❌"}`);
    console.log(
      `Test 2 (Last Node Write): ${test2Pass ? "PASS ✅" : "FAIL ❌"}`
    );
    console.log(
      `Test 3 (Middle Node Update): ${
        firstResult && lastResult ? "PASS ✅" : "FAIL ❌"
      }`
    );
    console.log(
      `Test 4 (Multiple Simultaneous Writes): ${
        test4Pass ? "PASS ✅" : "FAIL ❌"
      }`
    );
    console.log(
      `Test 5 (Subscription Broadcast): ${
        notifiedCount === NODE_COUNT ? "PASS ✅" : "FAIL ❌"
      }`
    );
    console.log(
      `Test 6 (Network Scan): ${
        scanResults.length >= expectedItems ? "PASS ✅" : "FAIL ❌"
      }`
    );

    // Clean up and exit
    console.log("\n=== Cleaning up ===");
    await Promise.all(servers.map((server) => server.close()));

    console.log("All tests completed");
    console.log(`Full test log saved to ${LOG_FILE}`);
  } catch (error) {
    console.error("Test error:", error);
  } finally {
    // Restore original console functions
    logger.restore();
  }
}

// Helper function to check if a number is prime
function isPrime(num) {
  if (num <= 1) return false;
  if (num <= 3) return true;
  if (num % 2 === 0 || num % 3 === 0) return false;

  let i = 5;
  while (i * i <= num) {
    if (num % i === 0 || num % (i + 2) === 0) return false;
    i += 6;
  }
  return true;
}

// Run the test
runTest();
