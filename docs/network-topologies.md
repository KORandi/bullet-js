# Bullet.js Network Topologies Implementation

This document provides a technical overview of how network topologies are implemented in Bullet.js, including the current capabilities, limitations, and recommended patterns for different network configurations.

## Understanding the Current Implementation

Bullet.js's networking layer is primarily implemented in `src/bullet-network.js` and `src/bullet-network-sync.js`. The current implementation provides a flexible WebSocket-based peer-to-peer communication system that can be configured to support various topologies, though these topologies are not explicitly defined as separate modes in the API.

### Core Network Features

The current networking implementation provides these key capabilities:

1. **WebSocket Server Mode**: Each Bullet instance can act as a WebSocket server, accepting connections from other peers
2. **Client Mode**: Each Bullet instance can connect to other peers via their WebSocket endpoints
3. **Peer Management**: Automatic tracking of connected peers, with reconnection attempts for configured peers
4. **Data Synchronization**: Mechanisms for full and partial data synchronization between peers
5. **Message Relaying**: Messages can be relayed between peers with TTL (Time-To-Live) controls

### How Topology is Configured

In the current implementation, network topology is implicitly defined by the pattern of peer connections rather than through explicit topology configuration. When initializing a Bullet instance, you specify:

```javascript
const bullet = new Bullet({
  server: true, // Whether this peer accepts connections
  port: 8765, // WebSocket server port (if server is true)
  peers: [
    // List of peers to connect to
    "ws://peer1.example.com:8765",
    "ws://peer2.example.com:8765",
  ],
  maxTTL: 32, // Maximum number of hops for relayed messages
});
```

The combination of these settings across multiple peers determines the effective network topology.

## Implementing Different Topologies

While the API doesn't explicitly support named topologies, you can implement various topologies by configuring your peers appropriately. Here's how to implement common topologies with the current code:

### Mesh Topology

In a mesh topology, every peer connects directly to every other peer. This provides the fastest propagation and highest redundancy, but requires more connections.

**Implementation:**

```javascript
// Peer 1
const peer1 = new Bullet({
  server: true,
  port: 8001,
  peers: ["ws://host2:8002", "ws://host3:8003"],
});

// Peer 2
const peer2 = new Bullet({
  server: true,
  port: 8002,
  peers: ["ws://host1:8001", "ws://host3:8003"],
});

// Peer 3
const peer3 = new Bullet({
  server: true,
  port: 8003,
  peers: ["ws://host1:8001", "ws://host2:8002"],
});
```

**Current Behavior:**

- Each peer will attempt to connect to all others in the `peers` array
- Bidirectional connections will be established
- Messages will be sent directly to all peers without intermediaries
- If a peer goes offline, others will attempt to reconnect periodically

### Star Topology

In a star topology, all peers connect to a central hub but not directly to each other.

**Implementation:**

```javascript
// Hub (central peer)
const hub = new Bullet({
  server: true,
  port: 8000,
  peers: [], // Hub doesn't initiate connections
});

// Spoke 1
const spoke1 = new Bullet({
  server: false, // Optional: can be true if you want bidirectional capability
  peers: ["ws://hub-host:8000"],
});

// Spoke 2
const spoke2 = new Bullet({
  server: false, // Optional: can be true if you want bidirectional capability
  peers: ["ws://hub-host:8000"],
});
```

**Current Behavior:**

- All data flows through the hub
- Messages propagate in a maximum of 2 hops
- If the hub goes down, spokes are disconnected from each other
- The hub becomes a potential bottleneck and single point of failure

### Chain Topology

In a chain topology, peers form a line with each connecting only to adjacent peers.

**Implementation:**

```javascript
// First peer in chain
const peer1 = new Bullet({
  server: true,
  port: 8001,
  peers: ["ws://host2:8002"], // Connect only to next peer
});

// Middle peer
const peer2 = new Bullet({
  server: true,
  port: 8002,
  peers: ["ws://host1:8001", "ws://host3:8003"], // Connect to previous and next
});

// Last peer in chain
const peer3 = new Bullet({
  server: true,
  port: 8003,
  peers: ["ws://host2:8002"], // Connect only to previous peer
});
```

**Current Behavior:**

- Data propagates linearly through the chain
- Maximum hop count depends on chain length
- Breaking a connection in the middle splits the network
- The `maxTTL` setting is important to ensure messages can reach the end of long chains

### Ring Topology

In a ring topology, peers form a closed loop with each connecting to two others.

**Implementation:**

```javascript
// Peer 1
const peer1 = new Bullet({
  server: true,
  port: 8001,
  peers: ["ws://host4:8004", "ws://host2:8002"], // Connect to "previous" and "next"
});

// Peer 2
const peer2 = new Bullet({
  server: true,
  port: 8002,
  peers: ["ws://host1:8001", "ws://host3:8003"],
});

// Peer 3
const peer3 = new Bullet({
  server: true,
  port: 8003,
  peers: ["ws://host2:8002", "ws://host4:8004"],
});

// Peer 4
const peer4 = new Bullet({
  server: true,
  port: 8004,
  peers: ["ws://host3:8003", "ws://host1:8001"],
});
```

