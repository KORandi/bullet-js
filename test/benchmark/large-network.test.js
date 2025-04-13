/**
 * Large Network Integration Test - Testing with 14 nodes
 * Each test is independent and can run on its own
 */

const { expect } = require("chai");
const { P2PServer } = require("../../src");
const {
  wait,
  cleanupServers,
  cleanupDatabases,
  createNetworkWithTopology,
  createTestNetwork,
} = require("../helpers/test-network");
const rimraf = require("rimraf");
const path = require("path");
const fs = require("fs");

// Helper functions for test setup
async function createAndStartNetwork(
  nodeCount,
  basePort,
  dbPathPrefix,
  options = {}
) {
  // Create servers with partial connectivity
  const servers = createTestNetwork(nodeCount, basePort, dbPathPrefix, options);

  // Start all servers
  for (let i = 0; i < servers.length; i++) {
    await servers[i].start();
    console.log(`Started server ${i + 1} on port ${basePort + i}`);
  }

  // Wait for connections to establish
  await wait(3000);

  return servers;
}

describe("Large P2P Network Tests", function () {
  // These tests can take time due to the large network
  this.timeout(30000);

  const NODE_COUNT = 14;
  const BASE_PORT = 4000;
  const DB_PATH_PREFIX = "./test/temp/large-network-db-";

  // Clean up databases before all tests start
  before(function () {
    if (fs.existsSync(path.dirname(DB_PATH_PREFIX))) {
      rimraf.sync(path.dirname(DB_PATH_PREFIX));
      console.log(`Cleaned up test databases before starting`);
    }
  });

  describe("Network Initialization", function () {
    let servers = [];

    // Clean up after the test
    afterEach(async function () {
      await cleanupServers(servers);
      servers = [];
    });

    it("should create and start all 14 nodes with partial connectivity", async function () {
      const options = {
        sync: {
          antiEntropyInterval: 5000, // Run anti-entropy every 5 seconds
          maxMessageAge: 60000, // Keep messages for 1 minute
          maxVersions: 5, // Keep 5 versions in history
          debugMode: false, // Disable verbose logging
        },
        conflict: {
          defaultStrategy: "last-write-wins",
          pathStrategies: {
            users: "merge-fields",
            config: "first-write-wins",
          },
        },
      };

      // Create and start the network
      servers = await createAndStartNetwork(
        NODE_COUNT,
        BASE_PORT,
        DB_PATH_PREFIX,
        options
      );

      // Verify all servers are running
      let runningCount = 0;
      for (const server of servers) {
        if (server && server.server && server.server.listening) {
          runningCount++;
        }
      }

      expect(runningCount).to.equal(NODE_COUNT);
    });
  });

  describe("Multi-hop Propagation", function () {
    let servers = [];

    // Set up a fresh network before this test
    beforeEach(async function () {
      const options = {
        sync: {
          antiEntropyInterval: 5000,
          maxMessageAge: 60000,
          maxVersions: 5,
        },
      };

      servers = await createAndStartNetwork(
        NODE_COUNT,
        BASE_PORT,
        `${DB_PATH_PREFIX}propagation-`,
        options
      );
    });

    // Clean up after the test
    afterEach(async function () {
      await cleanupServers(servers);
      servers = [];
    });

    it("should propagate data across the entire network despite partial connectivity", async function () {
      // First node writes data
      console.log(
        "Server 1 writing data that should propagate across all 14 nodes"
      );
      await servers[0].put("global/message", {
        content: "This should reach all nodes",
        timestamp: Date.now(),
      });

      // Wait for data to propagate (may take longer in a large network)
      console.log("Waiting for multi-hop propagation...");
      await wait(10000); // 10 seconds should be enough for ~14 nodes

      // Check all nodes received the data
      let receivedCount = 0;
      let missingNodes = [];

      for (let i = 0; i < servers.length; i++) {
        const data = await servers[i].get("global/message");
        if (data && data.content === "This should reach all nodes") {
          receivedCount++;
        } else {
          missingNodes.push(i + 1);
        }
      }

      console.log(
        `${receivedCount} out of ${NODE_COUNT} nodes received the data`
      );
      if (missingNodes.length > 0) {
        console.log(
          `Nodes that did not receive data: ${missingNodes.join(", ")}`
        );
      }

      expect(receivedCount).to.equal(NODE_COUNT);
    });
  });

  /**
   * Improved Network Partition Recovery Test
   *
   * This test creates a deliberate network partition with guaranteed isolation
   * to properly test recovery via anti-entropy.
   */
  describe("Edge Case: Network Partition", function () {
    let servers = [];

    // Clean up all servers after the test
    afterEach(async function () {
      console.log("Cleaning up all servers...");
      await cleanupServers(servers);
      servers = [];
    });
    it("should recover from network partition via anti-entropy", async function () {
      // Create a network with a dumbbell topology:
      // Group A (nodes 0-4) -- BRIDGE NODE (node 5) -- Group B (nodes 6-10)
      // All nodes in Group A connect to Bridge Node (5)
      // All nodes in Group B connect to Bridge Node (5)
      // This ensures that removing the bridge node creates a guaranteed partition

      const NODE_COUNT = 11; // 5 in Group A + 1 Bridge + 5 in Group B
      const BRIDGE_NODE_INDEX = 5;

      // Define connection topology manually (no random connections)
      const connections = [];

      // Group A: nodes 0-4 connect to neighbors and bridge
      for (let i = 0; i < BRIDGE_NODE_INDEX; i++) {
        const peers = [BRIDGE_NODE_INDEX]; // All connect to bridge

        // Also connect to neighbors within group for better realism
        if (i > 0) peers.push(i - 1);
        if (i < BRIDGE_NODE_INDEX - 1) peers.push(i + 1);

        connections.push(peers);
      }

      // Bridge node: connects to all nodes in both groups
      const bridgeConnections = [];
      for (let i = 0; i < NODE_COUNT; i++) {
        if (i !== BRIDGE_NODE_INDEX) {
          bridgeConnections.push(i);
        }
      }
      connections.push(bridgeConnections);

      // Group B: nodes 6-10 connect to neighbors and bridge
      for (let i = BRIDGE_NODE_INDEX + 1; i < NODE_COUNT; i++) {
        const peers = [BRIDGE_NODE_INDEX]; // All connect to bridge

        // Also connect to neighbors within group
        if (i > BRIDGE_NODE_INDEX + 1) peers.push(i - 1);
        if (i < NODE_COUNT - 1) peers.push(i + 1);

        connections.push(peers);
      }

      // Create servers with the controlled topology
      servers = [];
      for (let i = 0; i < NODE_COUNT; i++) {
        // Convert node indices to actual URLs for peers
        const peerUrls = connections[i].map(
          (idx) => `http://localhost:${BASE_PORT + idx}`
        );

        const server = new P2PServer({
          port: BASE_PORT + i,
          dbPath: `${DB_PATH_PREFIX}${i + 1}`,
          peers: peerUrls,
          sync: {
            antiEntropyInterval: 5000, // Every 5 seconds
          },
        });

        servers.push(server);
      }

      // Start all servers
      for (let i = 0; i < servers.length; i++) {
        await servers[i].start();
        console.log(`Started server ${i + 1} on port ${BASE_PORT + i}`);
      }

      // Wait for connections to establish
      await wait(3000);

      // Log the network topology for clarity
      console.log("Network topology:");
      for (let i = 0; i < NODE_COUNT; i++) {
        if (i === BRIDGE_NODE_INDEX) {
          console.log(`Node ${i + 1} (BRIDGE): connects to all other nodes`);
        } else if (i < BRIDGE_NODE_INDEX) {
          console.log(
            `Node ${i + 1} (Group A): connects to ${connections[i].map((x) => x + 1).join(", ")}`
          );
        } else {
          console.log(
            `Node ${i + 1} (Group B): connects to ${connections[i].map((x) => x + 1).join(", ")}`
          );
        }
      }

      // Initial verification: network is connected
      console.log("Verifying initial connectivity across all nodes...");

      // Write data from Group A
      await servers[0].put("connectivity/test", {
        message: "Initial connectivity test",
        timestamp: Date.now(),
      });

      // Wait for propagation
      await wait(2000);

      // Verify data reached Group B
      const initialConnectivity =
        await servers[NODE_COUNT - 1].get("connectivity/test");
      expect(initialConnectivity).to.not.be.null;
      console.log(
        "Initial connectivity confirmed: data flows across the network"
      );

      // Create network partition by shutting down bridge node
      console.log(
        `Creating network partition by shutting down bridge node ${BRIDGE_NODE_INDEX + 1}...`
      );
      await servers[BRIDGE_NODE_INDEX].close();
      servers[BRIDGE_NODE_INDEX] = null;

      // Wait for disconnection to take effect
      await wait(1000);

      // Write data on both sides of the partition
      console.log("Writing data on side A of the partition (node 1)");
      await servers[0].put("partition/side-a", {
        message: "From partition side A",
        timestamp: Date.now(),
      });

      console.log("Writing data on side B of the partition (node 10)");
      await servers[NODE_COUNT - 1].put("partition/side-b", {
        message: "From partition side B",
        timestamp: Date.now(),
      });

      // Wait for propagation within each segment
      await wait(2000);

      // Verify isolation: Check if data stayed within partitions
      // Choose nodes from each side that are NOT adjacent to the bridge
      const nodeInA = 2; // Node 3 in Group A (index 2)
      const nodeInB = 7; // Node 8 in Group B (index 7)

      const dataA_inA = await servers[nodeInA].get("partition/side-a");
      const dataA_inB = await servers[nodeInB].get("partition/side-a");
      const dataB_inA = await servers[nodeInA].get("partition/side-b");
      const dataB_inB = await servers[nodeInB].get("partition/side-b");

      // Data should be available only within its own partition
      expect(dataA_inA).to.not.be.null;
      expect(dataA_inB).to.be.null; // Should not cross partition
      expect(dataB_inA).to.be.null; // Should not cross partition
      expect(dataB_inB).to.not.be.null;

      console.log(
        "Partition verified: data is isolated to respective segments"
      );

      // Now heal the partition by restarting the bridge node
      console.log("Healing partition by restarting bridge node...");
      servers[BRIDGE_NODE_INDEX] = new P2PServer({
        port: BASE_PORT + BRIDGE_NODE_INDEX,
        dbPath: `${DB_PATH_PREFIX}${BRIDGE_NODE_INDEX + 1}`,
        peers: bridgeConnections.map(
          (idx) => `http://localhost:${BASE_PORT + idx}`
        ),
        sync: {
          antiEntropyInterval: 2000, // More frequent for faster healing
        },
      });

      await servers[BRIDGE_NODE_INDEX].start();
      console.log(`Restarted bridge node ${BRIDGE_NODE_INDEX + 1}`);

      // Give time for connections to re-establish
      await wait(3000);

      // Force run anti-entropy on all nodes to speed up healing
      console.log("Triggering anti-entropy on all nodes...");
      for (const server of servers) {
        if (server) {
          await server.runAntiEntropy();
        }
      }

      // Wait for multiple anti-entropy cycles
      console.log("Waiting for anti-entropy to heal the partition...");
      await wait(10000);

      // Force another round of anti-entropy
      for (const server of servers) {
        if (server) {
          await server.runAntiEntropy();
        }
      }

      await wait(3000);

      // Verify data has crossed the healed partition
      console.log(
        "Checking if data has propagated across the formerly partitioned network..."
      );

      const dataA_inB_afterHeal =
        await servers[nodeInB].get("partition/side-a");
      const dataB_inA_afterHeal =
        await servers[nodeInA].get("partition/side-b");

      console.log("After healing:");
      console.log(
        `- Node in Group B has data from side A: ${dataA_inB_afterHeal !== null}`
      );
      console.log(
        `- Node in Group A has data from side B: ${dataB_inA_afterHeal !== null}`
      );

      // Data should now be available on both sides after healing
      expect(dataA_inB_afterHeal).to.not.be.null;
      expect(dataB_inA_afterHeal).to.not.be.null;

      console.log(
        "Partition recovery test successful: anti-entropy restored data consistency"
      );

      // Test completed - Note: cleanup happens in afterEach hook
    });

    // After all tests in this suite
    after(async function () {
      // Clean up test databases
      await cleanupDatabases(DB_PATH_PREFIX);
      console.log("Test databases cleaned up");
    });
  });

  describe("Concurrent Updates", function () {
    let servers = [];
    const CONCURRENT_DB_PATH = `${DB_PATH_PREFIX}concurrent-`;

    // Set up a fresh network before this test
    beforeEach(async function () {
      // Clean up any existing database files first
      await cleanupDatabases(CONCURRENT_DB_PATH);
      console.log("Cleaned up existing test databases");

      const options = {
        sync: {
          antiEntropyInterval: 5000,
          maxMessageAge: 60000,
          maxVersions: 5,
        },
        conflict: {
          defaultStrategy: "merge-fields", // Important for this test
          pathStrategies: {
            users: "merge-fields",
          },
        },
      };

      servers = await createAndStartNetwork(
        NODE_COUNT,
        BASE_PORT,
        CONCURRENT_DB_PATH,
        options
      );
    });

    /**
     * Modified test to create a network where each node has 3-4 peers
     */
    it("should handle large number of concurrent updates with merge-fields strategy", async function () {
      // First, we need to close the existing servers and create a new network with desired topology
      await cleanupServers(servers);
      servers = [];

      // Create connection matrix where each node has 3-4 peers
      const NODE_COUNT = 14;
      const connections = [];

      for (let i = 0; i < NODE_COUNT; i++) {
        // Each node will connect to 3-4 peers
        const peers = new Set();

        // Try to get exactly 3-4 peers for each node
        while (peers.size < 3) {
          // Generate a random peer index that's not self
          let randomPeer;
          do {
            randomPeer = Math.floor(Math.random() * NODE_COUNT);
          } while (randomPeer === i || peers.has(randomPeer));

          peers.add(randomPeer);
        }

        // Add one more peer with 50% probability to get 3-4 peers
        if (Math.random() > 0.5) {
          let additionalPeer;
          do {
            additionalPeer = Math.floor(Math.random() * NODE_COUNT);
          } while (additionalPeer === i || peers.has(additionalPeer));

          if (additionalPeer !== undefined) {
            peers.add(additionalPeer);
          }
        }

        connections.push([...peers]);
      }

      // Create servers with new connection matrix
      servers = createNetworkWithTopology(
        NODE_COUNT,
        connections,
        DB_PATH_PREFIX,
        {
          sync: {
            antiEntropyInterval: 2000, // Run anti-entropy every 2 seconds
          },
          conflict: {
            defaultStrategy: "merge-fields",
            pathStrategies: {
              users: "merge-fields",
            },
          },
        }
      );

      // Start all servers
      for (let i = 0; i < servers.length; i++) {
        await servers[i].start();
        console.log(
          `Started server ${i + 1} with ${connections[i].length} outgoing peers`
        );
      }

      // Log the network topology
      console.log("\n=== Network Topology ===");
      for (let i = 0; i < NODE_COUNT; i++) {
        const peerList = connections[i]
          .map((peer) => `Node-${peer + 1}`)
          .join(", ");
        console.log(`Node-${i + 1} connects to: ${peerList}`);
      }

      // Wait for connections to establish
      console.log("\nWaiting for connections to establish...");
      await wait(3000);

      // Now run the actual test
      const USER_PATH = "users/concurrent-test-user";

      // Collect update promises
      const updatePromises = [];
      const activeServers = [];

      // First, explicitly set the conflict strategy on all servers
      for (let i = 0; i < servers.length; i++) {
        if (servers[i]) {
          // Apply globally to all user objects
          await servers[i].setConflictStrategy("users", "merge-fields");
          activeServers.push(i);
        }
      }

      // Create a base object on a central server first
      const centralServerIndex = Math.floor(servers.length / 2);
      await servers[centralServerIndex].put(USER_PATH, {
        name: "Concurrent Test User (base)",
        timestamp: Date.now() - 10000, // Use an older timestamp for the base object
      });

      // Wait for base object to propagate
      console.log(
        `Created base object on Node-${centralServerIndex + 1}, waiting for propagation...`
      );
      await wait(3000);

      // Have each node update a different field of the same user
      console.log("Preparing concurrent updates...");
      for (let i = 0; i < servers.length; i++) {
        if (servers[i]) {
          const fieldName = `field_from_node_${i + 1}`;
          const updatePromise = servers[i].put(USER_PATH, {
            name: `Concurrent Test User`,
            [fieldName]: `Value from node ${i + 1}`,
            timestamp: Date.now() + i * 10, // Ensure different timestamps with enough separation
          });
          updatePromises.push(updatePromise);
        }
      }

      const activeNodeCount = activeServers.length;
      console.log(`Running test with ${activeNodeCount} active nodes`);

      // Execute all updates as simultaneously as possible
      console.log(
        `Executing ${updatePromises.length} concurrent updates to the same user`
      );
      await Promise.all(updatePromises);

      // Wait for initial propagation
      console.log("Waiting for initial propagation...");
      await wait(5000);

      // Force anti-entropy several times to ensure full propagation
      console.log("Running anti-entropy cycles...");
      for (let cycle = 0; cycle < 5; cycle++) {
        console.log(`Anti-entropy cycle ${cycle + 1}...`);
        for (let i = 0; i < servers.length; i++) {
          if (servers[i]) {
            await servers[i].runAntiEntropy();
          }
        }
        await wait(1000); // Wait between cycles
      }

      // Final wait for propagation
      console.log("Final wait for propagation...");
      await wait(5000);

      // Check results on all nodes
      let maxFieldCount = 0;
      let bestNodeIndex = -1;
      const fieldCounts = [];

      for (let i = 0; i < servers.length; i++) {
        if (servers[i]) {
          const userData = await servers[i].get(USER_PATH);
          const nodeFieldCount = userData
            ? Object.keys(userData).filter((key) =>
                key.startsWith("field_from_node_")
              ).length
            : 0;

          fieldCounts.push({ node: i + 1, count: nodeFieldCount });

          if (nodeFieldCount > maxFieldCount) {
            maxFieldCount = nodeFieldCount;
            bestNodeIndex = i;
          }
        }
      }

      // Sort nodes by field count (descending)
      fieldCounts.sort((a, b) => b.count - a.count);

      console.log("\n=== Field Count By Node ===");
      for (const item of fieldCounts) {
        console.log(`Node-${item.node}: ${item.count} fields`);
      }

      // Get the merged user with the most fields
      const bestMergedUser = await servers[bestNodeIndex].get(USER_PATH);
      console.log(
        `\nBest merged user found on Node-${bestNodeIndex + 1} with ${maxFieldCount} fields:`
      );
      console.log(JSON.stringify(bestMergedUser, null, 2));

      // Log which fields are missing
      const missingFields = [];
      for (const i of activeServers) {
        const expectedField = `field_from_node_${i + 1}`;
        if (!bestMergedUser || !bestMergedUser[expectedField]) {
          missingFields.push(expectedField);
        }
      }

      if (missingFields.length > 0) {
        console.log(`Missing fields: ${missingFields.join(", ")}`);
      }

      console.log(
        `\nActive nodes: ${activeNodeCount}, Maximum fields merged: ${maxFieldCount}`
      );

      // Check how many nodes have at least 80% of the max fields
      const wellSyncedNodes = fieldCounts.filter(
        (item) => item.count >= maxFieldCount * 0.8
      ).length;
      console.log(
        `Nodes with at least 80% of max fields: ${wellSyncedNodes} of ${activeNodeCount}`
      );

      // Verify merge-fields strategy worked
      // We should get at least 80% of fields merged
      expect(maxFieldCount).to.be.at.least(Math.ceil(activeNodeCount * 0.8));

      // At least 70% of nodes should have good synchronization
      expect(wellSyncedNodes).to.be.at.least(Math.ceil(activeNodeCount * 0.7));
    });

    // Clean up after the test
    afterEach(async function () {
      console.log("Cleaning up servers and connections...");
      await cleanupServers(servers);
      servers = [];
    });

    // Clean up database files after all tests in this suite
    after(async function () {
      console.log("Final database cleanup...");
      await cleanupDatabases(CONCURRENT_DB_PATH);
    });
  });

  describe("Node Churn", function () {
    let servers = [];

    // Set up a fresh network before this test
    beforeEach(async function () {
      const options = {
        sync: {
          antiEntropyInterval: 5000,
          maxMessageAge: 60000,
          maxVersions: 5,
        },
      };

      servers = await createAndStartNetwork(
        NODE_COUNT,
        BASE_PORT,
        `${DB_PATH_PREFIX}churn-`,
        options
      );
    });

    // Clean up after the test
    afterEach(async function () {
      await cleanupServers(servers);
      servers = [];
    });

    it("should handle rapid joining and leaving of nodes while maintaining data consistency", async function () {
      // Create a new data item that we'll use to test consistency
      await servers[0].put("churn/test", {
        value: "original",
        timestamp: Date.now(),
      });

      // Let it propagate briefly
      await wait(2000);

      // Start a series of node churns (leaving and joining)
      console.log("Starting node churn test (rapid joining/leaving)");

      for (let round = 0; round < 3; round++) {
        console.log(`Round ${round + 1}: Shutting down nodes...`);

        // Shut down 3 random nodes that are not already down
        const nodesToShutdown = [];
        while (nodesToShutdown.length < 3) {
          const nodeIdx = Math.floor(Math.random() * NODE_COUNT);
          if (servers[nodeIdx] && !nodesToShutdown.includes(nodeIdx)) {
            nodesToShutdown.push(nodeIdx);
          }
        }

        for (const nodeIdx of nodesToShutdown) {
          console.log(`- Shutting down node ${nodeIdx + 1}`);
          await servers[nodeIdx].close();
          servers[nodeIdx] = null;
        }

        // Make an update to the test data from a running node
        let updaterNodeIdx;
        do {
          updaterNodeIdx = Math.floor(Math.random() * NODE_COUNT);
        } while (servers[updaterNodeIdx] === null);

        console.log(`Updating data from node ${updaterNodeIdx + 1}`);
        await servers[updaterNodeIdx].put("churn/test", {
          value: `updated-round-${round + 1}`,
          timestamp: Date.now(),
        });

        // Wait a bit for propagation
        await wait(1000);

        // Restart the shutdown nodes
        console.log("Restarting nodes...");
        for (const nodeIdx of nodesToShutdown) {
          servers[nodeIdx] = createTestNetwork(
            1,
            BASE_PORT + nodeIdx,
            `${DB_PATH_PREFIX}churn-${nodeIdx + 1}`,
            {
              sync: { antiEntropyInterval: 2000 },
            }
          )[0];

          await servers[nodeIdx].start();
          console.log(`- Restarted node ${nodeIdx + 1}`);
        }

        // Wait for anti-entropy to run
        await wait(3000);
      }

      // Force final anti-entropy on all nodes
      for (const server of servers) {
        if (server) {
          await server.runAntiEntropy();
        }
      }

      // Wait for final synchronization
      await wait(5000);

      // Check data consistency across all nodes
      let valueMap = new Map();
      let consistentCount = 0;
      const expectedFinalValue = "updated-round-3";

      for (let i = 0; i < servers.length; i++) {
        if (servers[i]) {
          const data = await servers[i].get("churn/test");
          if (data) {
            const value = data.value;
            valueMap.set(value, (valueMap.get(value) || 0) + 1);

            if (value === expectedFinalValue) {
              consistentCount++;
            }
          }
        }
      }

      const activeNodeCount = servers.filter((s) => s !== null).length;

      console.log(
        `Data consistency check: ${consistentCount} of ${activeNodeCount} nodes have the expected value`
      );
      console.log("Value distribution:", Object.fromEntries(valueMap));

      // All nodes should eventually converge to the same value
      expect(consistentCount).to.equal(activeNodeCount);
    });
  });
});
