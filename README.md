A little bit outdated. I am going to update as soon as possible (togheter with examples). However I keep tests up to date, so you can find some inspiration there

# P2P Data Synchronization Server

A lightweight, distributed peer-to-peer data synchronization server built with Node.js. This system allows multiple nodes to maintain synchronized data across a partially connected network, with automatic data propagation, subscriptions, and querying capabilities.

## Features

- **Peer-to-peer architecture**: No central server required
- **Automatic data synchronization**: Changes propagate throughout the network
- **Conflict resolution strategies**: Multiple ways to handle concurrent updates
- **Vector clock causality tracking**: Accurately detect concurrent modifications
- **Subscription system**: Get notified when data changes
- **Multi-hop forwarding**: Updates reach all nodes even in partially connected networks
- **Path-based data model**: Organize data hierarchically using path prefixes
- **Scan operations**: Query data based on path prefixes
- **WebSocket-based communication**: Real-time updates between peers
- **HTTP API**: Simple REST interface for external integrations

## Project Structure

The project has been restructured for better organization and separation of concerns:

```
p2p-server/
├── src/
│   ├── core/                     # Core functionality
│   │   ├── server.js             # Main server class
│   │   ├── database-manager.js   # Database operations
│   │   └── config.js             # Configuration defaults and validation
│   │
│   ├── network/                  # Network layer
│   │   ├── socket-manager.js     # WebSocket connections
│   │   ├── api-routes.js         # HTTP API routes
│   │   └── message-handlers.js   # Message processing logic
│   │
│   ├── sync/                     # Synchronization logic
│   │   ├── sync-manager.js       # Synchronization orchestration
│   │   ├── vector-clock.js       # Vector clock implementation
│   │   ├── conflict-resolver.js  # Conflict resolution strategies
│   │   └── anti-entropy.js       # Anti-entropy process
│   │
│   └── index.js                  # Main entry point
│
├── examples/                     # Example implementations
│   ├── basic-example.js          # Simple 2-peer example
│   └── complex-network.js        # Multi-node network example
```

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/p2p-server.git
cd p2p-server

# Install dependencies
npm install
```

## Quick Start

Create a new file with the following code:

```javascript
const { createServer } = require("./src");

// Create two server instances
const server1 = createServer({
  port: 3001,
  dbPath: "./db-server1",
  peers: [], // No peers initially
});

const server2 = createServer({
  port: 3002,
  dbPath: "./db-server2",
  peers: ["http://localhost:3001"], // Connect to server1
});

// Start both servers
async function start() {
  await server1.start();
  await server2.start();

  // Store data on server1
  await server1.put("test/key", { message: "Hello P2P World!" });

  // Wait for synchronization
  setTimeout(async () => {
    // Retrieve data from server2
    const data = await server2.get("test/key");
    console.log("Data synchronized:", data);

    // Clean up
    await server1.close();
    await server2.close();
  }, 1000);
}

start();
```

Run the example:

```bash
node your-file.js
```

## API Reference

### Creating a Server

```javascript
const { createServer } = require("p2p-server");

const server = createServer({
  port: 3000, // HTTP port to listen on
  dbPath: "./db", // Path for the LevelDB database
  peers: ["http://..."], // URLs of peers to connect to

  // Optional advanced configuration
  sync: {
    antiEntropyInterval: 60000, // Anti-entropy sync interval (ms)
    maxMessageAge: 300000, // Time to keep processed messages (ms)
    maxVersions: 10, // Maximum versions to keep in history
  },

  conflict: {
    defaultStrategy: "last-write-wins", // Default conflict resolution
    pathStrategies: {
      // Per-path strategies
      users: "merge-fields",
      settings: "first-write-wins",
    },
  },
});
```

### Basic Operations

```javascript
// Start the server
await server.start();

// Store data
await server.put("users/user1", { name: "Alice", age: 30 });

// Retrieve data
const user = await server.get("users/user1");

// Delete data
await server.del("users/user1");

// Scan data by prefix
const users = await server.scan("users/");

// Subscribe to changes
const unsubscribe = await server.subscribe("users", (value, path) => {
  console.log(`Data at ${path} changed to:`, value);
});

// Later, unsubscribe
unsubscribe();

// Close the server
await server.close();
```

### Conflict Resolution Strategies

The system provides multiple built-in conflict resolution strategies:

1. **last-write-wins**: Uses timestamps to determine the winner. The update with the newer timestamp wins.

2. **first-write-wins**: Opposite of last-write-wins. The update with the older timestamp wins. Useful for configuration data that should be stable once set.

3. **merge-fields**: For object values, merges fields from both updates. For fields present in both objects, it uses the one with the newer timestamp.

4. **custom**: Use a custom resolver function for complex scenarios.

Example of setting conflict strategies:

```javascript
// Set strategy during server creation
const server = createServer({
  // ...other options
  conflict: {
    defaultStrategy: "last-write-wins",
    pathStrategies: {
      users: "merge-fields",
      settings: "first-write-wins",
      inventory: "custom",
    },
  },
});

// Register a custom resolver
server.registerConflictResolver("inventory", (path, localData, remoteData) => {
  // Custom conflict resolution logic
  // Example: take the minimum inventory level to be safe
  const minStock = Math.min(localData.value.stock, remoteData.value.stock);

  // Use the newer timestamp for the result
  const result =
    localData.timestamp >= remoteData.timestamp
      ? { ...localData }
      : { ...remoteData };

  // Override with minimum stock
  result.value = { ...result.value, stock: minStock };

  return result;
});
```

## Architecture Components

### P2PServer

The main server class that coordinates the other components and provides the public API.

### SocketManager

Handles peer connections, manages sockets, and coordinates message passing between peers.

### SyncManager

Manages data synchronization, processes updates, handles subscriptions, and coordinates conflict resolution.

### DatabaseManager

Handles persistence using LevelDB, including storing, retrieving, and scanning data.

### VectorClock

Implements vector clocks for causality tracking between nodes.

### ConflictResolver

Handles detection and resolution of concurrent updates with configurable strategies.

### AntiEntropy

Implements periodic synchronization to ensure data consistency, even when normal message propagation fails.

## REST API Endpoints

The server automatically sets up these HTTP endpoints:

- `GET /api/:path(*)` - Get data at path
- `PUT /api/:path(*)` - Store data at path
- `DELETE /api/:path(*)` - Delete data at path
- `GET /api/scan/:prefix(*)` - Scan data with prefix
- `GET /api/history/:path(*)` - Get version history for path
- `GET /api/status` - Get server status and vector clock info

## Running the Examples

The project includes several examples to demonstrate different features:

```bash
# Basic example with two nodes
node examples/basic-example.js

# Advanced example with complex network topology
node examples/complex-network.js
```

## License

MIT
