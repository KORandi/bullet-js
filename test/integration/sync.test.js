/**
 * Integration tests for synchronization
 */

const { expect } = require("chai");
const { createTestNetwork } = require("../helpers/test-network");
const { wait, cleanupServers } = require("../helpers/test-network");

describe("Synchronization Integration Tests", function () {
  // These tests can take time
  this.timeout(10000);

  let servers = [];

  afterEach(async () => {
    await cleanupServers(servers);
    servers = [];
  });

  describe("Basic Data Propagation", () => {
    it("should propagate data to all nodes in a 3-node network", async () => {
      // Setup a 3-node network
      servers = createTestNetwork(3, 4001, "./test/temp/sync-test-db");

      // Start all servers
      for (const server of servers) {
        await server.start();
      }

      // Wait for connections to establish
      await wait(1000);

      // First node writes data
      await servers[0].put("test/key", { value: "test-data" });

      // Wait for data to propagate
      await wait(1000);

      // Check if all nodes received the data
      for (let i = 0; i < servers.length; i++) {
        const data = await servers[i].get("test/key");
        expect(data).to.not.be.null;
        expect(data.value).to.equal("test-data");
      }
    });

    it("should handle updates from multiple nodes", async () => {
      // Setup a 3-node network
      servers = createTestNetwork(3, 4001, "./test/temp/sync-test-db");

      // Start all servers
      for (const server of servers) {
        await server.start();
      }

      // Wait for connections to establish
      await wait(1000);

      // Each node writes different data
      await servers[0].put("node/1", { value: "node-1-data" });
      await servers[1].put("node/2", { value: "node-2-data" });
      await servers[2].put("node/3", { value: "node-3-data" });

      // Wait for data to propagate
      await wait(2000);

      // Check if all data propagated to all nodes
      for (let i = 0; i < servers.length; i++) {
        const data1 = await servers[i].get("node/1");
        const data2 = await servers[i].get("node/2");
        const data3 = await servers[i].get("node/3");

        expect(data1.value).to.equal("node-1-data");
        expect(data2.value).to.equal("node-2-data");
        expect(data3.value).to.equal("node-3-data");
      }
    });
  });

  describe("Multi-hop Propagation", () => {
    it("should propagate data across multiple hops", async () => {
      // Create linear network: Node1 -> Node2 -> Node3 -> Node4 -> Node5
      servers = []; // Can't use createTestNetwork for custom topology

      for (let i = 0; i < 5; i++) {
        const port = 4000 + i;
        const peers = i < 4 ? [`http://localhost:${4000 + i + 1}`] : [];

        servers.push(
          require("../../src").createServer({
            port,
            dbPath: `./test/temp/sync-test-db-${i + 1}`,
            peers,
          })
        );
      }

      // Start all servers
      for (const server of servers) {
        await server.start();
      }

      // Wait for connections to establish
      await wait(1000);

      // First node writes data
      await servers[0].put("multihop/test", { value: "hop-test-data" });

      // Wait longer for multi-hop propagation
      await wait(2000);

      // Check if the last node received the data
      const data = await servers[4].get("multihop/test");
      expect(data).to.not.be.null;
      expect(data.value).to.equal("hop-test-data");
    });
  });

  describe("Conflict Resolution", () => {
    it("should resolve field conflicts using merge-fields strategy", async () => {
      // Setup a 2-node network with merge-fields strategy
      servers = createTestNetwork(2, 4001, "./test/temp/sync-test-db", {
        conflict: {
          defaultStrategy: "merge-fields",
        },
      });

      // Start all servers
      for (const server of servers) {
        await server.start();
      }

      // Wait for connections to establish
      await wait(1000);

      // First node adds some user fields
      await servers[0].put("users/test", {
        name: "Test User",
        email: "test@example.com",
      });

      // Small delay to ensure different timestamps
      await wait(50);

      // Second node adds different user fields
      await servers[1].put("users/test", {
        name: "Test User",
        phone: "555-1234",
        location: "Test City",
      });

      // Wait for sync and conflict resolution
      await wait(1000);

      // Check results on both nodes
      const user1 = await servers[0].get("users/test");
      const user2 = await servers[1].get("users/test");

      // Both should have the merged fields
      expect(user1).to.deep.include({
        name: "Test User",
        email: "test@example.com",
        phone: "555-1234",
        location: "Test City",
      });

      expect(user2).to.deep.include({
        name: "Test User",
        email: "test@example.com",
        phone: "555-1234",
        location: "Test City",
      });
    });

    it("should resolve conflicts using last-write-wins strategy", async () => {
      // Setup a 2-node network with last-write-wins strategy
      servers = createTestNetwork(2, 4001, "./test/temp/sync-test-db", {
        conflict: {
          defaultStrategy: "last-write-wins",
        },
      });

      // Start all servers
      for (const server of servers) {
        await server.start();
      }

      // Wait for connections to establish
      await wait(1000);

      // First node writes data
      await servers[0].put("products/item", {
        name: "Product",
        price: 100,
      });

      // Small delay to ensure different timestamps
      await wait(50);

      // Second node updates with different data
      await servers[1].put("products/item", {
        name: "Product",
        price: 120,
        onSale: true,
      });

      // Wait for sync and conflict resolution
      await wait(1000);

      // Check results on both nodes
      const product1 = await servers[0].get("products/item");
      const product2 = await servers[1].get("products/item");

      // Both should have the data from the second update
      expect(product1).to.deep.include({
        name: "Product",
        price: 120,
        onSale: true,
      });

      expect(product2).to.deep.include({
        name: "Product",
        price: 120,
        onSale: true,
      });
    });
  });

  describe("Subscriptions", () => {
    it("should notify subscribers of remote changes", async () => {
      // Setup a 2-node network
      servers = createTestNetwork(2, 4001, "./test/temp/sync-test-db");

      // Start all servers
      for (const server of servers) {
        await server.start();
      }

      // Wait for connections to establish
      await wait(1000);

      // Create a subscription on first node
      let notificationReceived = false;
      let notificationValue = null;
      let notificationPath = null;

      const unsubscribe = await servers[0].subscribe(
        "notifications",
        (value, path) => {
          notificationReceived = true;
          notificationValue = value;
          notificationPath = path;
        }
      );

      // Second node writes to notifications path
      await servers[1].put("notifications/test", {
        message: "Test notification",
        timestamp: Date.now(),
      });

      // Wait for sync and notification
      await wait(1000);

      // Cleanup
      unsubscribe();

      // Check notification was received
      expect(notificationReceived).to.be.true;
      expect(notificationPath).to.equal("notifications/test");
      expect(notificationValue).to.have.property(
        "message",
        "Test notification"
      );
    });
  });

  describe("Anti-Entropy", () => {
    it("should sync data through anti-entropy process", async () => {
      // Setup a 2-node network with short anti-entropy interval
      servers = createTestNetwork(2, 4001, "./test/temp/sync-test-db", {
        sync: {
          antiEntropyInterval: 2000, // Run anti-entropy every 2 seconds
        },
      });

      // Start all servers
      for (const server of servers) {
        await server.start();
      }

      // Wait for connections to establish
      await wait(1000);

      // Write data on first server
      await servers[0].put("entropy/test", { value: "entropy-data" });

      // Temporarily disconnect second server's network functions
      const originalBroadcast = servers[0].socketManager.broadcast;
      servers[0].socketManager.broadcast = () => 0; // Disable broadcasting

      // Write more data on first server while broadcast is disabled
      await servers[0].put("entropy/offline", { value: "offline-data" });

      // Wait for anti-entropy to run
      await wait(3000);

      // Restore broadcasting
      servers[0].socketManager.broadcast = originalBroadcast;

      // Check if second server received the data through anti-entropy
      const data = await servers[1].get("entropy/offline");

      expect(data).to.not.be.null;
      expect(data.value).to.equal("offline-data");
    });

    it("should manually trigger anti-entropy synchronization", async () => {
      // Setup a 2-node network with no auto anti-entropy
      servers = createTestNetwork(2, 4001, "./test/temp/sync-test-db", {
        sync: {
          antiEntropyInterval: null, // Disable automatic anti-entropy
        },
      });

      // Start all servers
      for (const server of servers) {
        await server.start();
      }

      // Wait for connections to establish
      await wait(1000);

      // Write data on first server
      await servers[0].put("manual/test", { value: "manual-data" });

      // Temporarily disconnect second server's network functions
      const originalBroadcast = servers[0].socketManager.broadcast;
      servers[0].socketManager.broadcast = () => 0; // Disable broadcasting

      // Write more data on first server while broadcast is disabled
      await servers[0].put("manual/offline", { value: "manual-offline-data" });

      // Manually trigger anti-entropy on first server
      await servers[0].runAntiEntropy();

      // Wait for sync
      await wait(1000);

      // Restore broadcasting
      servers[0].socketManager.broadcast = originalBroadcast;

      // Check if second server received the data through manual anti-entropy
      const data = await servers[1].get("manual/offline");

      expect(data).to.not.be.null;
      expect(data.value).to.equal("manual-offline-data");
    });
  });

  describe("Vector Clock Synchronization", () => {
    it("should synchronize vector clocks between nodes", async () => {
      // Setup a 2-node network
      servers = createTestNetwork(2, 4001, "./test/temp/sync-test-db");

      // Start all servers
      for (const server of servers) {
        await server.start();
      }

      // Wait for connections to establish
      await wait(1000);

      // Both nodes increment their vector clocks by writing data
      await servers[0].put("vclocks/server1", { value: "server1-data" });
      await servers[1].put("vclocks/server2", { value: "server2-data" });

      // Wait for sync
      await wait(1000);

      // Get vector clocks from both servers
      const vclock1 = servers[0].syncManager.getVectorClock();
      const vclock2 = servers[1].syncManager.getVectorClock();

      // Both vector clocks should have entries for both servers
      expect(vclock1).to.have.property(servers[0].serverID);
      expect(vclock1).to.have.property(servers[1].serverID);
      expect(vclock2).to.have.property(servers[0].serverID);
      expect(vclock2).to.have.property(servers[1].serverID);

      // The values should not be less than 1 (each server incremented at least once)
      expect(vclock1[servers[0].serverID]).to.be.at.least(1);
      expect(vclock2[servers[1].serverID]).to.be.at.least(1);
    });
  });

  describe("Versioning", () => {
    it("should maintain version history for updated values", async () => {
      // Setup a single node
      servers = createTestNetwork(1, 4001, "./test/temp/sync-test-db", {
        sync: {
          maxVersions: 3, // Keep 3 versions
        },
      });

      // Start server
      await servers[0].start();

      // Write data multiple times
      await servers[0].put("versioned/key", "version-1");
      await wait(50);
      await servers[0].put("versioned/key", "version-2");
      await wait(50);
      await servers[0].put("versioned/key", "version-3");
      await wait(50);
      await servers[0].put("versioned/key", "version-4");

      // Get version history
      const history = servers[0].getVersionHistory("versioned/key");

      // Should have 3 versions (maxVersions)
      expect(history).to.have.lengthOf(3);

      // Most recent version should be first
      expect(history[0].value).to.equal("version-3");
      expect(history[1].value).to.equal("version-2");
      expect(history[2].value).to.equal("version-1");
    });
  });
});
