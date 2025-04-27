# Conflict Resolution

In a distributed database like Bullet.js, data conflicts are inevitable. When multiple peers update the same data simultaneously, conflict resolution becomes essential. This guide explains how Bullet.js handles these conflicts to ensure data consistency across all peers.

## You will learn

- What conflicts are and why they occur in distributed systems
- How Bullet.js uses vector clocks to track causality
- How the HAM (Hypothetical Amnesia Machine) algorithm resolves conflicts
- How to customize conflict resolution for your application
- Best practices for minimizing conflicts

## Understanding Conflicts

In distributed systems, conflicts occur when multiple peers modify the same data without knowledge of each other's changes. This commonly happens when:

- Peers operate offline and later reconnect
- Network latency causes updates to arrive out of order
- Multiple users edit the same data simultaneously

Without proper conflict resolution, data could become inconsistent across peers, leading to data loss, application errors, and poor user experience.

## Vector Clocks

Bullet.js uses vector clocks to track causality between updates. A vector clock is a data structure that records the "version" of a piece of data across all peers.

### How Vector Clocks Work

- Each peer maintains its own logical clock
- When a peer updates data, it increments its own clock
- The complete vector clock shows the latest known version from each peer
- By comparing vector clocks, the system can determine causal relationships

```javascript
// Example vector clock
{
  "peer1": 3,  // Peer1 has made 3 updates
  "peer2": 1,  // Peer2 has made 1 update
  "peer3": 0   // Peer3 hasn't modified this data
}
```

### Vector Clock Relationships

When comparing two vector clocks, there are three possible relationships:

1. **Clock A dominates Clock B**: Every counter in A is greater than or equal to the corresponding counter in B, and at least one counter is strictly greater. This means A happened after B.

2. **Clock B dominates Clock A**: The opposite of the above. B happened after A.

3. **Concurrent modifications**: Neither clock dominates the other. These updates happened concurrently and require conflict resolution.

## The HAM Algorithm

Bullet.js implements the Hypothetical Amnesia Machine (HAM) algorithm for conflict resolution. HAM is a deterministic algorithm that ensures all peers will independently reach the same conclusion when faced with the same conflict.

### HAM Decision Process

When the HAM algorithm encounters a conflict, it follows this process:

1. Compare the vector clocks to determine if updates are causally related
2. If one update happened after the other, choose the later update
3. If updates are concurrent, apply a deterministic merge strategy
4. Ensure all peers apply the same merge strategy to maintain consistency

```javascript
// Simplified HAM decision process
function resolveConflict(
  incomingValue,
  currentValue,
  incomingClock,
  currentClock
) {
  // Compare vector clocks
  const clockComparison = compareVectorClocks(incomingClock, currentClock);

  if (clockComparison > 0) {
    // Incoming clock dominates - use incoming value
    return incomingValue;
  } else if (clockComparison < 0) {
    // Current clock dominates - keep current value
    return currentValue;
  } else {
    // Concurrent modification - need to merge
    return mergeValues(incomingValue, currentValue);
  }
}
```

## Conflict Resolution Strategies

When concurrent modifications are detected, Bullet.js applies these strategies to merge the data:

### For Primitive Values

For primitive types (strings, numbers, booleans), Bullet.js applies a deterministic "last-write-wins" strategy based on value comparison:

```javascript
// For primitive values (simplified)
function mergePrimitives(incoming, current) {
  // Deterministic comparison - higher values win
  return compareValues(incoming, current) >= 0 ? incoming : current;
}
```

### For Objects

For objects, Bullet.js performs a deep merge:

```javascript
// For objects (simplified)
function mergeObjects(incoming, current) {
  // Start with current state
  const result = { ...current };

  // Apply all properties from incoming
  for (const [key, value] of Object.entries(incoming)) {
    if (key in result) {
      // Recursively merge nested properties
      result[key] = mergeValues(value, result[key]);
    } else {
      // Add new properties
      result[key] = value;
    }
  }

  return result;
}
```

### For Arrays

Arrays are treated as ordered collections. By default, array merging in HAM follows these rules:

- If the arrays have different lengths, prefer the longer array
- If arrays have the same length, compare elements one by one
- For element conflicts, apply the same HAM rules recursively

## Conflict Resolution in Action

Let's see how conflict resolution works in a practical scenario:

