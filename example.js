/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Debug example - Run this to test synchronization
 *
 * Save this as debug.js and run with: node debug.js
 */

const P2PServer = require("./src/server");

// Create three server instances
const server1 = new P2PServer({
  port: 3001,
  dbPath: "./db-server1",
  peers: [],
});

const server2 = new P2PServer({
  port: 3002,
  dbPath: "./db-server2",
  peers: ["http://localhost:3001"],
});

const server3 = new P2PServer({
  port: 3003,
  dbPath: "./db-server3",
  peers: ["http://localhost:3001", "http://localhost:3002"],
});

// Wait for connections to be established
setTimeout(async () => {
  try {
    console.log("=== Server 1 puts data ===");
    await server1.put("users/user1", { name: "Alice", age: 30 });
    console.log("Server 1 put users/user1");

    // Wait for data to sync
    await new Promise((resolve) => setTimeout(resolve, 500));

    console.log("=== Server 2 reads data ===");
    const user1FromServer2 = await server2.get("users/user1");
    console.log("Server 2 got users/user1:", user1FromServer2);

    console.log("=== Server 2 puts data ===");
    await server2.put("products/product1", { name: "Laptop", price: 999 });
    console.log("Server 2 put products/product1");

    // Wait for data to sync
    await new Promise((resolve) => setTimeout(resolve, 500));

    console.log("=== Server 3 reads data ===");
    const user1FromServer3 = await server3.get("users/user1");
    console.log("Server 3 got users/user1:", user1FromServer3);

    const product1FromServer3 = await server3.get("products/product1");
    console.log("Server 3 got products/product1:", product1FromServer3);

    console.log("=== Server 3 updates data ===");
    await server3.put("products/product1", {
      name: "Laptop",
      price: 899,
      onSale: true,
    });
    console.log("Server 3 updated products/product1");

    // Wait for data to sync
    await new Promise((resolve) => setTimeout(resolve, 500));

    console.log("=== Server 1 reads updated data ===");
    const updatedProduct = await server1.get("products/product1");
    console.log("Server 1 got updated products/product1:", updatedProduct);

    // Test subscriptions
    console.log("=== Server 1 subscribes to user changes ===");
    const unsubscribe = await server1.subscribe("users", (value, path) => {
      console.log(`Server 1 received update for users: ${path}`, value);
    });

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 500));

    console.log("=== Server 2 updates subscribed data ===");
    await server2.put("users/user2", { name: "Bob", age: 25 });
    console.log("Server 2 put users/user2");

    // Wait for data to sync and subscription to trigger
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Unsubscribe
    unsubscribe();
    console.log("Server 1 unsubscribed from users");

    // Test scanning
    console.log("=== Server 3 scans products ===");
    const productsFromServer3 = await server3.scan("products");
    console.log("Server 3 products scan result:", productsFromServer3);

    console.log("=== Closing servers ===");
    // Close all servers
    await Promise.all([server1.close(), server2.close(), server3.close()]);

    console.log("All servers closed");
    process.exit(0);
  } catch (error) {
    console.error("Error in debug example:", error);
    process.exit(1);
  }
}, 2000);

// Start all servers
server1.start();
server2.start();
server3.start();
