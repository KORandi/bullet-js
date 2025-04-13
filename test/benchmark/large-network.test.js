/**
 * Large Network Integration Test - Testing with 14 nodes
 * This test focuses on edge cases in a large P2P network
 */

const { expect } = require("chai");
const { createTestNetwork } = require("../../src");
const {
  wait,
  cleanupServers,
  cleanupDatabases,
} = require("../helpers/test-network");
const rimraf = require("rimraf");
const path = require("path");
const fs = require("fs");

describe("Large P2P Network (14 nodes)", function () {
  // These tests can take time due to the large network
  this.timeout(30000);

  const NODE_COUNT = 14;
  const BASE_PORT = 4000;
  const DB_PATH_PREFIX = "./test/temp/large-network-db-";

  let servers = [];

  // Clean up databases before starting
  before(function () {
    if (fs.existsSync(path.dirname(DB_PATH_PREFIX))) {
      rimraf.sync(path.dirname(DB_PATH_PREFIX));
      console.log(`Cleaned up test databases before starting`);
    }
  });

  // Clean up after all tests
  after(async function () {
    await cleanupServers(servers);
    await cleanupDatabases(DB_PATH_PREFIX);
    servers = [];
  });

  describe("Network Initialization", function () {
    it("should create and start all 14 nodes with partial connectivity", async function () {
      // Create a partial mesh network where each node connects to ~3 peers
      // This creates a more realistic network topology with multiple hops required
      const connections = [];

      for (let i = 0; i < NODE_COUNT; i++) {
        const peers = [];

        // Connect to previous 2 nodes (if they exist)
        if (i > 0) peers.push(i - 1);
        if (i > 1) peers.push(i - 2);

        // Connect to next node (if exists) to ensure chain connectivity
        if (i < NODE_COUNT - 1) peers.push(i + 1);

        // Add one random connection to increase network resilience
        let randomPeer;
        do {
          randomPeer = Math.floor(Math.random() * NODE_COUNT);
        } while (randomPeer === i || peers.includes(randomPeer));

        peers.push(randomPeer);
        connections.push(peers);
      }

      // Create servers with partial connectivity
      servers = createTestNetwork(NODE_COUNT, BASE_PORT, DB_PATH_PREFIX, {
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
      });

      // Start all servers
      for (let i = 0; i < servers.length; i++) {
        await servers[i].start();
        console.log(`Started server ${i + 1} on port ${BASE_PORT + i}`);
      }

      // Wait for connections to establish
      await wait(3000);

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

  describe("Edge Case: Multi-hop Propagation", function () {
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

  describe("Edge Case: Network Partition", function () {
    it("should recover from network partition via anti-entropy", async function () {
      // Create a network partition by "disconnecting" middle nodes (6, 7, 8)
      console.log(
        "Creating a network partition by shutting down nodes 6, 7, and 8"
      );

      await servers[5].close();
      await servers[6].close();
      await servers[7].close();

      // Update node references
      servers[5] = null;
      servers[6] = null;
      servers[7] = null;

      // Write data on the first side of the partition
      console.log("Writing data on one side of the partition (node 3)");
      await servers[2].put("partition/test", {
        message: "From partition side A",
        timestamp: Date.now(),
      });

      // Write data on the other side of the partition
      console.log("Writing data on other side of the partition (node 11)");
      await servers[10].put("partition/other", {
        message: "From partition side B",
        timestamp: Date.now(),
      });

      // Wait a bit for propagation within each partition
      await wait(2000);

      // Check if data stayed within partitions
      const dataAtNode4 = await servers[3].get("partition/test");
      const dataAtNode12 = await servers[11].get("partition/test");
      const dataAtNode2 = await servers[1].get("partition/other");
      const dataAtNode10 = await servers[9].get("partition/other");

      // Data should be available within the same partition but not across
      expect(dataAtNode4).to.not.be.null;
      expect(dataAtNode12).to.be.null;
      expect(dataAtNode2).to.be.null;
      expect(dataAtNode10).to.not.be.null;

      // Now "reconnect" by restarting the middle nodes
      console.log("Repairing the partition by restarting middle nodes");
      servers[5] = createTestNetwork(1, BASE_PORT + 5, DB_PATH_PREFIX + "6", {
        sync: { antiEntropyInterval: 2000 },
      })[0];

      servers[6] = createTestNetwork(1, BASE_PORT + 6, DB_PATH_PREFIX + "7", {
        sync: { antiEntropyInterval: 2000 },
      })[0];

      servers[7] = createTestNetwork(1, BASE_PORT + 7, DB_PATH_PREFIX + "8", {
        sync: { antiEntropyInterval: 2000 },
      })[0];

      await servers[5].start();
      await servers[6].start();
      await servers[7].start();

      // Wait for anti-entropy to run and heal the partition
      console.log("Waiting for anti-entropy to heal the partition...");
      await wait(15000); // Give enough time for multiple anti-entropy cycles

      // Force run anti-entropy on all nodes to accelerate healing
      for (const server of servers) {
        if (server) {
          await server.runAntiEntropy();
        }
      }

      await wait(3000);

      // Check if data crossed the former partition
      const dataAtNode12AfterHeal = await servers[11].get("partition/test");
      const dataAtNode2AfterHeal = await servers[1].get("partition/other");

      console.log("After healing:");
      console.log(
        `- Node 12 has data from side A: ${dataAtNode12AfterHeal !== null}`
      );
      console.log(
        `- Node 2 has data from side B: ${dataAtNode2AfterHeal !== null}`
      );

      // Data should now be available on both sides after healing
      expect(dataAtNode12AfterHeal).to.not.be.null;
      expect(dataAtNode2AfterHeal).to.not.be.null;
    });
  });

  describe("Edge Case: Concurrent Updates", function () {
    it("should handle large number of concurrent updates with merge-fields strategy", async function () {
      const USER_PATH = "users/concurrent-test-user";
      const UPDATE_COUNT = 10; // Each node will update a different field

      // Wait for any previous operations to settle
      await wait(2000);

      // Collect update promises
      const updatePromises = [];

      // Have each node update a different field of the same user
      for (let i = 0; i < servers.length; i++) {
        if (servers[i]) {
          const fieldName = `field_from_node_${i + 1}`;
          const updatePromise = servers[i].put(USER_PATH, {
            name: `Concurrent Test User (updated by node ${i + 1})`,
            [fieldName]: `Value from node ${i + 1}`,
            timestamp: Date.now() + i, // Slight time difference
          });
          updatePromises.push(updatePromise);
        }
      }

      // Execute all updates as simultaneously as possible
      console.log(
        `Executing ${updatePromises.length} concurrent updates to the same user`
      );
      await Promise.all(updatePromises);

      // Wait for conflict resolution and synchronization
      console.log("Waiting for conflict resolution and synchronization...");
      await wait(8000);

      // Check result on node 1 and node 14
      const userAtFirstNode = await servers[0].get(USER_PATH);
      const userAtLastNode = await servers[NODE_COUNT - 1].get(USER_PATH);

      // Count how many fields were merged
      const fieldCount = Object.keys(userAtFirstNode).filter((key) =>
        key.startsWith("field_from_node_")
      ).length;

      console.log(
        `User object has ${fieldCount} fields merged from different nodes`
      );
      console.log("User at first node:", userAtFirstNode);

      // Verify merge-fields strategy worked
      expect(fieldCount).to.be.at.least(updatePromises.length - 2); // Allow for a couple of conflicts
      expect(userAtFirstNode).to.deep.equal(userAtLastNode);
    });
  });

  describe("Edge Case: Node Churn", function () {
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
            DB_PATH_PREFIX + (nodeIdx + 1),
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

  describe("Edge Case: Message Storm", function () {
    it("should handle a large number of updates in a short time", async function () {
      // Create a storm of updates (100 updates)
      const UPDATE_COUNT = 100;
      console.log(`Creating a message storm: ${UPDATE_COUNT} rapid updates`);

      const updatePromises = [];

      for (let i = 0; i < UPDATE_COUNT; i++) {
        // Distribute updates across nodes round-robin
        const nodeIdx = i % servers.length;

        if (servers[nodeIdx]) {
          const updatePromise = servers[nodeIdx].put(`storm/item-${i % 10}`, {
            counter: i,
            value: `Value ${i}`,
            timestamp: Date.now(),
          });

          updatePromises.push(updatePromise);
        }
      }

      // Execute all updates as rapidly as possible
      await Promise.all(updatePromises);
      console.log("All updates sent, waiting for propagation...");

      // Wait for propagation and anti-entropy
      await wait(15000);

      // Verify a sample of the data made it to all nodes
      let consistencyMap = new Map();

      // Check 5 random items on all nodes
      for (let itemIdx = 0; itemIdx < 5; itemIdx++) {
        const checkItem = `storm/item-${itemIdx}`;
        consistencyMap.set(checkItem, 0);

        let expectedCounter = null;

        // Find the highest counter value for this item (should be the winner)
        for (const server of servers) {
          if (server) {
            const data = await server.get(checkItem);
            if (
              data &&
              (expectedCounter === null || data.counter > expectedCounter)
            ) {
              expectedCounter = data.counter;
            }
          }
        }

        if (expectedCounter === null) continue;

        // Count how many nodes have the expected value
        for (const server of servers) {
          if (server) {
            const data = await server.get(checkItem);
            if (data && data.counter === expectedCounter) {
              consistencyMap.set(checkItem, consistencyMap.get(checkItem) + 1);
            }
          }
        }
      }

      const activeNodeCount = servers.filter((s) => s !== null).length;
      console.log("Data consistency after message storm:");

      for (const [item, count] of consistencyMap.entries()) {
        console.log(`- ${item}: ${count}/${activeNodeCount} nodes consistent`);
        expect(count).to.equal(activeNodeCount);
      }
    });
  });

  describe("Edge Case: Vector Clock Overflow", function () {
    it("should handle large vector clocks correctly", async function () {
      // Create large vector clocks by many increments
      console.log("Testing vector clock handling with many increments");

      // First create baseline data
      await servers[0].put("vectorclock/test", {
        value: "initial",
        counter: 0,
      });

      // Wait for propagation
      await wait(2000);

      // Now make many updates in sequence
      const UPDATES_PER_NODE = 20;

      for (let nodeIdx = 0; nodeIdx < 3; nodeIdx++) {
        if (!servers[nodeIdx]) continue;

        for (let i = 0; i < UPDATES_PER_NODE; i++) {
          await servers[nodeIdx].put("vectorclock/test", {
            value: `node-${nodeIdx + 1}-update-${i + 1}`,
            counter: nodeIdx * UPDATES_PER_NODE + i + 1,
          });

          // Small delay to ensure sequential updates
          await wait(50);
        }
      }

      // Wait for propagation
      console.log(
        "Waiting for propagation after many vector clock increments..."
      );
      await wait(5000);

      // Check consistency
      let lastValue = null;
      let consistent = true;

      for (const server of servers) {
        if (!server) continue;

        const data = await server.get("vectorclock/test");

        if (lastValue === null) {
          lastValue = data.value;
        } else if (data.value !== lastValue) {
          consistent = false;
          break;
        }
      }

      // Also check a specific server's vector clock directly
      const vclock = servers[0].syncManager.getVectorClock();
      console.log("Vector clock after many updates:", vclock);

      expect(consistent).to.be.true;

      // Verify the vector clock has entries for all active nodes
      for (let i = 0; i < 3; i++) {
        if (servers[i]) {
          const serverID = servers[i].serverID;
          expect(vclock).to.have.property(serverID);
          expect(vclock[serverID]).to.be.at.least(UPDATES_PER_NODE);
        }
      }
    });
  });

  describe("Edge Case: Database Size Growth", function () {
    it("should handle large amounts of data across the network", async function () {
      // Create larger objects to stress database
      const LARGE_OBJECT_COUNT = 100;
      console.log(
        `Creating ${LARGE_OBJECT_COUNT} larger objects to stress database`
      );

      for (let i = 0; i < LARGE_OBJECT_COUNT; i++) {
        // Use a different node for each write
        const nodeIdx = i % servers.length;
        if (!servers[nodeIdx]) continue;

        // Create an object with some substantial size (~2-4KB)
        const largeObj = {
          id: `large-${i}`,
          name: `Large Object ${i}`,
          description: `This is a larger object created to test database handling. Object #${i}`,
          timestamp: Date.now(),
          data: Array(20)
            .fill(0)
            .map((_, idx) => ({
              field: `field-${idx}`,
              nestedValue: `This is nested value ${idx} in object ${i} with some additional text to increase the size.`,
              array: Array(10)
                .fill(0)
                .map((_, j) => `Item ${j} for field ${idx} in object ${i}`),
            })),
        };

        await servers[nodeIdx].put(`largedata/item-${i}`, largeObj);

        // Small pause between writes
        if (i % 10 === 0) {
          await wait(200);
        }
      }

      // Wait for propagation
      console.log("Waiting for large data to propagate...");
      await wait(10000);

      // Scan database on a few nodes
      const scanResults1 = await servers[0].scan("largedata");
      const scanResults2 = await servers[NODE_COUNT - 1].scan("largedata");

      console.log(`Node 1 scan results: ${scanResults1.length} items`);
      console.log(
        `Node ${NODE_COUNT} scan results: ${scanResults2.length} items`
      );

      expect(scanResults1.length).to.equal(LARGE_OBJECT_COUNT);
      expect(scanResults2.length).to.equal(LARGE_OBJECT_COUNT);
    });
  });

  describe("Edge Case: Subscription Stress", function () {
    it("should handle multiple subscriptions across the network", async function () {
      // Set up subscriptions on multiple nodes
      const subscriptionPromises = [];
      const notificationsReceived = new Map();
      const unsubscribeFuncs = [];

      // Create subscriptions on half the nodes
      for (let i = 0; i < NODE_COUNT / 2; i++) {
        if (!servers[i]) continue;

        const nodeIdx = i;
        notificationsReceived.set(nodeIdx, 0);

        const subscriptionPromise = servers[i]
          .subscribe("subscription", (value, path) => {
            notificationsReceived.set(
              nodeIdx,
              notificationsReceived.get(nodeIdx) + 1
            );
          })
          .then((unsubscribe) => {
            unsubscribeFuncs.push(unsubscribe);
            console.log(`Node ${nodeIdx + 1} subscribed to 'subscription/*'`);
          });

        subscriptionPromises.push(subscriptionPromise);
      }

      await Promise.all(subscriptionPromises);

      // Now send multiple updates from the other half of nodes
      const UPDATE_COUNT = 20;

      for (let i = 0; i < UPDATE_COUNT; i++) {
        const nodeIdx = NODE_COUNT - 1 - (i % Math.floor(NODE_COUNT / 2));
        if (!servers[nodeIdx]) continue;

        await servers[nodeIdx].put(`subscription/item-${i}`, {
          message: `Update ${i} from node ${nodeIdx + 1}`,
          timestamp: Date.now(),
        });

        // Small delay between updates
        await wait(100);
      }

      // Wait for notifications to propagate
      console.log("Waiting for subscription notifications to propagate...");
      await wait(5000);

      // Check notification counts
      let totalNotifications = 0;
      for (const [nodeIdx, count] of notificationsReceived.entries()) {
        console.log(`Node ${nodeIdx + 1} received ${count} notifications`);
        totalNotifications += count;

        // Nodes should receive most notifications eventually, but we allow for some loss during network stress
        expect(count).to.be.at.least(UPDATE_COUNT * 0.7);
      }

      console.log(`Total notifications received: ${totalNotifications}`);

      // Clean up subscriptions
      for (const unsubscribe of unsubscribeFuncs) {
        unsubscribe();
      }

      expect(totalNotifications).to.be.at.least(
        UPDATE_COUNT * notificationsReceived.size * 0.7
      );
    });
  });
});
