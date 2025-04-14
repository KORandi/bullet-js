/**
 * Conflict Resolution Example - Demonstrating different conflict resolution strategies
 * This example shows how different types of conflicts are resolved in P2P Server
 */

const { createServer } = require("../src");

async function runExample() {
  console.log("Starting P2P Server Conflict Resolution Example");

  try {
    // Create three servers with different conflict resolution strategies
    const server1 = createServer({
      port: 3001,
      dbPath: "./db-conflict-1",
      peers: [],
      conflict: {
        defaultStrategy: "last-write-wins", // Default strategy
      },
    });

    const server2 = createServer({
      port: 3002,
      dbPath: "./db-conflict-2",
      peers: ["http://localhost:3001"],
      conflict: {
        defaultStrategy: "merge-fields", // Different default
        pathStrategies: {
          settings: "first-write-wins", // Special strategy for settings
        },
      },
    });

    const server3 = createServer({
      port: 3003,
      dbPath: "./db-conflict-3",
      peers: ["http://localhost:3001", "http://localhost:3002"],
      conflict: {
        defaultStrategy: "last-write-wins",
        pathStrategies: {
          users: "merge-fields",
          inventory: "custom",
        },
      },
    });

    // Register a custom conflict resolver for inventory
    server3.registerConflictResolver(
      "inventory",
      (path, localData, remoteData) => {
        console.log("Applying custom conflict resolution for inventory");

        // Convert to VectorClock instances for comparison
        const localClock =
          localData.vectorClock instanceof VectorClock
            ? localData.vectorClock
            : new VectorClock(localData.vectorClock || {});

        const remoteClock =
          remoteData.vectorClock instanceof VectorClock
            ? remoteData.vectorClock
            : new VectorClock(remoteData.vectorClock || {});

        // For inventory items, take the minimum stock level for safety
        if (
          localData.value &&
          remoteData.value &&
          typeof localData.value.stock === "number" &&
          typeof remoteData.value.stock === "number"
        ) {
          // Determine the clock relationship
          const relation = localClock.dominanceRelation(remoteClock);

          // Determine base item (for all fields except stock)
          let result;

          if (relation === "dominates" || relation === "identical") {
            // Local data dominates, use it as base
            result = { ...localData };
          } else if (relation === "dominated") {
            // Remote data dominates, use it as base
            result = { ...remoteData };
          } else {
            // Concurrent updates, use deterministic tiebreaker
            const winner = localClock.deterministicWinner(
              remoteClock,
              localData.origin || "",
              remoteData.origin || ""
            );

            result = winner === "this" ? { ...localData } : { ...remoteData };
          }

          // But always use the minimum stock level
          const minStock = Math.min(
            localData.value.stock,
            remoteData.value.stock
          );
          result.value = { ...result.value, stock: minStock };

          // Always merge the vector clocks
          result.vectorClock = localClock.merge(remoteClock).toJSON();

          console.log(`Custom resolver: using minimum stock of ${minStock}`);
          return result;
        }

        // Fall back to standard vector clock resolution if not inventory items with stock
        return localClock.dominanceRelation(remoteClock) === "dominated"
          ? remoteData
          : localData;
      }
    );

    // Start all servers
    await Promise.all([server1.start(), server2.start(), server3.start()]);
    console.log("All servers started successfully");

    // Give time for connections to establish
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Test 1: Last-Write-Wins Strategy
    console.log("\n=== Test 1: Last-Write-Wins Strategy ===");

    // Server 1 writes data
    console.log("Server 1 writing product data...");
    await server1.put("products/laptop", {
      name: "Laptop Pro",
      price: 1299,
      description: "Professional laptop with high performance",
    });

    // Wait briefly for sync
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Server 3 updates with conflicting data (newer timestamp)
    console.log("Server 3 writing conflicting product data...");
    await server3.put("products/laptop", {
      name: "Laptop Pro",
      price: 1199,
      features: ["16GB RAM", "512GB SSD"],
    });

    // Wait for synchronization and conflict resolution
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check which data won
    const product1 = await server1.get("products/laptop");
    const product2 = await server2.get("products/laptop");

    console.log("Server 1's view of product:", product1);
    console.log("Server 2's view of product:", product2);
    console.log(
      "With last-write-wins, the newer write (price: 1199) should have won"
    );

    // Test 2: Field Merging Strategy
    console.log("\n=== Test 2: Field Merging Strategy ===");

    // Server 1 creates a user
    console.log("Server 1 creating user...");
    await server1.put("users/bob", {
      name: "Bob Smith",
      email: "bob@example.com",
      role: "admin",
    });

    // Server 3 creates the same user with different fields
    console.log("Server 3 creating same user with different fields...");
    await server3.put("users/bob", {
      name: "Bob Smith",
      phone: "555-1234",
      department: "Engineering",
    });

    // Wait for synchronization and conflict resolution
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check merged results
    const user1 = await server1.get("users/bob");
    const user3 = await server3.get("users/bob");

    console.log("Server 1's view of user:", user1);
    console.log("Server 3's view of user:", user3);
    console.log(
      "With merge-fields, all fields (email, role, phone, department) should be preserved"
    );

    // Test 3: First-Write-Wins Strategy
    console.log("\n=== Test 3: First-Write-Wins Strategy ===");

    // Server 2 sets initial settings
    console.log("Server 2 setting initial settings...");
    await server2.put("settings/global", {
      theme: "dark",
      apiKey: "original-key-12345",
      maxConnections: 100,
    });

    // Wait for sync
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Server 1 tries to change settings
    console.log("Server 1 trying to update settings...");
    await server1.put("settings/global", {
      theme: "light",
      apiKey: "new-key-67890",
      maxConnections: 50,
    });

    // Wait for synchronization and conflict resolution
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check which settings remained
    const settings2 = await server2.get("settings/global");
    const settings3 = await server3.get("settings/global");

    console.log("Server 2's settings:", settings2);
    console.log("Server 3's settings:", settings3);
    console.log(
      "With first-write-wins, the original settings should be preserved"
    );

    // Test 4: Custom Resolution Strategy
    console.log("\n=== Test 4: Custom Resolution Strategy ===");

    // Server 1 creates inventory item
    console.log("Server 1 creating inventory item...");
    await server1.put("inventory/widget", {
      name: "Widget",
      price: 29.99,
      stock: 100,
      lastUpdated: new Date().toISOString(),
    });

    // Server 3 updates with a lower stock count
    console.log("Server 3 updating inventory with lower stock...");
    await server3.put("inventory/widget", {
      name: "Widget",
      price: 24.99, // Sale price
      stock: 75, // Lower stock count
      onSale: true,
      lastUpdated: new Date().toISOString(),
    });

    // Wait for synchronization and conflict resolution
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check resolved inventory
    const inventory1 = await server1.get("inventory/widget");
    const inventory3 = await server3.get("inventory/widget");

    console.log("Server 1's inventory:", inventory1);
    console.log("Server 3's inventory:", inventory3);
    console.log(
      "With custom resolution, stock should be the minimum (75) while other fields follow last-write-wins"
    );

    // Clean up and exit
    console.log("\n=== Cleaning up ===");
    await Promise.all([server1.close(), server2.close(), server3.close()]);
    console.log("All servers closed");
  } catch (error) {
    console.error("Error in example:", error);
  }
}

// Run the example
runExample();
