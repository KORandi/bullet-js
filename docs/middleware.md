# Middleware

Middleware in Bullet.js allows you to intercept and modify database operations, providing a powerful way to customize behavior, add business logic, and extend functionality.

## You will learn

- What middleware is and how it works in Bullet.js
- How to create and register middleware functions
- Common middleware patterns and use cases
- How to use built-in middleware helpers
- How to create advanced middleware for complex scenarios

## Understanding Middleware

Middleware functions are executed at specific points during database operations. They can:

- Transform data before it's written or after it's read
- Cancel operations based on custom logic
- Rewrite paths to implement URL-like patterns
- Log operations for debugging or auditing
- Implement access control and security rules
- Add computed fields or trigger side effects

## Enabling Middleware

Middleware is enabled by default but can be explicitly configured:

```javascript
const bullet = new Bullet({
  enableMiddleware: true, // default is true
});
```

## Middleware Hook Points

Bullet.js provides several hook points for middleware:

- **get**: Before reading data
- **afterGet**: After reading data
- **put**: Before writing data
- **afterPut**: After writing data
- **delete**: Before deleting data
- **afterDelete**: After deleting data

## Basic Middleware Examples

### Logging Middleware

```javascript
// Log all read operations
bullet.onGet((path) => {
  console.log(`Reading data from: ${path}`);
  return path; // Must return the path to continue
});

// Log all write operations
bullet.beforePut((path, data) => {
  console.log(`Writing data to: ${path}`, data);
  return data; // Must return data to continue
});
```

### Data Transformation

```javascript
// Add timestamp to all writes
bullet.beforePut((path, data) => {
  if (typeof data === "object" && data !== null) {
    return {
      ...data,
      updatedAt: new Date().toISOString(),
    };
  }
  return data;
});

// Add computed fields when reading
bullet.afterGet((path, data) => {
  if (
    path.startsWith("products/") &&
    typeof data === "object" &&
    data !== null
  ) {
    // Add a computed field
    if (data.price && data.tax) {
      data.totalPrice = data.price * (1 + data.tax / 100);
    }

    // Add another computed field
    if (data.inventory !== undefined) {
      data.inStock = data.inventory > 0;
    }
  }
  return data;
});
```

## Registering Middleware

Bullet.js provides several methods to register middleware:

```javascript
// Method 1: Using the specific hook methods
bullet.onGet(middleware);
bullet.afterGet(middleware);
bullet.beforePut(middleware);
bullet.afterPut(middleware);
bullet.beforeDelete(middleware);
bullet.afterDelete(middleware);

// Method 2: Using the generic use method
bullet.use("get", middleware);
bullet.use("afterGet", middleware);
bullet.use("put", middleware);
bullet.use("afterPut", middleware);
bullet.use("delete", middleware);
bullet.use("afterDelete", middleware);

// Method 3: Using the middleware object directly
bullet.middleware.onGet(middleware);
bullet.middleware.afterGet(middleware);
bullet.middleware.beforePut(middleware);
bullet.middleware.afterPut(middleware);
bullet.middleware.beforeDelete(middleware);
bullet.middleware.afterDelete(middleware);
```

## Middleware Return Values

The return value of middleware functions determines what happens next:

- For **get** and **afterGet**:

  - Return a string to change the path
  - Return undefined to use the original path

- For **put** and **afterPut**:

  - Return an object to change the data
  - Return false to cancel the operation
  - Return undefined to use the original data

- For **delete** and **afterDelete**:
  - Return true/undefined to continue
  - Return false to cancel the operation

## Common Middleware Patterns

### Path Rewriting

```javascript
// Rewrite API-style paths to internal paths
bullet.middleware.rewritePath(/^\/api\/v1\/(.*)$/, "/$1");

// Test the rewrite
bullet.get("/api/v1/users/alice").put({ name: "Alice" });
console.log(bullet.get("users/alice").value()); // Data is stored at 'users/alice'
```

### Field Encryption

```javascript
// Simple encryption functions (for demo purposes)
function encryptField(text) {
  // In a real app, use a proper encryption library
  return `encrypted:${text}`;
}

function decryptField(encrypted) {
  // In a real app, use a proper decryption library
  return encrypted.replace("encrypted:", "");
}

// Register encryption middleware
bullet.middleware.encryptFields(
  "users", // Path pattern to match
  ["ssn", "creditCard"], // Fields to encrypt
  encryptField, // Encryption function
  decryptField // Decryption function
);

// Test encryption
bullet.get("users/carol").put({
  name: "Carol",
  email: "carol@example.com",
  ssn: "123-45-6789",
  creditCard: "4111-1111-1111-1111",
});

// Raw data in the store has encrypted fields
console.log(bullet.store.users.carol);
// Displays encrypted values

// But when accessed through the API, fields are decrypted
console.log(bullet.get("users/carol").value());
// Displays decrypted values
```

### Access Control

