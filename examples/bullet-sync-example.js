/**
 * Bullet.js Sync Example
 *
 * This script creates a 10MB database on one peer, then connects a second peer
 * and monitors the automatic sync progress. When the sync is complete, it shuts down.
 */

const Bullet = require("../src/bullet");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Configuration
const FIRST_PEER_PORT = 8765;
const SECOND_PEER_PORT = 8766;
const TARGET_DB_SIZE = 10 * 1024 * 1024; // 10MB
const CHECK_INTERVAL = 3000; // Check sync status every 3 seconds
const STORAGE_PATH_1 = path.join(__dirname, "../data/sync-peer-1");
const STORAGE_PATH_2 = path.join(__dirname, "../data/sync-peer-2");

// Ensure storage directories exist
for (const dir of [STORAGE_PATH_1, STORAGE_PATH_2]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  } else {
    // Clean the directory for fresh start
    fs.readdirSync(dir).forEach((file) => {
      fs.unlinkSync(path.join(dir, file));
    });
  }
}

// Generate random data to fill the database
function generateRandomData(size) {
  const dataSet = {};
  let totalSize = 0;
  let counter = 0;

  console.log("Generating random data...");

  while (totalSize < size) {
    const keyName = `item${counter}`;
    const dataChunk = {
      id: counter,
      name: `Item ${counter}`,
      description: crypto.randomBytes(100).toString("hex"),
      data: crypto.randomBytes(1024).toString("base64"),
      timestamp: Date.now(),
      attributes: {
        color: ["red", "green", "blue", "yellow"][
          Math.floor(Math.random() * 4)
        ],
        size: Math.floor(Math.random() * 100),
        tags: Array.from({ length: 5 }, () =>
          crypto.randomBytes(8).toString("hex")
        ),
        nested: {
          field1: crypto.randomBytes(20).toString("hex"),
          field2: crypto.randomBytes(20).toString("hex"),
          deeplyNested: {
            moreData: crypto.randomBytes(50).toString("hex"),
          },
        },
      },
    };

    dataSet[keyName] = dataChunk;

    // Estimate size by JSON stringifying
    totalSize += Buffer.byteLength(JSON.stringify(dataChunk));
    counter++;

    if (counter % 100 === 0) {
      console.log(
        `Generated ${counter} items, approximately ${(
          totalSize /
          1024 /
          1024
        ).toFixed(2)}MB`
      );
    }
  }

  console.log(
    `Data generation complete: ${counter} items, ${(
      totalSize /
      1024 /
      1024
    ).toFixed(2)}MB`
  );
  return dataSet;
}

// Initialize first peer and populate database
let activePeers = [];
let syncCheckInterval;

async function startFirstPeer() {
  console.log("Starting first peer...");

  const peer1 = new Bullet({
    server: true,
    port: FIRST_PEER_PORT,
    storage: true,
    storagePath: STORAGE_PATH_1,
    enableMiddleware: true,
    batchSize: 100,
  });

  activePeers.push(peer1);

  // Generate random data and populate the database
  const startTime = Date.now();
  console.log("Populating database with 10MB of data...");

  const itemsData = generateRandomData(TARGET_DB_SIZE);
  for (const [key, value] of Object.entries(itemsData)) {
    peer1.get(`items/${key}`).put(value);
  }

  // Add metadata
  peer1.get("metadata").put({
    createdAt: new Date().toISOString(),
    itemCount: Object.keys(itemsData).length,
    dbVersion: "1.0.0",
  });

  // Force a save to storage
  if (peer1.storage && peer1.storage.save) {
    await new Promise((resolve) => {
      peer1.storage.save();
      setTimeout(resolve, 1000); // Give it a moment to finish writing
    });
  }

  const endTime = Date.now();
  console.log(`Database populated in ${(endTime - startTime) / 1000} seconds`);
  console.log(`First peer running at ws://localhost:${FIRST_PEER_PORT}`);

  return peer1;
}

function startSecondPeer() {
  console.log("Starting second peer...");

  const peer2 = new Bullet({
    server: true,
    port: SECOND_PEER_PORT,
    peers: [`ws://localhost:${FIRST_PEER_PORT}`], // Connect to first peer
    storage: true,
    storagePath: STORAGE_PATH_2,
    enableMiddleware: true,
  });

  activePeers.push(peer2);

  // Setup listeners for tracking sync
  peer2.on("all", (event, data) => {
    if (event === "sync-data") {
      console.log(
        `Receiving sync batch: ${data.batchIndex + 1}/${data.totalBatches} (${
          data.updates.length
        } updates)`
      );
    }
  });

  console.log(
    `Second peer running at ws://localhost:${SECOND_PEER_PORT} and connecting to first peer`
  );

  return peer2;
}

function checkSyncStatus(peer1, peer2) {
  // Get item counts from both peers
  const peer1Items = Object.keys(peer1.get("items").value() || {}).length;
  const peer2Items = Object.keys(peer2.get("items").value() || {}).length;

  console.log(
    `Sync status check: Peer 1 has ${peer1Items} items, Peer 2 has ${peer2Items} items`
  );

  // Check if peer2 has all metadata
  const peer1Meta = peer1.get("metadata").value();
  const peer2Meta = peer2.get("metadata").value();

  if (peer2Meta && peer2Meta.itemCount) {
    console.log(
      `Peer 2 has metadata: version ${peer2Meta.dbVersion}, item count ${peer2Meta.itemCount}`
    );
  }

  // Check if sync is complete
  if (
    peer1Items > 0 &&
    peer1Items === peer2Items &&
    peer2Meta &&
    peer2Meta.itemCount === peer1Items
  ) {
    console.log(`Sync complete! Both peers have ${peer1Items} items.`);

    // Calculate storage sizes
    const peer1Size = calculateStorageSize(STORAGE_PATH_1);
    const peer2Size = calculateStorageSize(STORAGE_PATH_2);

    console.log(
      `Peer 1 storage size: ${(peer1Size / 1024 / 1024).toFixed(2)}MB`
    );
    console.log(
      `Peer 2 storage size: ${(peer2Size / 1024 / 1024).toFixed(2)}MB`
    );

    // Stop interval and shutdown
    clearInterval(syncCheckInterval);
    shutdown();
  }
}

function calculateStorageSize(directoryPath) {
  let totalSize = 0;

  try {
    const files = fs.readdirSync(directoryPath);

    for (const file of files) {
      const filePath = path.join(directoryPath, file);
      const stats = fs.statSync(filePath);

      if (stats.isFile()) {
        totalSize += stats.size;
      }
    }
  } catch (err) {
    console.error(`Error calculating storage size for ${directoryPath}:`, err);
  }

  return totalSize;
}

function shutdown() {
  console.log("Shutting down peers...");

  // Close all active peers
  for (const peer of activePeers) {
    if (peer && typeof peer.close === "function") {
      peer.close();
    }
  }

  console.log("All peers shut down, exiting");
  process.exit(0);
}

async function main() {
  try {
    // Start the first peer with data
    const peer1 = await startFirstPeer();

    // Start the second peer that will sync
    const peer2 = startSecondPeer();

    // Start checking sync status every 3 seconds
    syncCheckInterval = setInterval(() => {
      checkSyncStatus(peer1, peer2);
    }, CHECK_INTERVAL);

    // Handle graceful shutdown on Ctrl+C
    process.on("SIGINT", () => {
      console.log("\nReceived SIGINT (Ctrl+C). Shutting down...");
      clearInterval(syncCheckInterval);
      shutdown();
    });
  } catch (error) {
    console.error("Error in main execution:", error);
    shutdown();
  }
}

// Run the main function
main();