```javascript
// Two peers start with the same user profile
peerA.get("users/alice").put({
  name: "Alice",
  email: "alice@example.com",
  preferences: {
    theme: "light",
    notifications: true,
  },
});

peerB.get("users/alice").put({
  name: "Alice",
  email: "alice@example.com",
  preferences: {
    theme: "light",
    notifications: true,
  },
});

// They go offline and make concurrent changes
peerA.get("users/alice/preferences").put({
  theme: "dark",
  notifications: true,
});

peerB.get("users/alice/preferences").put({
  theme: "light",
  notifications: false,
  language: "es",
});

// When they reconnect, HAM will merge the changes
// The final state will be:
// {
//   name: 'Alice',
//   email: 'alice@example.com',
//   preferences: {
//     theme: 'dark',        // From peerA
//     notifications: false, // From peerB
//     language: 'es'        // From peerB
//   }
// }
```

## Customizing Conflict Resolution

Bullet.js allows you to customize conflict resolution by setting a custom comparison function for the HAM algorithm:

```javascript
// Custom conflict resolution
bullet.ham.setCompare((incoming, existing) => {
  // Custom priority-based comparison
  if (incoming.priority && existing.priority) {
    return incoming.priority > existing.priority ? 1 : -1;
  }

  // Fall back to timestamp comparison
  if (incoming.timestamp && existing.timestamp) {
    return incoming.timestamp > existing.timestamp ? 1 : -1;
  }

  // Default comparison
  if (incoming === existing) return 0;
  if (incoming < existing) return -1;
  return 1;
});
```

## Complex Conflict Resolution Example

Let's implement a collaborative task list with custom conflict resolution:

```javascript
const Bullet = require("bullet-js");

// Initialize Bullet with HAM enabled
const bullet = new Bullet();

// Custom comparison function for tasks
bullet.ham.setCompare((incoming, existing) => {
  // For task objects with status
  if (
    incoming &&
    existing &&
    typeof incoming === "object" &&
    typeof existing === "object" &&
    "status" in incoming &&
    "status" in existing
  ) {
    // Priority order: completed > in-progress > pending
    const statusPriority = {
      completed: 3,
      "in-progress": 2,
      pending: 1,
    };

    const incomingPriority = statusPriority[incoming.status] || 0;
    const existingPriority = statusPriority[existing.status] || 0;

    if (incomingPriority !== existingPriority) {
      return incomingPriority > existingPriority ? 1 : -1;
    }

    // If same status priority, check timestamps
    if (incoming.updatedAt && existing.updatedAt) {
      return incoming.updatedAt > existing.updatedAt ? 1 : -1;
    }
  }

  // Default comparison
  if (incoming === existing) return 0;
  if (JSON.stringify(incoming) > JSON.stringify(existing)) return 1;
  return -1;
});

// Create a task
bullet.get("tasks/task1").put({
  title: "Implement conflict resolution",
  status: "pending",
  assignee: "alice",
  updatedAt: new Date().toISOString(),
});

// Simulate concurrent updates
// Peer A: Task in progress
const peerAUpdate = {
  title: "Implement conflict resolution",
  status: "in-progress",
  assignee: "alice",
  updatedAt: new Date().toISOString(),
};

// Peer B: Task completed
const peerBUpdate = {
  title: "Implement conflict resolution",
  status: "completed",
  assignee: "bob",
  updatedAt: new Date().toISOString(),
};

// In a real system, these updates would come from different peers
// For simulation, we'll create the vector clocks manually
const peerAVectorClock = { peerA: 1 };
const peerBVectorClock = { peerB: 1 };

// Process both updates
const result = bullet.ham.processUpdate(
  "tasks/task1",
  peerAUpdate,
  peerAVectorClock,
  peerBUpdate,
  peerBVectorClock
);

console.log("Conflict resolution result:", result.value);
// The 'completed' status will win due to our custom priority rules
```

## Strategies for Minimizing Conflicts

While Bullet.js handles conflicts automatically, you can reduce their frequency and complexity:

1. **Use fine-grained paths**: Update specific fields rather than entire objects

   ```javascript
   // Better: Update specific fields
   bullet.get("users/alice/preferences/theme").put("dark");
   bullet.get("users/alice/preferences/notifications").put(false);

   // Worse: Update entire object (more likely to conflict)
   bullet.get("users/alice/preferences").put({
     theme: "dark",
     notifications: false,
   });
   ```

2. **Include timestamps**: Add update timestamps to help resolve conflicts

   ```javascript
   bullet.get("posts/123").put({
     title: "Updated title",
     content: "Updated content",
     updatedAt: new Date().toISOString(),
   });
   ```