**Current Behavior:**

- Data propagates bidirectionally around the ring
- Maximum hop count is half the number of peers in the ring
- One broken connection transforms the ring into a chain
- Two broken connections would split the network

### Bridge Topology

A bridge topology connects separate clusters through designated bridge nodes.

**Implementation:**

```javascript
// Cluster A: Peer 1 (bridge node)
const peerA1 = new Bullet({
  server: true,
  port: 8101,
  peers: [
    "ws://hostA2:8102", // Cluster A peer
    "ws://hostA3:8103", // Cluster A peer
    "ws://hostB1:8201", // Bridge to Cluster B
  ],
});

// Cluster A: Peer 2
const peerA2 = new Bullet({
  server: true,
  port: 8102,
  peers: ["ws://hostA1:8101", "ws://hostA3:8103"], // Only connect within cluster
});

// Cluster B: Peer 1 (bridge node)
const peerB1 = new Bullet({
  server: true,
  port: 8201,
  peers: [
    "ws://hostB2:8202", // Cluster B peer
    "ws://hostB3:8203", // Cluster B peer
    "ws://hostA1:8101", // Bridge to Cluster A
  ],
});

// Cluster B: Peer 2
const peerB2 = new Bullet({
  server: true,
  port: 8202,
  peers: ["ws://hostB1:8201", "ws://hostB3:8203"], // Only connect within cluster
});
```

**Current Behavior:**

- Data flows between clusters through the bridge nodes
- Bridge nodes can become bottlenecks
- If a bridge node fails, clusters become isolated
- TTL is particularly important to prevent message loops

## Implementation Details

### Message Propagation

Messages in Bullet.js propagate according to these rules:

1. When a peer updates data locally, it broadcasts the change to all its directly connected peers
2. Each peer receiving a message will:

   - Apply the update locally if it's new or has a higher vector clock
   - Relay the message to all other connected peers (except the source)
   - Decrement the TTL of the message before relaying

3. A message is not relayed if:
   - Its ID has been seen before (tracked in `processedMessages`)
   - Its TTL has reached zero
   - It came from the peer being considered

The `_relayMessage` method in `bullet-network.js` handles this logic:

```javascript
_relayMessage(message, sourcePeerId) {
  if (message.ttl !== undefined && message.ttl <= 0) {
    return;
  }

  const relayMessage = {
    ...message,
    id: message.id || this._generateId(),
    ttl: (message.ttl !== undefined ? message.ttl : this.options.maxTTL) - 1,
  };

  this.processedMessages.add(relayMessage.id);

  this.peers.forEach((_, peerId) => {
    if (peerId !== sourcePeerId) {
      this.sendToPeer(peerId, relayMessage);
    }
  });
}
```

### Vector Clocks for Conflict Resolution

Bullet.js uses vector clocks (`src/bullet-crt.js`) to manage data conflicts when changes propagate through the network. This is essential for ensuring consistency regardless of the network topology:

1. Each peer maintains a vector clock for every piece of data
2. When data changes, the peer increments its own logical clock
3. When data is synced, vector clocks are compared to determine the causal relationship
4. Conflicts are resolved consistently using the CRT algorithm

### Data Synchronization

The `BulletNetworkSync` class handles data synchronization between peers:

1. Initial sync occurs when peers first connect
2. Periodic syncs can occur at configured intervals
3. Manual syncs can be requested with `bullet.network.requestSync()`
4. Sync operations can be full or target specific paths

Data is synchronized in chunks to handle large datasets efficiently:

```javascript
_generateAndSendSyncData(peerId, requestId, since, partial, paths) {
  // Prepare the data
  const entries = this._collectSyncData(since, partial, paths);
  const totalEntries = entries.length;
  const chunks = this._chunkSyncData(entries);

  // Send each chunk
  chunks.forEach((chunk, index) => {
    this.network.sendToPeer(peerId, {
      type: "sync-chunk",
      id: this._generateId(),
      requestId: requestId,
      chunkIndex: index,
      totalChunks: chunks.length,
      entries: chunk,
      isLastChunk: index === chunks.length - 1,
    });
  });
}
```

## Limitations of the Current Implementation

The current networking implementation has some limitations:

1. **No Explicit Topology API**: There's no API to specify a named topology or validate that peers are configured correctly for a specific topology

2. **No Automatic Peer Discovery**: The documentation in `network-topologies.md` describes peer discovery mechanisms, but these aren't implemented in the current code

3. **No Topology-Specific Optimizations**: The code doesn't have specific optimizations for different topologies (e.g., specialized message routing for star or ring topologies)

4. **Limited Diagnostic Tools**: There are basic tools for monitoring sync status but no comprehensive topology visualization or analysis

5. **No Route Optimization**: Messages are relayed to all peers (except the source) rather than using intelligent routing based on network topology

