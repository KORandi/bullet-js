/**
 * Complex Network Example - Testing with a larger network topology
 * This example demonstrates how data propagates across a network of 7 nodes
 * with a realistic partially-connected topology
 */

const { createTestNetwork } = require("../src");
const fs = require("fs");
const path = require("path");
const rimraf = require("rimraf");

// Base configuration
const NODE_COUNT = 7;
const BASE_PORT = 3001;
const DB_PATH_PREFIX = "./db-complex-";

// Clear any existing databases
function clearDatabases() {
  for (let i = 1; i <= NODE_COUNT; i++) {
    const dbPath = `${DB_PATH_PREFIX}${i}`;
    if (fs.existsSync(dbPath)) {
      rimraf.sync(dbPath);
      console.log(`Cleared database: ${dbPath}`);
    }
  }
}

// Helper to wait
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to get a node name
const getNodeName = (index) => `Node-${index + 1}`;

async function runExample() {
  console.log("Starting P2P Server Complex Network Example");
  console.log(`Creating a network with ${NODE_COUNT} nodes`);

  clearDatabases();

  try {
    // Create servers with complex connection topology
    // We'll use the helper to create a test network
    const servers = createTestNetwork(NODE_COUNT, BASE_PORT, DB_PATH_PREFIX, {
      // Configure conflict resolution
      conflict: {
        defaultStrategy: "last-write-wins",
        pathStrategies: {
          users: "merge-fields",
          settings: "first-write-wins",
        },
      },
      // Configure sync behavior
      sync: {
        antiEntropyInterval: 5000, // Run anti-entropy every 5 seconds
        maxVersions: 5,
      },
    });

    // Start all servers
    console.log("Starting all servers...");
    for (const server of servers) {
      await server.start();
    }
    console.log("All servers started successfully");

    // Display the network topology
    console.log("\n=== Network Topology ===");
    servers.forEach((server, i) => {
      const peers = server.peers.map((url) => {
        const port = parseInt(url.split(":")[2]);
        return `Node-${port - BASE_PORT + 1}`;
      });
      console.log(
        `${getNodeName(i)} connects to: ${peers.join(", ") || "none"}`
      );
    });

    // Wait for connections to establish
    console.log("\nWaiting for connections to establish...");
    await wait(3000);

    // Test 1: Multi-hop Propagation
    console.log("\n=== Test 1: Multi-hop Propagation ===");
    console.log(
      "Testing if data can propagate across multiple hops in the network"
    );

    // First node (Node-1) writes data
    console.log(`${getNodeName(0)} writes global/config`);
    await servers[0].put("global/config", {
      appName: "P2P Network Test",
      version: "1.0.0",
      timestamp: Date.now(),
    });

    // Wait for data to propagate
    console.log("Waiting for data to propagate through the network...");
    await wait(3000);

    // Check if all nodes received the data
    let allNodesHaveData = true;
    for (let i = 0; i < servers.length; i++) {
      const data = await servers[i].get("global/config");
      const status = data ? "✅ received" : "❌ missing";
      console.log(`${getNodeName(i)}: ${status}`);

      if (!data) {
        allNodesHaveData = false;
      }
    }

    console.log(`Test 1 Result: ${allNodesHaveData ? "PASSED" : "FAILED"}`);

    // Test 2: Parallel Updates
    console.log("\n=== Test 2: Parallel Updates ===");
    console.log(
      "Testing multiple nodes updating different data simultaneously"
    );

    // Several nodes write to different paths simultaneously
    const writePromises = [];
    for (let i = 0; i < servers.length; i++) {
      const promise = servers[i].put(`nodes/node${i + 1}`, {
        name: `Node ${i + 1}`,
        status: "active",
        lastUpdate: Date.now(),
      });
      writePromises.push(promise);
    }

    await Promise.all(writePromises);
    console.log("All nodes wrote their status information");

    // Wait for data to propagate
    console.log("Waiting for data to propagate...");
    await wait(3000);

    // Check if last node has all data
    console.log("Checking if last node received all updates:");
    let lastNodeHasAllData = true;

    for (let i = 0; i < servers.length; i++) {
      const data = await servers[servers.length - 1].get(`nodes/node${i + 1}`);
      const status = data ? "✅ received" : "❌ missing";
      console.log(`Data from ${getNodeName(i)}: ${status}`);

      if (!data) {
        lastNodeHasAllData = false;
      }
    }

    console.log(`Test 2 Result: ${lastNodeHasAllData ? "PASSED" : "FAILED"}`);

    // Test 3: Partition Tolerance
    console.log("\n=== Test 3: Partition Tolerance ===");
    console.log("Testing data sync after network partition heals");

    // Create a "partition" by removing a central node (Node-3)
    console.log(`Simulating partition by shutting down ${getNodeName(2)}`);
    await servers[2].close();
    servers[2] = null; // Clear reference

    // Create data on one side of the partition
    console.log(`${getNodeName(0)} creating data after partition`);
    await servers[0].put("partition/test", {
      message: "Created during partition",
      timestamp: Date.now(),
    });

    // Wait for attempt at propagation
    await wait(2000);

    // Check if nodes on the other side got the data
    const farNode = servers[servers.length - 1];
    const dataBeforeHeal = await farNode.get("partition/test");
    console.log(
      `${getNodeName(servers.length - 1)} has partition data before healing: ${
        dataBeforeHeal ? "YES" : "NO"
      }`
    );

    // Run anti-entropy on remaining nodes to simulate healing
    console.log("Running anti-entropy to simulate partition healing...");
    const syncPromises = [];
    for (let i = 0; i < servers.length; i++) {
      if (servers[i]) {
        syncPromises.push(servers[i].runAntiEntropy());
      }
    }
    await Promise.all(syncPromises);

    // Wait for sync to complete
    await wait(5000);

    // Check if nodes on the other side got the data after healing
    const dataAfterHeal = await farNode.get("partition/test");
    console.log(
      `${getNodeName(servers.length - 1)} has partition data after healing: ${
        dataAfterHeal ? "YES" : "NO"
      }`
    );

    console.log(`Test 3 Result: ${dataAfterHeal ? "PASSED" : "FAILED"}`);

    // Test 4: Subscription and Notification
    console.log("\n=== Test 4: Subscription and Notification ===");

    let notificationReceived = false;

    // Middle node subscribes to changes
    const notificationNode = Math.floor(servers.length / 2);
    if (servers[notificationNode]) {
      console.log(
        `${getNodeName(notificationNode)} subscribing to notifications`
      );

      const unsubscribe = await servers[notificationNode].subscribe(
        "notifications",
        (value, path) => {
          console.log(
            `${getNodeName(
              notificationNode
            )} received notification for ${path}:`,
            value
          );
          notificationReceived = true;
        }
      );

      // Last node sends a notification
      console.log(`${getNodeName(servers.length - 1)} sending notification`);
      await servers[servers.length - 1].put("notifications/alert", {
        title: "Network Test",
        message: "This is a test notification",
        timestamp: Date.now(),
      });

      // Wait for notification to propagate
      console.log("Waiting for notification to propagate...");
      await wait(3000);

      // Check if notification was received
      console.log(
        `Notification received: ${notificationReceived ? "YES" : "NO"}`
      );

      // Unsubscribe
      unsubscribe();
      console.log(
        `${getNodeName(notificationNode)} unsubscribed from notifications`
      );
    }

    console.log(`Test 4 Result: ${notificationReceived ? "PASSED" : "FAILED"}`);

    // Clean up and exit
    console.log("\n=== Cleaning up ===");
    const closePromises = [];
    for (let i = 0; i < servers.length; i++) {
      if (servers[i]) {
        closePromises.push(servers[i].close());
      }
    }
    await Promise.all(closePromises);
    console.log("All servers closed");

    // Overall results
    console.log("\n=== Overall Results ===");
    console.log(
      `Test 1 (Multi-hop Propagation): ${
        allNodesHaveData ? "PASSED" : "FAILED"
      }`
    );
    console.log(
      `Test 2 (Parallel Updates): ${lastNodeHasAllData ? "PASSED" : "FAILED"}`
    );
    console.log(
      `Test 3 (Partition Tolerance): ${dataAfterHeal ? "PASSED" : "FAILED"}`
    );
    console.log(
      `Test 4 (Subscription): ${notificationReceived ? "PASSED" : "FAILED"}`
    );
  } catch (error) {
    console.error("Error in example:", error);
  }
}

// Run the example
runExample();
