# Bullet.js

A distributed graph database inspired by Gun.js, designed for simplicity, performance, and flexibility.

## Overview

Bullet.js is a modular, real-time, distributed graph database that enables collaborative applications with offline capability. It provides a clean and intuitive API for storing, retrieving, and synchronizing data across peers, with built-in support for validation, querying, middleware, and more.

## Key Features

- **Distributed Architecture**: Peer-to-peer synchronization with automatic conflict resolution
- **Modular Design**: Use only the components you need
- **Validation**: Schema-based data validation to ensure data integrity
- **Query System**: Fast lookups with indexing and filter capabilities
- **Middleware**: Customize behavior with middleware hooks
- **Serialization**: Import/export data in various formats (JSON, CSV, XML)
- **Persistence**: Data storage with optional encryption
- **Event System**: Subscribe to changes in real-time

## Installation

```bash
npm install bullet-js
```

## Basic Usage

```javascript
const Bullet = require("bullet-js");

// Initialize a Bullet instance
const bullet = new Bullet({
  peers: ["ws://peer1.example.com", "ws://peer2.example.com"],
  storage: true,
  storagePath: "./data",
});

// Store data
bullet.get("users/alice").put({
  name: "Alice",
  email: "alice@example.com",
  role: "admin",
});

// Retrieve data
bullet.get("users/alice").on((userData) => {
  console.log("User data:", userData);
});

// Query data
const admins = bullet.equals("users", "role", "admin");
console.log(
  "Admin users:",
  admins.map((node) => node.value().name)
);

// Use middleware
bullet.beforePut((path, data) => {
  console.log(`Data being written to ${path}:`, data);
  return data;
});
```

## API Reference

### Core API

- `new Bullet(options)`: Create a new Bullet instance
- `bullet.get(path)`: Access a node at the specified path
- `bullet.close()`: Close connections and clean up resources

### Node API

- `node.put(data)`: Write data to the node
- `node.value()`: Get the current value of the node
- `node.on(callback)`: Subscribe to changes on the node
- `node.off(callback)`: Unsubscribe from changes
- `node.get(childPath)`: Access a child node
- `node.delete()`: Delete the node

### Query API

- `bullet.index(path, field)`: Create an index for faster queries
- `bullet.equals(path, field, value)`: Find nodes with a specific value
- `bullet.range(path, field, min, max)`: Find nodes within a value range
- `bullet.filter(path, filterFn)`: Apply a custom filter function
- `bullet.find(path, predicateFn)`: Find the first matching node

### Validation API

- `bullet.defineSchema(name, schema)`: Define a data schema
- `bullet.applySchema(path, schemaName)`: Apply a schema to a path
- `bullet.validate(schemaName, data)`: Validate data against a schema
- `bullet.onValidationError(type, handler)`: Register validation error handler

### Middleware API

- `bullet.use(operation, middleware)`: Register middleware for an operation
- `bullet.beforePut(middleware)`: Register middleware before data writes
- `bullet.afterPut(middleware)`: Register middleware after data writes
- `bullet.onGet(middleware)`: Register middleware for data reads
- `bullet.afterGet(middleware)`: Register middleware after data reads
- `bullet.on(event, listener)`: Register event listener

### Serialization API

- `bullet.exportToJSON(path, options)`: Export data to JSON
- `bullet.importFromJSON(json, targetPath, options)`: Import data from JSON
- `bullet.exportToCSV(path, options)`: Export data to CSV
- `bullet.importFromCSV(csv, targetPath, options)`: Import data from CSV
- `bullet.exportToXML(path, options)`: Export data to XML
- `bullet.importFromXML(xml, targetPath, options)`: Import data from XML

## Configuration Options

```javascript
const bullet = new Bullet({
  // Networking options
  peers: [], // Array of peer WebSocket URLs
  server: true, // Whether to run a WebSocket server
  port: 8765, // WebSocket server port

  // Storage options
  storage: true, // Enable persistence
  storagePath: "./.bullet", // Path for persistent storage
  encrypt: false, // Enable storage encryption
  encryptionKey: null, // Encryption key

  // Feature toggles
  enableIndexing: true, // Enable query capabilities
  enableValidation: true, // Enable schema validation
  enableMiddleware: true, // Enable middleware system
  enableSerializer: true, // Enable serialization capabilities
});
```

## Examples

Check out the example scripts in the repository:

- `bullet-query-example.js`: Demonstrates query capabilities
- `bullet-validation-example.js`: Shows schema validation
- `bullet-middleware-example.js`: Illustrates middleware usage
- `bullet-serializer-example.js`: Demonstrates data serialization

Run examples with:

```bash
npm run examples:query
npm run examples:validation
npm run examples:middleware
npm run examples:serializer
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
