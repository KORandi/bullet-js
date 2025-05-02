# Quick Start

Welcome to the Bullet.js documentation! This page will give you an introduction to the 80% of Bullet.js concepts that you'll use on a daily basis.

## You will learn

- How to create a Bullet.js database
- How to store and retrieve data
- How to subscribe to changes
- How to connect to other peers
- How to use basic queries

## Creating your first Bullet.js database

Bullet.js is a distributed graph database that allows you to synchronize data across clients. Let's create a simple database:

```javascript
// Import Bullet.js
const Bullet = require("bullet-js");

// Create a new Bullet instance
const bullet = new Bullet();

console.log("Database created!");
```

You now have a fully functional database, but it's not doing much yet. Let's add some data.

## Adding data to your database

Bullet.js organizes data in a graph structure where each piece of data is accessed via a path. To store data, use the `get()` method to navigate to a path, and then `put()` to store data:

```javascript
// Store a user object
bullet.get("users/alice").put({
  name: "Alice",
  email: "alice@example.com",
  role: "admin",
  createdAt: new Date().toISOString(),
});

// Store another user
bullet.get("users/bob").put({
  name: "Bob",
  email: "bob@example.com",
  role: "user",
  createdAt: new Date().toISOString(),
});
```

## Reading data from your database

To read data, use the `get()` method to navigate to a path, and then `value()` to retrieve the current value:

```javascript
// Get a user by their ID
const alice = bullet.get("users/alice").value();
console.log("User data:", alice);

// Access nested properties directly
const aliceName = bullet.get("users/alice/name").value();
console.log("User name:", aliceName);
```

## Subscribing to data changes

One of Bullet.js's most powerful features is the ability to react to data changes in real-time. Use the `on()` method to subscribe to changes:

```javascript
// Subscribe to changes for a specific user
bullet.get("users/alice").on((userData) => {
  console.log("Alice data updated:", userData);
});

// Subscribe to all users
bullet.get("users").on((usersData) => {
  console.log("All users updated:", usersData);
  console.log("User count:", Object.keys(usersData).length);
});

// Now when we update Alice's data, both callbacks will fire
bullet.get("users/alice").put({
  name: "Alice Smith",
  email: "alice@example.com",
  role: "admin",
  updatedAt: new Date().toISOString(),
});
```

## Connecting to peers

To make your database distributed, you can connect to other peers:

```javascript
// Create a Bullet instance that connects to other peers
const bullet = new Bullet({
  peers: ["ws://peer1.example.com", "ws://peer2.example.com"],
  server: true, // Run a WebSocket server for other peers to connect to
  port: 8765, // WebSocket server port
});

// When data is updated on any peer, all connected peers will automatically sync
bullet.get("shared/counter").put(1);

// On another peer, you would see the update
bullet.get("shared/counter").on((value) => {
  console.log("Counter value:", value);
});
```

## Querying data

Bullet.js provides several methods for querying data:

```javascript
// First, create an index for faster queries
bullet.index("users", "role");

// Find all users with a specific role
const admins = bullet.equals("users", "role", "admin");
console.log(
  "Admin users:",
  admins.map((node) => node.value().name)
);

// Create an index for another field
bullet.index("products", "price");

// Find products in a price range
const affordableProducts = bullet.range("products", "price", 10, 50);
console.log(
  "Affordable products:",
  affordableProducts.map((node) => node.value().name)
);

// Use a custom filter function
const activeUsers = bullet.filter(
  "users",
  (user) =>
    user.status === "active" &&
    user.lastLogin > new Date(Date.now() - 86400000).toISOString()
);
console.log(
  "Active users in the last 24 hours:",
  activeUsers.map((node) => node.value().name)
);
```

## Enabling persistence

By default, Bullet.js data exists only in memory. To persist data between sessions:

```javascript
const bullet = new Bullet({
  storage: true,
  storagePath: "./data", // Where to store the data
  encrypt: true, // Optional: encrypt the stored data
  encryptionKey: "my-secret-key",
});

// Data will now be automatically saved to disk
bullet.get("important/data").put({
  value: "This will persist across application restarts",
});
```

## Try Bullet.js

Now you know the basics of Bullet.js! Here's a complete example that brings everything together:

```javascript
const Bullet = require("bullet-js");

// Initialize a Bullet instance with storage and networking
const bullet = new Bullet({
  server: true,
  port: 8765,
  storage: true,
  storagePath: "./bullet-data",
});

// Create an index for queries
bullet.index("users", "role");

// Add some initial data
bullet.get("users/alice").put({
  name: "Alice",
  email: "alice@example.com",
  role: "admin",
  createdAt: new Date().toISOString(),
});

bullet.get("users/bob").put({
  name: "Bob",
  email: "bob@example.com",
  role: "user",
  createdAt: new Date().toISOString(),
});

// Subscribe to changes
bullet.get("users").on((users) => {
  console.log("Users updated:", Object.keys(users).length);
});

// Run a query
const admins = bullet.equals("users", "role", "admin");
console.log(
  "Admin users:",
  admins.map((node) => node.value().name)
);

// Listen for Ctrl+C to gracefully shut down
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await bullet.close();
  process.exit(0);
});

console.log("Bullet.js server running on port 8765");
```

## What's next?

In the next sections, you'll learn about:

- [Schema validation](/docs/validation.md) to ensure data integrity
- [Middleware](/docs/middleware.md) for customizing database behavior
- [Conflict resolution](/docs/conflict-resolution.md) for handling concurrent updates
- [Advanced queries](/docs/querying.md) for more complex data operations
- [Network topologies](/docs/network-topologies.md) for different distributed setups
- [Custom storage adapters](/docs/storage-adapters.md) for specialized persistence needs
