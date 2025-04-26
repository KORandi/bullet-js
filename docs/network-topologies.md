# Network Topologies

Bullet.js supports various network topologies for distributed data synchronization. This guide explains the different topologies you can implement and their trade-offs, helping you choose the right architecture for your application.

## You will learn

- What network topologies are available in Bullet.js
- How to implement different topologies
- The advantages and disadvantages of each topology
- How data propagates through different network configurations
- Best practices for designing resilient distributed systems

## Understanding Network Topologies

A network topology defines how nodes (peers) in a distributed system are connected to each other. The topology affects important characteristics like:

- Data propagation speed
- Network resilience
- Resource usage
- Scalability
- Peer discovery

## Basic Topology Concepts

Before diving into specific topologies, let's understand some core concepts:

### Peer Connections

In Bullet.js, peers connect via WebSockets:

```javascript
// Create a Bullet instance that can receive connections
const serverBullet = new Bullet({
  server: true, // Enable WebSocket server
  port: 8765, // WebSocket server port
});

// Create a Bullet instance that connects to other peers
const clientBullet = new Bullet({
  peers: ["ws://server.example.com:8765"], // Connect to a remote peer
});
```

### Bidirectional Sync

Connections between peers are bidirectional - data flows in both directions:

```javascript
// On Server
serverBullet.get("shared/counter").put(1);

// On Client
clientBullet.get("shared/counter").on((value) => {
  console.log("Counter value:", value); // 1
});

// Client can also update data
clientBullet.get("shared/counter").put(2);

// Server will receive the update
serverBullet.get("shared/counter").on((value) => {
  console.log("Counter value:", value); // 2
});
```

### Hop Count and TTL

When data propagates through a network, the hop count tracks how many peers it has passed through:

```javascript
// Set a maximum time-to-live (TTL) for messages
const bullet = new Bullet({
  maxTTL: 32, // Maximum hops for data propagation
});
```

## Mesh Topology

In a mesh topology, each peer connects directly to every other peer. This provides the fastest data propagation but requires the most connections.

### Implementing a Mesh Topology

```javascript
// Create 3 peers in a mesh
const peer1 = new Bullet({
  server: true,
  port: 8001,
  peers: ["ws://localhost:8002", "ws://localhost:8003"],
});

const peer2 = new Bullet({
  server: true,
  port: 8002,
  peers: ["ws://localhost:8001", "ws://localhost:8003"],
});

const peer3 = new Bullet({
  server: true,
  port: 8003,
  peers: ["ws://localhost:8001", "ws://localhost:8002"],
});
```

### Advantages

- Fastest data propagation (1-hop maximum)
- High redundancy and fault tolerance
- No single point of failure

### Disadvantages

- Connection count grows quadratically with peers (n × (n-1) / 2)
- Resource intensive for large networks
- Not suitable for networks with hundreds of peers

### Best for

- Small to medium networks (up to ~50 peers)
- Applications requiring real-time synchronization
- High-availability systems

## Star Topology

In a star topology, all peers connect to a central hub, but not directly to each other. Data propagates through the central node.

### Implementing a Star Topology

```javascript
// Central hub
const hub = new Bullet({
  server: true,
  port: 8000,
});

// Spoke peers connect only to the hub
const peer1 = new Bullet({
  peers: ["ws://localhost:8000"],
});

const peer2 = new Bullet({
  peers: ["ws://localhost:8000"],
});

const peer3 = new Bullet({
  peers: ["ws://localhost:8000"],
});

// Data flows through the hub
peer1.get("shared/data").put("Hello from peer1");
// Hub receives and relays to peer2 and peer3
```

### Advantages

- Simple to implement and manage
- Efficient connection count (n connections for n peers)
- Centralized control and monitoring

### Disadvantages

- Single point of failure (the hub)
- Maximum 2-hop propagation delay
- Hub can become a bottleneck

### Best for

- Client-server applications
- Controlled environments
- Applications with a natural central authority

## Chain Topology

In a chain topology, peers form a line where each peer connects only to its adjacent peers. Data flows through the chain.

### Implementing a Chain Topology

