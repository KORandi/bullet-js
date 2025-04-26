# Bullet.js

A distributed, real-time graph database with peer-to-peer synchronization capabilities.

## Overview

Bullet.js is a lightweight yet powerful distributed database designed for building collaborative applications that work both online and offline. Heavily inspired by Gun.js, Bullet.js offers a clean, intuitive API with a focus on modularity, performance, and ease of use.

## Features

- **Distributed Architecture**: Peer-to-peer data synchronization with automatic conflict resolution
- **Real-time Collaboration**: Instant data updates across connected peers
- **Offline-First**: Continue working without an internet connection
- **Modular Design**: Use only the components you need
- **Validation**: Schema-based data validation to ensure data integrity
- **Query System**: Index and filter data efficiently
- **Middleware**: Customize behavior with hooks for reads and writes
- **Serialization**: Import/export data in various formats (JSON, CSV, XML)
- **Persistence**: Optional storage with encryption support
- **Conflict Resolution**: Built-in HAM (Hash-Array-Mapped) algorithm for conflict resolution

## Installation

```bash
npm install bullet-js
```

## Quick Start

```javascript
const Bullet = require("bullet-js");

// Initialize a Bullet instance
const bullet = new Bullet({
  peers: ["ws://peer-server.example.com"],
  storage: true,
  storagePath: "./data",
});

// Store data
bullet.get("users/alice").put({
  name: "Alice",
  email: "alice@example.com",
  role: "admin",
});

// Listen for updates
bullet.get("users/alice").on((userData) => {
  console.log("User data updated:", userData);
});

// Query data
const admins = bullet.equals("users", "role", "admin");
console.log(
  "Admin users:",
  admins.map((node) => node.value().name)
);
```

## Configuration

```javascript
const bullet = new Bullet({
  // Networking
  peers: [], // Array of peer WebSocket URLs
  server: true, // Whether to run a WebSocket server
  port: 8765, // WebSocket server port

  // Storage
  storage: true, // Enable persistence
  storageType: "file", // 'file', 'memory', or custom storage class
  storagePath: "./.bullet", // Path for file storage
  encrypt: false, // Enable storage encryption
  encryptionKey: null, // Encryption key

  // Features
  enableIndexing: true, // Enable query capabilities
  enableValidation: true, // Enable schema validation
  enableMiddleware: true, // Enable middleware system
  enableSerializer: true, // Enable serialization capabilities
});
```

## Core Concepts

### Graph Structure

Data in Bullet.js is organized as a graph, where each node can be accessed by a path.

```javascript
// Create nested data
bullet.get("users/bob/profile").put({
  age: 28,
  location: "New York",
});

// Access nested data
bullet.get("users/bob/profile/age").value(); // 28
```

### Real-time Subscriptions

Subscribe to changes at any node in the graph.

```javascript
bullet.get("users").on((users) => {
  console.log("Users updated:", users);
});
```

### Validation

Define schemas to validate data before saving.

```javascript
bullet.defineSchema("user", {
  type: "object",
  required: ["username", "email"],
  properties: {
    username: { type: "string", min: 3, max: 20 },
    email: { type: "string", format: "email" },
    age: { type: "integer", min: 13 },
  },
});

bullet.applySchema("users", "user");
```

### Querying

Create indices for faster queries and filter data.

```javascript
bullet.index("users", "age");
bullet.range("users", "age", 20, 30);
bullet.filter("users", (user) => user.active === true);
```

### Middleware

Customize behavior with middleware hooks.

```javascript
bullet.beforePut((path, data) => {
  // Add timestamp to all writes
  return {
    ...data,
    updatedAt: new Date().toISOString(),
  };
});
```

## Network Topologies

Bullet.js supports various network topologies:

- **Mesh**: All peers connect to each other
- **Star**: All peers connect to a central peer
- **Chain**: Peers form a linear chain of connections
- **Bridge**: Separate clusters connected by bridge nodes

## Examples

Check out the examples directory for more detailed usage:

- Basic usage (`examples/bullet-example.js`)
- Queries (`examples/bullet-query-example.js`)
- Validation (`examples/bullet-validation-example.js`)
- Middleware (`examples/bullet-middleware-example.js`)
- Serialization (`examples/bullet-serializer-example.js`)
- Network topologies:
  - Chain (`examples/bullet-chain-example.js`)
  - Circle (`examples/bullet-circle-network-example.js`)
  - Bridge (`examples/bullet-bridge-example.js`)

## License

MIT
