/**
 * Performance Benchmark Tests for P2P Server
 *
 * This suite evaluates the performance of the P2P server in various scenarios,
 * establishing baseline metrics for production environments.
 */

const { expect } = require("chai");
const rimraf = require("rimraf");
const { createTestNetwork, P2PServer } = require("../../src");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Test helpers
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Performance thresholds
const PERF_THRESHOLDS = {
  // Time thresholds in milliseconds
  SINGLE_PUT_MAX_TIME: 10,
  SINGLE_GET_MAX_TIME: 5,
  BULK_PUT_PER_ITEM_MAX_TIME: 10,
  SYNC_PROPAGATION_MAX_TIME: 500,
  MEMORY_MAX_RSS_MB: 150,
  CPU_MAX_USAGE_PERCENT: 50,
};

// Test database directory
const TEST_DB_DIR = "./test/temp/benchmark";

/**
 * Measure execution time of a function
 * @param {Function} fn - Function to measure
 * @returns {Promise<number>} - Execution time in ms
 */
async function measureExecutionTime(fn) {
  const start = process.hrtime.bigint();
  await fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000; // Convert nanoseconds to milliseconds
}

/**
 * Generate random test data
 * @param {number} size - Size of data in bytes (approximate)
 * @returns {Object} - Random data object
 */
function generateRandomData(size = 1024) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < size; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return {
    id: `item-${Math.floor(Math.random() * 1000000)}`,
    content: result,
    timestamp: Date.now(),
    metadata: {
      type: "benchmark",
      version: "1.0",
      tags: ["test", "performance", "benchmark"],
    },
  };
}

/**
 * Clean up test databases
 */
function cleanupTestDatabases() {
  if (fs.existsSync(TEST_DB_DIR)) {
    rimraf.sync(TEST_DB_DIR);
    console.log(`Cleaned up test databases at ${TEST_DB_DIR}`);
  }
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
}

/**
 * Measure memory usage
 * @returns {Object} - Memory usage in MB
 */