```javascript
// Create a 5-node chain
const peer1 = new Bullet({
  server: true,
  port: 8001,
  peers: ["ws://localhost:8002"], // Connect only to next peer
});

const peer2 = new Bullet({
  server: true,
  port: 8002,
  peers: ["ws://localhost:8001", "ws://localhost:8003"], // Connect to previous and next
});

const peer3 = new Bullet({
  server: true,
  port: 8003,
  peers: ["ws://localhost:8002", "ws://localhost:8004"], // Connect to previous and next
});

const peer4 = new Bullet({
  server: true,
  port: 8004,
  peers: ["ws://localhost:8003", "ws://localhost:8005"], // Connect to previous and next
});

const peer5 = new Bullet({
  server: true,
  port: 8005,
  peers: ["ws://localhost:8004"], // Connect only to previous peer
});
```

### Advantages

- Minimal connection count (2 connections per peer)
- Simple structure
- Good for pipeline processing

### Disadvantages

- Slow propagation (up to n-1 hops for n peers)
- Vulnerable to disconnections
- High dependency on intermediate nodes

### Best for

- Sequential data processing
- Environments with limited connection capacity
- Linear network topologies (e.g., sensor arrays)

## Ring Topology

In a ring topology, peers form a circle with each peer connecting to exactly two others, forming a closed loop.

### Implementing a Ring Topology

```javascript
// Create a 4-node ring
const peer1 = new Bullet({
  server: true,
  port: 8001,
  peers: ["ws://localhost:8004", "ws://localhost:8002"], // Connect to previous and next
});

const peer2 = new Bullet({
  server: true,
  port: 8002,
  peers: ["ws://localhost:8001", "ws://localhost:8003"], // Connect to previous and next
});

const peer3 = new Bullet({
  server: true,
  port: 8003,
  peers: ["ws://localhost:8002", "ws://localhost:8004"], // Connect to previous and next
});

const peer4 = new Bullet({
  server: true,
  port: 8004,
  peers: ["ws://localhost:8003", "ws://localhost:8001"], // Connect to previous and next
});
```

### Advantages

- Even distribution of connections (2 per peer)
- No endpoints (closed loop)
- More resilient than a chain

### Disadvantages

- Data propagation can still be slow (up to n/2 hops)
- Requires careful management of peer connections

### Best for

- Distributed processing with no central authority
- Systems where each peer has similar responsibilities
- Applications needing redundancy with minimal connections

## Bridge Topology

In a bridge topology, separate clusters (e.g., mesh networks) are connected by bridge nodes that maintain connections between clusters.

### Implementing a Bridge Topology

```javascript
// Cluster A: Mesh network of 3 peers
const peerA1 = new Bullet({
  server: true,
  port: 8101,
  peers: ["ws://localhost:8102", "ws://localhost:8103", "ws://localhost:8201"], // Connect to cluster A and bridge
});

const peerA2 = new Bullet({
  server: true,
  port: 8102,
  peers: ["ws://localhost:8101", "ws://localhost:8103"], // Connect within cluster A
});

const peerA3 = new Bullet({
  server: true,
  port: 8103,
  peers: ["ws://localhost:8101", "ws://localhost:8102"], // Connect within cluster A
});

// Cluster B: Mesh network of 3 peers
const peerB1 = new Bullet({
  server: true,
  port: 8201,
  peers: ["ws://localhost:8202", "ws://localhost:8203", "ws://localhost:8101"], // Connect to cluster B and bridge
});

const peerB2 = new Bullet({
  server: true,
  port: 8202,
  peers: ["ws://localhost:8201", "ws://localhost:8203"], // Connect within cluster B
});

const peerB3 = new Bullet({
  server: true,
  port: 8203,
  peers: ["ws://localhost:8201", "ws://localhost:8202"], // Connect within cluster B
});

// In this setup, peerA1 and peerB1 serve as bridges between clusters
```

### Advantages

- Combines benefits of different topologies
- Efficient for geographically distributed systems
- Allows for segmented networks with controlled data flow

### Disadvantages

- More complex to set up and manage
- Bridge nodes are critical points of failure
- May require custom logic for efficient routing

### Best for

- Large-scale distributed systems
- Multi-region deployments
- Applications with natural data segmentation

## Hybrid Topologies

You can combine different topologies to create hybrid designs that address specific needs.

### Star-of-Stars (Hierarchical)