## Best Practices for Working with the Current Implementation

Based on the current implementation, here are best practices for using network topologies in Bullet.js:

### 1. Choose Appropriate TTL Values

The `maxTTL` option is critical for controlling message propagation:

```javascript
const bullet = new Bullet({
  maxTTL: 32, // Default is 32 hops
});
```

Best practices:

- For mesh networks: A low TTL (2-3) is usually sufficient
- For star networks: TTL should be at least 2
- For chain/ring: TTL should be at least the length of the chain or half the ring
- For complex topologies: Higher TTL values ensure messages reach all nodes

### 2. Monitor Network Health

Use the sync statistics to monitor network health:

```javascript
// Get sync statistics
const stats = bullet.network.getSyncStats();
console.log("Network status:", stats);

// Listen for sync events
bullet.on("sync:complete", (data) => {
  console.log(`Completed sync with ${data.peerId} in ${data.duration}ms`);
});

bullet.on("sync:failed", (data) => {
  console.error(`Sync with ${data.peerId} failed: ${data.reason}`);
});
```

### 3. Implement Connection Authentication

Use the connection handler to implement authentication for security:

```javascript
const bullet = new Bullet({
  connectionHandler: (req, socket, remotePeerId) => {
    const token = req.headers["x-auth-token"];
    if (!validateToken(token)) {
      console.warn(`Rejected unauthorized connection from ${remotePeerId}`);
      socket.close();
      return false;
    }
    return true;
  },

  prepareConnectionHeaders: (peerUrl) => {
    return {
      "x-auth-token": generateToken(),
    };
  },
});
```

### 4. Implement Server Redundancy

For star topologies, implement redundant hub servers to avoid single points of failure:

```javascript
// Primary hub
const primaryHub = new Bullet({
  server: true,
  port: 8001,
});

// Backup hub (with connection to primary)
const backupHub = new Bullet({
  server: true,
  port: 8002,
  peers: ["ws://primary-host:8001"],
});

// Clients connect to both hubs
const client = new Bullet({
  peers: ["ws://primary-host:8001", "ws://backup-host:8002"],
});
```

### 5. Implement Manual Peer Discovery

Until automatic peer discovery is implemented, you can implement manual discovery:

```javascript
// Setup a registry peer
const registry = new Bullet({
  server: true,
  port: 9000,
});

// Store active peers
registry.get("peers").put({});

// Peers register themselves
function registerPeer(myId, myUrl) {
  registry.get(`peers/${myId}`).put({
    url: myUrl,
    lastSeen: Date.now(),
  });
}

// Peers discover others
function discoverPeers() {
  registry.get("peers").on((peerList) => {
    const activePeers = Object.values(peerList)
      .filter((p) => p.lastSeen > Date.now() - 300000) // Active in last 5 mins
      .map((p) => p.url);

    // Connect to discovered peers
    for (const url of activePeers) {
      bullet.network.connectToPeer(url);
    }
  });
}
```

## Future Improvements

Based on the documentation and current implementation, these improvements would enhance the network topology capabilities:

1. **Explicit Topology Configuration**: Add a `topology` option with predefined configurations:

```javascript
const bullet = new Bullet({
  topology: "star",
  topologyOptions: {
    role: "hub", // or "spoke"
    redundancy: true,
  },
});
```

2. **Automatic Peer Discovery**: Implement the peer discovery mechanisms described in the documentation:

```javascript
const bullet = new Bullet({
  discovery: true,
  discoveryMethod: "registry",
  registryUrl: "ws://registry.example.com:9000",
});
```

3. **Intelligent Message Routing**: Add routing optimizations based on the network topology:

```javascript
const bullet = new Bullet({
  routing: "optimized", // vs "broadcast"
  routingCacheSize: 1000,
});
```

4. **Topology Visualization**: Add methods to visualize the current network topology:

```javascript
const topologyMap = bullet.network.getTopologyMap();
```

These improvements would align the implementation more closely with the comprehensive capabilities described in the documentation.

## Conclusion

The current Bullet.js network implementation provides a flexible foundation for building various network topologies through configuration. While it lacks explicit topology-specific APIs and optimizations, you can successfully implement mesh, star, chain, ring, and bridge topologies by configuring peer connections appropriately.

By understanding the core message propagation and synchronization mechanisms, you can make informed decisions about how to structure your Bullet.js network for your specific needs.

## Next Steps

Now that you understand the current network topology implementation in Bullet.js, you might want to explore:

- [Data Synchronization](/docs/synchronization.md) - Learn more about the sync mechanisms between peers
- [Conflict Resolution](/docs/conflict-resolution.md) - Understand how data conflicts are handled in distributed setups
- [Performance Optimization](/docs/performance.md) - Strategies to optimize your Bullet.js network for different loads
- [Security Guidelines](/docs/security.md) - Learn about securing your distributed Bullet.js databases
- [Custom Middleware](/docs/middleware.md) - Implement custom middleware for network-aware applications