3. **Use operational transforms**: For collaborative editing, use operations rather than state

   ```javascript
   // Instead of storing the full text
   bullet.get("documents/doc1/operations").get(Date.now()).put({
     type: "insert",
     position: 42,
     text: "new text",
     author: "alice",
     timestamp: Date.now(),
   });
   ```

4. **Implement optimistic UI**: Update the local UI immediately, but be prepared to reconcile when conflicts occur

5. **Peer synchronization**: Ensure peers sync frequently to reduce the window for conflicts

## Handling Intentional Conflicts

Sometimes, you might want to intentionally create a conflict to override all peers:

```javascript
// Force an update to take precedence
function forceUpdate(path, data) {
  // Create a "dominant" vector clock
  const currentMeta = bullet.meta[path] || {};
  const currentClock = currentMeta.vectorClock || {};

  // Create new clock with all values incremented
  const forcedClock = {};
  for (const [peerId, value] of Object.entries(currentClock)) {
    forcedClock[peerId] = value + 1;
  }

  // Ensure our peer is represented
  forcedClock[bullet.id] = (forcedClock[bullet.id] || 0) + 10;

  // Create an update with this clock
  const update = bullet.ham.createUpdate(path, data);
  update.vectorClock = forcedClock;

  // Apply the update
  bullet.setData(path, {
    ...data,
    __vectorClock: forcedClock,
  });

  return update;
}

// Usage
forceUpdate("settings/global", {
  maintenance: true,
  maintenanceMessage: "System maintenance in progress",
  startTime: Date.now(),
  forcedBy: "admin",
});
```

## Monitoring Conflict Resolution

To understand what's happening during conflict resolution, you can monitor the HAM decisions:

```javascript
// Listen for HAM decisions
bullet.on("ham:decision", (event) => {
  console.log("HAM Decision:", event);
  // {
  //   path: 'users/alice',
  //   incoming: true/false,    // Was incoming value used?
  //   current: true/false,     // Was current value used?
  //   concurrent: true/false,  // Was this a concurrent modification?
  //   reason: '...',           // Human-readable reason
  //   vectorClock: {...}       // Resulting vector clock
  // }
});

// Listen for all data operations
bullet.on("all", (event, data) => {
  if (event === "write") {
    console.log(`Write to ${data.path}:`, data);
  }
});
```

## Vector Clock Management

Bullet.js manages vector clocks automatically, but you can interact with them directly:

```javascript
// Get the current vector clock for a path
const clock = bullet.ham.getVectorClock("users/alice");
console.log("Current clock:", clock);

// Create a manual update with a vector clock
const update = bullet.ham.createUpdate("users/alice", {
  name: "Alice Smith",
  email: "alice@example.com",
});

console.log("Generated update:", update);
// {
//   value: { name: 'Alice Smith', email: 'alice@example.com' },
//   vectorClock: { 'peer1': 1 }
// }
```

## Conflict Resolution with Different Data Types

HAM behavior varies slightly depending on the data type:

### Primitive Values

For strings, numbers, and booleans, Bullet.js uses a simple comparison:

```javascript
// Concurrent string updates
peerA.get("settings/theme").put("dark");
peerB.get("settings/theme").put("light");

// Result depends on string comparison ('light' > 'dark')
// Final state: 'light'
```

### Objects

For objects, a deep merge is performed:

```javascript
// Concurrent object updates
peerA.get("users/bob").put({
  name: "Bob Smith",
  age: 30,
  preferences: { theme: "dark" },
});

peerB.get("users/bob").put({
  name: "Robert Smith",
  location: "New York",
  preferences: { notifications: false },
});

// Result is a deep merge
// Final state:
// {
//   name: 'Robert Smith',     // From peerB (alphabetically greater)
//   age: 30,                  // From peerA (only source)
//   location: 'New York',     // From peerB (only source)
//   preferences: {            // Merged object
//     theme: 'dark',          // From peerA
//     notifications: false    // From peerB
//   }
// }
```

### Arrays

Arrays are handled as ordered collections with element-by-element comparison:

```javascript
// Concurrent array updates
peerA.get("posts/featured").put(["post1", "post2", "post3"]);
peerB.get("posts/featured").put(["post1", "post4", "post5", "post6"]);

// peerB's array is longer, so it wins
// Final state: ['post1', 'post4', 'post5', 'post6']

// If arrays have the same length, compare elements
peerA.get("tags").put(["red", "green", "blue"]);
peerB.get("tags").put(["red", "yellow", "blue"]);

// Compare each element: 'red' === 'red', 'yellow' > 'green', 'blue' === 'blue'
// Final state: ['red', 'yellow', 'blue']
```