```javascript
// Central hub
const centralHub = new Bullet({
  server: true,
  port: 8000,
});

// Regional hubs
const regionA = new Bullet({
  server: true,
  port: 8100,
  peers: ["ws://localhost:8000"], // Connect to central hub
});

const regionB = new Bullet({
  server: true,
  port: 8200,
  peers: ["ws://localhost:8000"], // Connect to central hub
});

// Local peers connect to regional hubs
const peerA1 = new Bullet({
  peers: ["ws://localhost:8100"],
});

const peerA2 = new Bullet({
  peers: ["ws://localhost:8100"],
});

const peerB1 = new Bullet({
  peers: ["ws://localhost:8200"],
});

const peerB2 = new Bullet({
  peers: ["ws://localhost:8200"],
});
```

### Clustering with Supernodes

```javascript
// Create a network with designated supernodes
function createClusteredNetwork(clusterCount, peersPerCluster) {
  const network = [];

  for (let c = 0; c < clusterCount; c++) {
    // Create a supernode for the cluster
    const basePort = 8000 + c * 100;
    const supernode = new Bullet({
      server: true,
      port: basePort,
      peers: [], // Will populate with other supernodes
    });

    network.push(supernode);

    // Create peers in the cluster
    for (let p = 1; p <= peersPerCluster; p++) {
      const peer = new Bullet({
        peers: [`ws://localhost:${basePort}`], // Connect to cluster supernode
      });

      network.push(peer);
    }
  }

  // Connect supernodes in a mesh
  const supernodes = network.filter((node) => node.options.server);

  for (let i = 0; i < supernodes.length; i++) {
    for (let j = 0; j < supernodes.length; j++) {
      if (i !== j) {
        const peerUrl = `ws://localhost:${8000 + j * 100}`;
        supernodes[i].options.peers.push(peerUrl);
      }
    }
  }

  return network;
}

const clusteredNetwork = createClusteredNetwork(3, 5); // 3 clusters with 5 peers each
```

## Data Propagation Across Topologies

Different topologies affect how quickly data propagates through the network:

### Propagation Times

For a network with n peers:

| Topology | Best Case | Average Case | Worst Case |
| -------- | --------- | ------------ | ---------- |
| Mesh     | 1 hop     | 1 hop        | 1 hop      |
| Star     | 1 hop     | 2 hops       | 2 hops     |
| Chain    | 1 hop     | n/2 hops     | n-1 hops   |
| Ring     | 1 hop     | n/4 hops     | n/2 hops   |
| Bridge   | 1 hop     | varies       | varies     |

### Monitoring Propagation

You can monitor data propagation using events:

```javascript
bullet.on("sync:received", (data) => {
  console.log("Received data from peer:", data);
  console.log("Hop count:", data.hops);
});

bullet.on("sync:sent", (data) => {
  console.log("Sent data to peer:", data);
  console.log("Hop count:", data.hops);
});
```

## Network Configuration Options

Bullet.js provides several options for configuring network behavior:

```javascript
const bullet = new Bullet({
  // Network Server
  server: true, // Run as a WebSocket server
  port: 8765, // Server port
  host: "0.0.0.0", // Listen on all interfaces

  // Peer Connections
  peers: [], // List of peer URLs to connect to

  // Message Relay
  maxTTL: 32, // Maximum message hops
  messageCacheSize: 10000, // Number of message IDs to cache

  // Sync Settings
  enableSync: true, // Enable data synchronization
  syncInterval: 300000, // Sync every 5 minutes
  syncOptions: {
    chunkSize: 50, // Items per sync chunk
    initialSyncTimeout: 30000, // Initial sync timeout
    retryInterval: 5000, // Retry interval
    maxSyncAttempts: 3, // Max sync attempts
  },
});
```

## Implementing Dynamic Peer Discovery

For larger networks, you might want to implement dynamic peer discovery:

```javascript
// Create a peer registry server
const registryServer = new Bullet({
  server: true,
  port: 9000,
});

// Store active peers
registryServer.get("activePeers").put({});

// Peers register themselves
function registerPeer(peerId, url) {
  registryServer.get(`activePeers/${peerId}`).put({
    url,
    lastSeen: Date.now(),
  });
}

// Peers discover others
function discoverPeers() {
  return new Promise((resolve) => {
    registryServer.get("activePeers").on((peers) => {
      const peerUrls = Object.values(peers)
        .filter((peer) => peer.lastSeen > Date.now() - 300000) // Active in last 5 min
        .map((peer) => peer.url);

      resolve(peerUrls);
    });
  });
}