```javascript
// Simple role-based access control
const currentUser = { id: "user1", role: "editor" };

bullet.middleware.accessControl("admin", (path, operation) => {
  // Only allow access to admin path for admins
  if (currentUser.role !== "admin") {
    console.log(
      `Access denied: ${currentUser.id} (${currentUser.role}) tried to ${operation} ${path}`
    );
    return false;
  }
  return true;
});

// Test access control
try {
  bullet.get("admin/settings").put({ maintenance: true });
  console.log("Admin settings updated");
} catch (error) {
  console.log("Expected error:", error.message);
}
```

### Data Validation

```javascript
bullet.middleware.beforePut((path, data) => {
  // Ensure posts have titles
  if (path.startsWith("posts/") && typeof data === "object" && data !== null) {
    if (!data.title || data.title.trim() === "") {
      console.log("Validation failed: Post must have a title");
      return false; // Stop the operation
    }

    // Sanitize content - for example, removing HTML tags
    if (data.content) {
      data.content = data.content.replace(/<[^>]*>/g, "");
    }
  }
  return data;
});
```

### Activity Logging

```javascript
// Activity log
const activityLog = [];

bullet.middleware.afterPut((path, newData, oldData) => {
  if (path.startsWith("users/")) {
    const userId = path.split("/")[1];
    activityLog.push({
      type: "user_updated",
      userId,
      timestamp: new Date().toISOString(),
      changes: Object.keys(newData).filter(
        (k) =>
          !oldData || JSON.stringify(oldData[k]) !== JSON.stringify(newData[k])
      ),
    });
  }
});

bullet.middleware.beforeDelete((path) => {
  if (path.startsWith("users/")) {
    const userId = path.split("/")[1];
    activityLog.push({
      type: "user_deleted",
      userId,
      timestamp: new Date().toISOString(),
    });
  }
  return true;
});
```

### Relationships and References

```javascript
bullet.middleware.beforePut((path, data) => {
  // When adding a post, update the author's posts list
  if (
    path.startsWith("posts/") &&
    typeof data === "object" &&
    data !== null &&
    data.authorId
  ) {
    const postId = path.split("/")[1];
    const authorPath = `users/${data.authorId}`;
    const author = bullet.get(authorPath).value();

    if (author) {
      const posts = author.posts || [];
      if (!posts.includes(postId)) {
        posts.push(postId);
        bullet.get(`${authorPath}/posts`).put(posts);
        console.log(`Added post reference to author: ${authorPath}`);
      }
    }
  }
  return data;
});
```

### Performance Monitoring

```javascript
// Simple timer middleware
const timings = {};

bullet.onGet((path) => {
  timings[path] = { start: Date.now() };
  return path;
});

bullet.afterGet((path, data) => {
  if (timings[path]) {
    timings[path].end = Date.now();
    timings[path].duration = timings[path].end - timings[path].start;
    console.log(`Access to ${path} took ${timings[path].duration}ms`);
  }
  return data;
});
```

## Built-in Middleware Helpers

Bullet.js provides several helper methods for common middleware patterns:

```javascript
// Log operations
bullet.middleware.log(["read", "write", "delete"], (operation, data) => {
  console.log(`[LOG] ${operation}`, data);
});

// Path rewriting
bullet.middleware.rewritePath(/^\/api\/v1\/(.*)$/, "/$1");

// Data transformation
bullet.middleware.transform("users", (data, path, direction) => {
  // Transform data on read or write
  if (direction === "read") {
    // Add computed fields on read
  }
  if (direction === "write") {
    // Modify data before writing
  }
  return data;
});

// Field encryption
bullet.middleware.encryptFields(
  "users", // Path pattern
  ["ssn", "creditCard"], // Fields to encrypt
  encryptFunction, // Encrypt function
  decryptFunction // Decrypt function
);

// Access control
bullet.middleware.accessControl(
  "admin", // Path pattern
  (path, operation, data) => true, // Control function
  ["read", "write", "delete"] // Operations to check
);
```

## Advanced Middleware Example

Here's a comprehensive example showing multiple middleware working together:

```javascript
const Bullet = require("bullet-js");

// Initialize a Bullet instance with middleware enabled
const bullet = new Bullet({
  enableMiddleware: true,
});

// Listen for all database events
bullet.on("all", (event, data) => {
  console.log(`[EVENT] ${event}:`, JSON.stringify(data).slice(0, 100));
});

// Example 1: Simple logging middleware
bullet.middleware.log(["read", "write", "delete"], (operation, data) => {
  console.log(`[LOG] ${operation}`, data);
});

// Example 2: Path rewriting
bullet.middleware.rewritePath(/^\/api\/v1\/(.*)$/, "/$1");

// Example 3: Data transformation
bullet.middleware.transform("users", (data, path, direction) => {
  if (typeof data === "object" && data !== null) {
    // On read: Add a formatted field
    if (direction === "read" && data.firstName && data.lastName) {
      return {
        ...data,
        fullName: `${data.firstName} ${data.lastName}`,
      };
    }

    // On write: Add a timestamp
    if (direction === "write") {
      return {
        ...data,
        updatedAt: new Date().toISOString(),
      };
    }
  }
  return data;
});

// Example 4: Field encryption
const crypto = require("crypto");

function encryptField(text) {
  // Simple demo encryption
  return "encrypted:" + text;
}

function decryptField(encrypted) {
  // Simple demo decryption
  return encrypted.replace("encrypted:", "");
}

bullet.middleware.encryptFields(
  "users",
  ["ssn", "creditCard"],
  encryptField,
  decryptField
);

// Example 5: Access control
const currentUser = { id: "user1", role: "editor" };

bullet.middleware.accessControl("admin", (path, operation) => {
  if (currentUser.role !== "admin") {
    console.log(
      `Access denied: ${currentUser.id} (${currentUser.role}) tried to ${operation} ${path}`
    );
    return false;
  }
  return true;
});

// Example 6: Custom data validation middleware
bullet.middleware.beforePut((path, data) => {
  if (path.startsWith("posts/") && typeof data === "object" && data !== null) {
    if (!data.title || data.title.trim() === "") {
      console.log("Validation failed: Post must have a title");
      return false;
    }

    if (data.content) {
      data.content = data.content.replace(/<[^>]*>/g, "");
    }
  }
  return data;
});

// Test all the middleware
bullet.get("users/bob").put({
  firstName: "Bob",
  lastName: "Smith",
  email: "bob@example.com",
  ssn: "123-45-6789",
  creditCard: "4111-1111-1111-1111",
});

console.log("Transformed data with fullName:", bullet.get("users/bob").value());

bullet
  .get("/api/v1/users/alice")
  .put({ firstName: "Alice", lastName: "Johnson" });
console.log("Direct access:", bullet.get("users/alice").value());
console.log("API access:", bullet.get("/api/v1/users/alice").value());

try {
  bullet.get("admin/settings").put({ maintenance: true });
} catch (error) {
  console.log("Expected admin access error");
}

bullet.get("posts/post1").put({
  content: '<script>alert("XSS")</script><p>This is my post</p>',
  // Missing title
});

bullet.get("posts/post2").put({
  title: "Valid Post",
  content: '<script>alert("XSS")</script><p>This is my post</p>',
});

console.log("Post without title:", bullet.get("posts/post1").value());
console.log("Post with title (sanitized):", bullet.get("posts/post2").value());
```

## Event System and Middleware

Middleware also integrates with Bullet.js's event system:

```javascript
// Listen for specific operations
bullet.on("read", (data) => {
  console.log("Data read:", data);
});

bullet.on("write", (data) => {
  console.log("Data written:", data);
});

bullet.on("delete", (data) => {
  console.log("Data deleted:", data);
});

// Listen for all operations
bullet.on("all", (event, data) => {
  console.log(`Operation ${event}:`, data);
});

// Listen for middleware errors
bullet.on("error", (data) => {
  console.error("Middleware error:", data);
});
```

## Middleware Order and Chains

Middleware functions are executed in the order they are registered. This allows for chains of transformations:

```javascript
// First middleware: Add timestamps
bullet.beforePut((path, data) => {
  if (typeof data === "object" && data !== null) {
    return {
      ...data,
      updatedAt: new Date().toISOString(),
    };
  }
  return data;
});

// Second middleware: Add user information
bullet.beforePut((path, data) => {
  if (typeof data === "object" && data !== null) {
    return {
      ...data,
      updatedBy: currentUser.id,
    };
  }
  return data;
});

// Third middleware: Validate data
bullet.beforePut((path, data) => {
  // Validation logic
  if (!isValid(data)) {
    return false; // Cancel operation
  }
  return data;
});
```

## Best Practices

1. **Keep middleware functions focused**: Each middleware should do one thing well
2. **Consider performance**: Middleware runs on every operation, so keep it efficient
3. **Handle errors gracefully**: Use try/catch in middleware to prevent crashes
4. **Be careful with recursive calls**: Middleware that triggers more database operations can create infinite loops
5. **Use middleware for cross-cutting concerns**: Authentication, logging, validation, etc.
6. **Document your middleware**: Especially for complex transformations

## Debugging Middleware

To debug middleware, you can use the event system to monitor what's happening:

```javascript
// Debug all events
bullet.on("all", (event, data) => {
  console.log(`[DEBUG] ${event}:`, data);
});

// Add debugging middleware
bullet.beforePut((path, data) => {
  console.log("[BEFORE PUT]", path, data);
  return data;
});

bullet.afterPut((path, data, oldData) => {
  console.log("[AFTER PUT]", path, data, oldData);
});
```

## Removing Middleware

If you need to remove middleware, you can clear all middleware of a specific type:

```javascript
// Reset all middleware of a specific type
bullet.middleware.middleware.get = [];
bullet.middleware.middleware.put = [];
```

## Conclusion

Middleware is one of Bullet.js's most powerful features, allowing you to customize and extend the database's behavior. By strategically applying middleware, you can implement complex business logic, enforce data integrity, and create a more secure and robust application.

## Next Steps

Now that you've learned about middleware, you might want to explore:

- [Querying](/docs/querying) - Learn how to filter and search your data
- [Network Topologies](/docs/network-topologies) - Understand different distributed architectures
- [Conflict Resolution](/docs/conflict-resolution) - Learn how data conflicts are managed
- [Custom Storage Adapters](/docs/storage-adapters) - Create your own storage backend