function getMemoryUsage() {
  const memoryUsage = process.memoryUsage();
  return {
    rss: Math.round(memoryUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    external: Math.round(memoryUsage.external / 1024 / 1024),
  };
}

/**
 * Get CPU information
 * @returns {Object} - CPU info
 */
function getCpuInfo() {
  return {
    cpus: os.cpus().length,
    model: os.cpus()[0].model,
    speed: os.cpus()[0].speed,
  };
}

describe("P2P Server Performance Benchmarks", function () {
  // These tests may take longer to run
  this.timeout(30000);

  // Log system info
  before(function () {
    console.log("=== System Information ===");
    console.log(`Platform: ${os.platform()} ${os.release()}`);
    console.log(`CPU: ${getCpuInfo().model} (${getCpuInfo().cpus} cores)`);
    console.log(`Total Memory: ${Math.round(os.totalmem() / 1024 / 1024)} MB`);
    console.log(`Free Memory: ${Math.round(os.freemem() / 1024 / 1024)} MB`);
    console.log("=========================");

    cleanupTestDatabases();
  });

  after(function () {
    cleanupTestDatabases();
  });

  describe("Single Node Performance", function () {
    let server;

    before(async function () {
      server = new P2PServer({
        port: 4001,
        dbPath: `${TEST_DB_DIR}/single-node`,
        peers: [],
      });

      await server.start();
    });

    after(async function () {
      await server.close();
    });

    it("should perform single PUT operations within threshold", async function () {
      const data = generateRandomData(1024); // 1KB data

      const executionTime = await measureExecutionTime(async () => {
        await server.put("benchmark/single-put", data);
      });

      console.log(
        `Single PUT (1KB) execution time: ${executionTime.toFixed(2)} ms`
      );
      expect(executionTime).to.be.below(PERF_THRESHOLDS.SINGLE_PUT_MAX_TIME);
    });

    it("should perform single GET operations within threshold", async function () {
      const data = generateRandomData(1024); // 1KB data
      await server.put("benchmark/single-get", data);

      const executionTime = await measureExecutionTime(async () => {
        await server.get("benchmark/single-get");
      });

      console.log(
        `Single GET (1KB) execution time: ${executionTime.toFixed(2)} ms`
      );
      expect(executionTime).to.be.below(PERF_THRESHOLDS.SINGLE_GET_MAX_TIME);
    });

    it("should handle larger data (10KB) within acceptable time", async function () {
      const data = generateRandomData(10 * 1024); // 10KB data

      const putTime = await measureExecutionTime(async () => {
        await server.put("benchmark/large-data", data);
      });

      const getTime = await measureExecutionTime(async () => {
        await server.get("benchmark/large-data");
      });

      console.log(
        `Large data PUT (10KB) execution time: ${putTime.toFixed(2)} ms`
      );
      console.log(
        `Large data GET (10KB) execution time: ${getTime.toFixed(2)} ms`
      );

      expect(putTime).to.be.below(PERF_THRESHOLDS.SINGLE_PUT_MAX_TIME * 2);
      expect(getTime).to.be.below(PERF_THRESHOLDS.SINGLE_GET_MAX_TIME * 2);
    });

    it("should perform bulk operations efficiently", async function () {
      const COUNT = 100;
      const items = [];

      for (let i = 0; i < COUNT; i++) {
        items.push({
          path: `benchmark/bulk/${i}`,
          data: generateRandomData(512), // 0.5KB per item
        });
      }

      const totalTime = await measureExecutionTime(async () => {
        for (const item of items) {
          await server.put(item.path, item.data);
        }
      });

      const averageTime = totalTime / COUNT;
      console.log(
        `Bulk PUT (${COUNT} items) total time: ${totalTime.toFixed(2)} ms, avg per item: ${averageTime.toFixed(2)} ms`
      );

      expect(averageTime).to.be.below(
        PERF_THRESHOLDS.BULK_PUT_PER_ITEM_MAX_TIME
      );
    });

    it("should handle scan operations efficiently", async function () {
      // Ensure we have data to scan
      for (let i = 0; i < 100; i++) {
        await server.put(`benchmark/scan/item${i}`, { value: `test${i}` });
      }

      const scanTime = await measureExecutionTime(async () => {
        await server.scan("benchmark/scan");
      });

      console.log(
        `Scan operation (100 items) execution time: ${scanTime.toFixed(2)} ms`
      );
      expect(scanTime).to.be.below(PERF_THRESHOLDS.SINGLE_PUT_MAX_TIME * 10);
    });

    it("should maintain reasonable memory usage", function () {
      const memoryUsage = getMemoryUsage();
      console.log("Memory usage:", memoryUsage);

      expect(memoryUsage.rss).to.be.below(PERF_THRESHOLDS.MEMORY_MAX_RSS_MB);
    });
  });

  describe("Multi-Node Synchronization Performance", function () {
    let servers = [];
    const NODE_COUNT = 3;

    before(async function () {
      servers = createTestNetwork(
        NODE_COUNT,
        4001,
        `${TEST_DB_DIR}/multi-node`,
        {
          sync: {
            antiEntropyInterval: 2000, // 2 seconds
          },
        }
      );

      // Start all servers
      for (const server of servers) {
        await server.start();
      }

      // Wait for connections to establish
      await wait(2000);
    });

    after(async function () {
      // Close all servers
      for (const server of servers) {
        await server.close();
      }
    });

    it("should propagate data to all nodes efficiently", async function () {
      const data = generateRandomData(2048); // 2KB data
      const testPath = "benchmark/propagation-test";

      // Write to first node
      await servers[0].put(testPath, data);

      // Measure propagation time
      let propagated = false;
      const startTime = Date.now();

      // Wait for data to reach the last node
      while (
        !propagated &&
        Date.now() - startTime < PERF_THRESHOLDS.SYNC_PROPAGATION_MAX_TIME * 2
      ) {
        const receivedData = await servers[NODE_COUNT - 1].get(testPath);
        if (receivedData && receivedData.id === data.id) {
          propagated = true;
        } else {
          await wait(50); // Small wait to avoid tight polling
        }
      }

      const propagationTime = Date.now() - startTime;
      console.log(
        `Data propagation time across ${NODE_COUNT} nodes: ${propagationTime} ms`
      );

      expect(propagated).to.be.true;
      expect(propagationTime).to.be.below(
        PERF_THRESHOLDS.SYNC_PROPAGATION_MAX_TIME
      );
    });

    it("should handle concurrent updates efficiently", async function () {
      // Each node updates the same path
      const testPath = "benchmark/concurrent-updates";
      const updatePromises = [];

      for (let i = 0; i < NODE_COUNT; i++) {
        updatePromises.push(
          servers[i].put(`${testPath}/node${i}`, {
            value: `node${i}-data`,
            timestamp: Date.now() + i, // Ensure different timestamps
          })
        );
      }

      // Measure time to perform all updates
      const updateTime = await measureExecutionTime(async () => {
        await Promise.all(updatePromises);
      });

      console.log(
        `Concurrent updates from ${NODE_COUNT} nodes: ${updateTime.toFixed(2)} ms`
      );

      // Wait for propagation
      await wait(PERF_THRESHOLDS.SYNC_PROPAGATION_MAX_TIME);

      // Verify each node has all updates
      for (let i = 0; i < NODE_COUNT; i++) {
        for (let j = 0; j < NODE_COUNT; j++) {
          const data = await servers[i].get(`${testPath}/node${j}`);
          expect(data).to.not.be.null;
          expect(data.value).to.equal(`node${j}-data`);
        }
      }
    });

    it("should handle subscription notifications efficiently", async function () {
      let notificationCount = 0;
      let notificationTime = null;

      // First node subscribes to changes
      const unsubscribe = await servers[0].subscribe(
        "benchmark/subscription",
        (value, path) => {
          if (!notificationTime) {
            notificationTime = Date.now();
          }
          notificationCount++;
        }
      );

      // Last node writes data
      const lastNodeIndex = NODE_COUNT - 1;
      const startTime = Date.now();
      await servers[lastNodeIndex].put("benchmark/subscription/test", {
        value: "subscription-test",
        timestamp: Date.now(),
      });

      // Wait for notification
      await wait(PERF_THRESHOLDS.SYNC_PROPAGATION_MAX_TIME);

      // Clean up subscription
      unsubscribe();

      const totalTime = notificationTime ? notificationTime - startTime : null;
      console.log(`Subscription notification time: ${totalTime} ms`);

      expect(notificationCount).to.be.above(0);
      expect(totalTime).to.be.below(PERF_THRESHOLDS.SYNC_PROPAGATION_MAX_TIME);
    });

    it("should maintain reasonable memory usage across multiple nodes", function () {
      // Check each server's memory usage
      for (let i = 0; i < NODE_COUNT; i++) {
        const memoryUsage = getMemoryUsage();
        console.log(`Server ${i + 1} memory usage:`, memoryUsage);

        expect(memoryUsage.rss).to.be.below(
          PERF_THRESHOLDS.MEMORY_MAX_RSS_MB * 1.5
        );
      }
    });
  });

  describe("Stress Test", function () {
    let server;

    before(async function () {
      server = new P2PServer({
        port: 4001,
        dbPath: `${TEST_DB_DIR}/stress-test`,
        peers: [],
      });

      await server.start();
    });

    after(async function () {
      await server.close();
    });

    it("should handle high volume of sequential operations", async function () {
      this.timeout(60000); // Increase timeout for stress test

      const OPERATION_COUNT = 1000;
      console.log(
        `Running stress test with ${OPERATION_COUNT} sequential operations...`
      );

      const startMemory = getMemoryUsage();
      console.log("Memory usage before stress test:", startMemory);

      const startTime = Date.now();

      // Perform many sequential operations
      for (let i = 0; i < OPERATION_COUNT; i++) {
        const data = { value: `stress-test-${i}`, index: i };
        await server.put(`stress/sequential/${i}`, data);

        // Read the data back
        const result = await server.get(`stress/sequential/${i}`);
        expect(result.value).to.equal(`stress-test-${i}`);
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const operationsPerSecond = Math.floor(
        OPERATION_COUNT / (totalTime / 1000)
      );

      console.log(`Completed ${OPERATION_COUNT} operations in ${totalTime} ms`);
      console.log(`Performance: ${operationsPerSecond} operations/second`);

      const endMemory = getMemoryUsage();
      console.log("Memory usage after stress test:", endMemory);

      // Memory should increase, but not dramatically
      expect(endMemory.rss).to.be.below(startMemory.rss * 2);
    });

    it("should handle parallel operations efficiently", async function () {
      const OPERATION_COUNT = 100;
      const CONCURRENCY = 10;
      console.log(
        `Running parallel test with ${OPERATION_COUNT} operations (${CONCURRENCY} concurrent)...`
      );

      const startTime = Date.now();
      const operations = [];

      // Create batches of concurrent operations
      for (let batch = 0; batch < OPERATION_COUNT / CONCURRENCY; batch++) {
        const batchPromises = [];

        for (let i = 0; i < CONCURRENCY; i++) {
          const index = batch * CONCURRENCY + i;
          const data = { value: `parallel-test-${index}`, index };
          batchPromises.push(server.put(`stress/parallel/${index}`, data));
        }

        // Wait for concurrent batch to complete
        await Promise.all(batchPromises);
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const operationsPerSecond = Math.floor(
        OPERATION_COUNT / (totalTime / 1000)
      );

      console.log(
        `Completed ${OPERATION_COUNT} parallel operations in ${totalTime} ms`
      );
      console.log(`Performance: ${operationsPerSecond} operations/second`);

      // Verify all operations completed successfully
      for (let i = 0; i < OPERATION_COUNT; i++) {
        const result = await server.get(`stress/parallel/${i}`);
        expect(result).to.not.be.null;
        expect(result.value).to.equal(`parallel-test-${i}`);
      }
    });
  });

  describe("Production Readiness Criteria", function () {
    it("should define performance benchmarks for production environments", function () {
      console.log("=== Production Readiness Criteria ===");
      console.log(
        `Single PUT operation: < ${PERF_THRESHOLDS.SINGLE_PUT_MAX_TIME} ms`
      );
      console.log(
        `Single GET operation: < ${PERF_THRESHOLDS.SINGLE_GET_MAX_TIME} ms`
      );
      console.log(
        `Bulk operations: < ${PERF_THRESHOLDS.BULK_PUT_PER_ITEM_MAX_TIME} ms per item`
      );
      console.log(
        `Data propagation: < ${PERF_THRESHOLDS.SYNC_PROPAGATION_MAX_TIME} ms across nodes`
      );
      console.log(
        `Memory usage: < ${PERF_THRESHOLDS.MEMORY_MAX_RSS_MB} MB per node`
      );
      console.log(
        `CPU usage: < ${PERF_THRESHOLDS.CPU_MAX_USAGE_PERCENT}% sustained`
      );
      console.log("====================================");

      // This test doesn't actually assert anything - it's informational
    });
  });
});