// Example usage
async function connectToPeers(bullet, ownPeerId) {
  // Register self
  registerPeer(ownPeerId, `ws://myserver.example.com:${bullet.options.port}`);

  // Discover peers
  const peerUrls = await discoverPeers();

  // Connect to discovered peers
  for (const url of peerUrls) {
    bullet.network.connectToPeer(url);
  }
}
```

## Real-World Topology Examples

### Local First Collaborative App

```javascript
// User's local database (always available)
const localDB = new Bullet({
  storage: true,
  storagePath: "./local-data",
});

// Connect to cloud server when online
function connectToCloud() {
  if (navigator.onLine) {
    localDB.network.connectToPeer("wss://cloud.example.com/sync");
    console.log("Connected to cloud server");
  }
}

// Handle online/offline events
window.addEventListener("online", connectToCloud);
window.addEventListener("offline", () => {
  console.log("Disconnected from cloud - working locally");
});

// Initial connection
connectToCloud();

// Users can still work with localDB when offline
// Changes will sync automatically when reconnected
```

### IoT Sensor Network

```javascript
// Gateway node (connects to cloud)
const gateway = new Bullet({
  server: true,
  port: 8000,
  storage: true,
  peers: ["wss://iot-cloud.example.com"],
});

// Sensor nodes (connect to gateway)
const sensors = [];
for (let i = 1; i <= 10; i++) {
  const sensor = new Bullet({
    peers: [`ws://gateway:8000`],
  });

  // Configure sensor reporting
  setInterval(() => {
    sensor.get(`sensors/sensor${i}/readings/${Date.now()}`).put({
      temperature: 20 + Math.random() * 10,
      humidity: 40 + Math.random() * 20,
      timestamp: Date.now(),
    });
  }, 60000); // Report every minute

  sensors.push(sensor);
}
```

### Regional Game Server Network

```javascript
// Global coordinator
const globalServer = new Bullet({
  server: true,
  port: 9000,
});

// Regional servers as a star with the global server at the center
const regions = ["us-east", "us-west", "eu-west", "ap-east"];
const regionalServers = {};

regions.forEach((region) => {
  // Each regional server connects to the global coordinator
  regionalServers[region] = new Bullet({
    server: true,
    port: 8000, // In reality, these would be on different machines
    peers: ["ws://global-server:9000"],
  });

  // Game clients connect to their nearest regional server
  for (let i = 0; i < 5; i++) {
    const gameClient = new Bullet({
      peers: [`ws://${region}:8000`],
    });

    // Client operations
    gameClient.get(`gameState/players/${gameClient.id}`).put({
      position: { x: Math.random() * 100, y: Math.random() * 100 },
      score: 0,
      region,
    });
  }
});

// Global state syncs across all regions via the global server
globalServer.get("globalRankings").on((rankings) => {
  console.log("Updated global rankings available in all regions");
});
```

## Best Practices for Network Topologies

1. **Match topology to application needs**

   - Mesh for small networks needing low latency
   - Star for centralized control
   - Bridges for large, segmented networks

2. **Plan for failures**

   - Add redundant connections for critical paths
   - Implement automatic reconnection strategies
   - Consider backup peers for essential services

3. **Monitor network health**

   - Track sync statistics
   - Monitor peer connection status
   - Set up alerts for network disruptions

4. **Optimize for your environment**

   - Reduce connections in resource-constrained environments
   - Add more connections for mission-critical systems
   - Consider geography when designing multi-region systems

5. **Test network partition scenarios**
   - Simulate network failures
   - Verify data integrity after reconnection
   - Ensure critical functions work offline

## Conclusion

The choice of network topology significantly impacts the behavior, performance, and resilience of your Bullet.js application. By understanding the characteristics of different topologies, you can design a network architecture that best suits your specific needs, whether you're building a small collaborative app or a large-scale distributed system.

## Next Steps

Now that you've learned about network topologies, you might want to explore:

- [Data Synchronization](/docs/synchronization) - Learn more about sync mechanisms
- [Conflict Resolution](/docs/conflict-resolution) - Understand how conflicts are handled
- [Performance Optimization](/docs/performance) - Strategies for optimizing Bullet.js
- [Security Considerations](/docs/security) - Secure your distributed database
