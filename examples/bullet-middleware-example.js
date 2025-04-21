/**
 * Bullet.js Middleware Example
 */

const Bullet = require("../src/bullet");
const crypto = require("crypto");

// Initialize a Bullet instance with middleware enabled
const bullet = new Bullet({
  server: false, // Disable networking for this example
  storage: false, // Disable storage for this example
  enableMiddleware: true,
});

// Listen for all database events
bullet.on("all", (event, data) => {
  console.log(
    `[EVENT] ${event}:`,
    JSON.stringify(data).slice(0, 100) +
      (JSON.stringify(data).length > 100 ? "..." : "")
  );
});

console.log("\n=== MIDDLEWARE EXAMPLES ===\n");

// Example 1: Simple logging middleware
console.log("1. Adding logging middleware");
bullet.middleware.log(["read", "write", "delete"], (operation, data) => {
  console.log(`[LOG] ${operation}`, data);
});

// Example 2: Path rewriting
console.log("\n2. Path rewriting:");
bullet.middleware.rewritePath(/^\/api\/v1\/(.*)$/, "/$1");

// Test the rewrite
bullet.get("/api/v1/users/alice").put({ name: "Alice" });
console.log("Direct access:", bullet.get("users/alice").value());
console.log("API access:", bullet.get("/api/v1/users/alice").value());

// Example 3: Data transformation
console.log("\n3. Data transformation:");
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

// Test the transformation
bullet.get("users/bob").put({
  firstName: "Bob",
  lastName: "Smith",
  email: "bob@example.com",
});

console.log(
  "Transformed data (with fullName and updatedAt):",
  bullet.get("users/bob").value()
);

// Example 4: Field encryption
console.log("\n4. Field encryption:");

// Simple encryption functions for demo purposes
function encryptField(text) {
  const cipher = crypto.createCipher("aes-256-cbc", "demo-secret-key");
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

function decryptField(encrypted) {
  const decipher = crypto.createDecipher("aes-256-cbc", "demo-secret-key");
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

bullet.middleware.encryptFields(
  "users",
  ["ssn", "creditCard"],
  encryptField,
  decryptField
);

// Test encryption
bullet.get("users/carol").put({
  name: "Carol",
  email: "carol@example.com",
  ssn: "123-45-6789",
  creditCard: "4111-1111-1111-1111",
});

// Get raw data directly from store to show encrypted values
const rawUserData = bullet.store.users.carol;
console.log("Raw stored data (with encrypted fields):", rawUserData);

// Get data through API to show decrypted values
console.log("Decrypted data when accessed:", bullet.get("users/carol").value());

// Example 5: Access control
console.log("\n5. Access control:");

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
  console.log("Admin settings updated (should not see this)");
} catch (error) {
  console.log("Expected error:", error.message);
}

// Example 6: Custom data validation middleware
console.log("\n6. Custom data validation:");

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

// Test validation middleware
bullet.get("posts/post1").put({
  content: '<script>alert("XSS")</script><p>This is my post</p>',
  // Missing title
});

bullet.get("posts/post2").put({
  title: "Valid Post",
  content: '<script>alert("XSS")</script><p>This is my post</p>',
});

console.log(
  "Post without title (should not exist):",
  bullet.get("posts/post1").value()
);
console.log("Post with title (sanitized):", bullet.get("posts/post2").value());

// Example 7: Computed fields
console.log("\n7. Computed fields:");

bullet.middleware.afterGet((path, data) => {
  // Add computed fields to products
  if (
    path.startsWith("products/") &&
    typeof data === "object" &&
    data !== null
  ) {
    if (data.price && data.tax) {
      data.totalPrice = data.price * (1 + data.tax / 100);
    }

    if (data.inventory !== undefined) {
      data.inStock = data.inventory > 0;
    }
  }
  return data;
});

// Test computed fields
bullet.get("products/product1").put({
  name: "Laptop",
  price: 1000,
  tax: 8.5,
  inventory: 5,
});

console.log(
  "Product with computed fields:",
  bullet.get("products/product1").value()
);

// Example 8: Custom hooks for activity logging
console.log("\n8. Activity logging:");

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

// Test activity logging
bullet.get("users/dave").put({ name: "Dave", email: "dave@example.com" });
bullet.get("users/dave").put({ name: "David", email: "dave@example.com" }); // Update
bullet.get("users/eve").delete(); // This will use the delete method we added

console.log("Activity log:", activityLog);

// Example 9: Automatic relationships with references
console.log("\n9. Automatic relationship handling:");

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

// Test relationship handling
bullet.get("users/frank").put({
  name: "Frank",
  email: "frank@example.com",
  posts: [],
});

bullet.get("posts/post3").put({
  title: "Frank's Post",
  content: "This is a post by Frank",
  authorId: "frank",
});

console.log(
  "User with updated posts array:",
  bullet.get("users/frank").value()
);

// Example 10: Middleware for performance monitoring
console.log("\n10. Performance monitoring:");

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

// Test performance monitoring
bullet.get("users/bob").value(); // Should log timing
bullet.get("users/carol").value(); // Should log timing

console.log("\nAll middleware examples completed.");

// Clean up
bullet.close();