## Conflict Resolution for Special Cases

### Deleted Data

When data is deleted on one peer but modified on another, HAM typically prioritizes existence over non-existence:

```javascript
// Peer A deletes data
peerA.get("posts/123").put(null);

// Peer B updates data
peerB.get("posts/123").put({
  title: "Updated Post",
  content: "New content",
});

// The update typically wins over deletion
// Final state: { title: 'Updated Post', content: 'New content' }
```

### Nested Updates

Conflicts can occur at different levels of the graph:

```javascript
// Starting state
bullet.get("users/charlie").put({
  name: "Charlie",
  profile: {
    bio: "Developer",
    links: {
      github: "charlie-dev",
      twitter: "charlie_tweets",
    },
  },
});

// Peer A updates a nested field
peerA.get("users/charlie/profile/links/github").put("charlie-github");

// Peer B updates the entire profile object
peerB.get("users/charlie/profile").put({
  bio: "Senior Developer",
  links: {
    github: "charlie-dev",
    website: "charlie.dev",
  },
});

// Result depends on the timing and vector clocks
// HAM might produce:
// {
//   name: 'Charlie',
//   profile: {
//     bio: 'Senior Developer',
//     links: {
//       github: 'charlie-github',  // From peerA's specific update
//       website: 'charlie.dev'     // From peerB's update
//     }
//   }
// }
```

## Real-World Conflict Resolution Scenarios

### Collaborative Document Editing

For real-time collaborative editing, consider storing operations rather than the full document:

```javascript
// Add an edit operation
bullet.get("documents/doc1/operations").get(Date.now()).put({
  type: "insert",
  position: 42,
  text: "new text",
  author: "alice",
  timestamp: Date.now(),
});

// Apply all operations in sequence to reconstruct the document
function getDocument(id) {
  const operations = bullet.get(`documents/${id}/operations`).value() || {};

  // Sort operations by timestamp
  const sortedOps = Object.values(operations).sort(
    (a, b) => a.timestamp - b.timestamp
  );

  // Apply operations to build the document
  let document = "";
  for (const op of sortedOps) {
    if (op.type === "insert") {
      document =
        document.slice(0, op.position) + op.text + document.slice(op.position);
    } else if (op.type === "delete") {
      document =
        document.slice(0, op.position) +
        document.slice(op.position + op.length);
    }
  }

  return document;
}
```

### Shopping Cart Synchronization

For a shopping cart that works offline:

```javascript
// Add an item to cart
function addToCart(productId, quantity) {
  const cartPath = `users/${currentUser}/cart/${productId}`;
  const currentItem = bullet.get(cartPath).value();

  if (currentItem) {
    // Update existing item
    bullet.get(cartPath).put({
      ...currentItem,
      quantity: currentItem.quantity + quantity,
      updatedAt: Date.now(),
    });
  } else {
    // Add new item
    bullet.get(cartPath).put({
      productId,
      quantity,
      addedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}

// If the user adds an item on two devices, the quantities will be combined
// thanks to HAM's conflict resolution
```

## Advanced Conflict Resolution

For advanced cases, you might want to implement a full CRDT (Conflict-free Replicated Data Type):

```javascript
// Implement a counter CRDT
function createCounter(path) {
  return {
    increment: function (by = 1) {
      const current = bullet.get(path).value() || {};
      const peerId = bullet.id;

      bullet.get(path).put({
        ...current,
        [peerId]: (current[peerId] || 0) + by,
      });
    },

    decrement: function (by = 1) {
      this.increment(-by);
    },

    value: function () {
      const current = bullet.get(path).value() || {};
      return Object.values(current).reduce((sum, val) => sum + val, 0);
    },
  };
}

// Usage
const pageViews = createCounter("metrics/pageViews");
pageViews.increment();
console.log("Page views:", pageViews.value());
```

## Conclusion

Conflict resolution is at the heart of Bullet.js's distributed nature. The HAM algorithm ensures that all peers converge to a consistent state, even when updates happen concurrently. By understanding how conflicts are resolved, you can design your data structures and application logic to work harmoniously with Bullet.js's conflict resolution system.

## Next Steps

Now that you've learned about conflict resolution, you might want to explore:

- [Network Topologies](/docs/network-topologies.md) - Configure different distributed architectures
- [Custom Storage Adapters](/docs/storage-adapters.md) - Implement specialized persistence layers
- [Advanced Validation](/docs/advanced-validation.md) - More complex validation strategies
- [Performance Optimization](/docs/performance.md) - Strategies for optimizing Bullet.js applications
