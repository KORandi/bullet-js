/**
 * Basic Example - Two P2P Servers Synchronizing Data
 * This example shows how to set up two servers and synchronize data between them.
 */

const { createServer } = require("../src");

async function runExample() {
  console.log("Starting P2P Server Example");

  try {
    // Create first server (the "hub")
    const server1 = createServer({
      port: 3001,
      dbPath: "./db-example-server1",
      peers: [], // No peers initially
    });

    // Create second server (connects to the first)
    const server2 = createServer({
      port: 3002,
      dbPath: "./db-example-server2",
      peers: ["http://localhost:3001"], // Connect to server1

      // Configure conflict resolution
      conflict: {
        defaultStrategy: "last-write-wins",
        pathStrategies: {
          users: "merge-fields", // Merge user objects
          settings: "first-write-wins", // Settings are stable once set
        },
      },
    });

    // Start both servers
    await server1.start();
    await server2.start();
    console.log("Both servers started successfully");

    // Allow connections to establish
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Test 1: Basic data synchronization
    console.log("\n=== Test 1: Basic Data Synchronization ===");

    // Server 1 writes data
    console.log("Server 1 storing greeting...");
    await server1.put("greetings/hello", {
      message: "Hello from Server 1!",
      timestamp: Date.now(),
    });

    // Wait for synchronization
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Server 2 reads the data
    console.log("Server 2 retrieving greeting...");
    const greeting = await server2.get("greetings/hello");
    console.log("Server 2 received:", greeting);

    // Test 2: Field merging conflict resolution
    console.log("\n=== Test 2: Field Merging Conflict Resolution ===");

    // Server 1 creates a user
    console.log("Server 1 creating user...");
    await server1.put("users/alice", {
      name: "Alice",
      email: "alice@example.com",
      role: "admin",
    });

    // Server 2 creates same user with different fields
    // In a real scenario, this might happen during a network partition
    console.log("Server 2 creating same user with different fields...");
    await server2.put("users/alice", {
      name: "Alice",
      phone: "555-1234",
      location: "New York",
    });

    // Wait for synchronization and conflict resolution
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Both servers should now have the merged user
    const user1 = await server1.get("users/alice");
    const user2 = await server2.get("users/alice");

    console.log("Server 1's view of user:", user1);
    console.log("Server 2's view of user:", user2);

    // Test 3: Subscriptions
    console.log("\n=== Test 3: Data Change Subscriptions ===");

    // Server 1 subscribes to changes
    console.log("Server 1 subscribing to notifications...");
    const unsubscribe = await server1.subscribe(
      "notifications",
      (value, path) => {
        console.log(`Server 1 received notification for ${path}:`, value);
      }
    );

    // Server 2 writes to notifications
    console.log("Server 2 creating notification...");
    await server2.put("notifications/alert", {
      title: "System Update",
      message: "A new version is available",
      severity: "info",
      timestamp: Date.now(),
    });

    // Wait for notification to trigger
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Unsubscribe
    unsubscribe();
    console.log("Server 1 unsubscribed from notifications");

    // Clean up and exit
    console.log("\n=== Cleaning up ===");
    await server1.close();
    await server2.close();
    console.log("Servers closed");
  } catch (error) {
    console.error("Error in example:", error);
  }
}

// Run the example
runExample();
