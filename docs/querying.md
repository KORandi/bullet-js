# Querying Data

Bullet.js provides a powerful query system that allows you to search, filter, and index your data efficiently. This guide will show you how to use these capabilities to build fast, responsive applications.

## You will learn

- How to create and use indices for faster queries
- How to find data with exact match queries
- How to perform range queries
- How to use custom filter functions
- How to transform and aggregate query results
- Best practices for optimizing query performance

## Enabling the Query System

The query system is enabled by default, but you can explicitly configure it:

```javascript
const bullet = new Bullet({
  enableIndexing: true, // default is true
});
```

## Understanding Indices

Indices in Bullet.js work much like indices in traditional databases. They create optimized data structures that speed up queries on specific fields. Without indices, queries would need to scan every record.

### When to Use Indices

Create indices for:

- Fields you frequently query against
- Fields used in range queries
- Fields used for sorting or grouping
- High-cardinality fields (many possible values)

### Creating Indices

```javascript
// Create an index on the 'role' field for all users
bullet.index("users", "role");

// Create an index on the 'age' field for all users
bullet.index("users", "age");

// Create an index on the 'category' field for all products
bullet.index("products", "category");

// Create an index on the 'price' field for all products
bullet.index("products", "price");
```

## Basic Query Types

### Equality Queries

Find records where a field equals a specific value:

```javascript
// Find all admin users
const admins = bullet.equals("users", "role", "admin");

// Process the results
admins.forEach((node) => {
  console.log(`Admin: ${node.value().name} (${node.path})`);
});
```

### Range Queries

Find records where a field falls within a range:

```javascript
// Find users aged 25-35
const youngAdults = bullet.range("users", "age", 25, 35);

// Find products priced between $10 and $50
const affordableProducts = bullet.range("products", "price", 10, 50);
```

### Custom Filters

For more complex queries, use custom filter functions:

```javascript
// Find active users with verified emails
const activeVerifiedUsers = bullet.filter(
  "users",
  (user) => user.active === true && user.emailVerified === true
);

// Find products that are on sale and in stock
const availableSaleItems = bullet.filter(
  "products",
  (product) => product.onSale === true && product.inventory > 0
);
```

### Finding the First Match

To get just the first matching record:

```javascript
// Find the first admin user
const firstAdmin = bullet.find("users", (user) => user.role === "admin");

if (firstAdmin) {
  console.log("First admin:", firstAdmin.value().name);
} else {
  console.log("No admin users found");
}
```

## Advanced Query Operations

### Count Operations

Count the number of records matching specific criteria:

```javascript
// Count users by role
const roleCount = bullet.query.count("users", "role", "admin");
console.log(`There are ${roleCount} admin users`);

// Count active users (using a filter)
const activeUsers = bullet.filter("users", (user) => user.active === true);
console.log(`There are ${activeUsers.length} active users`);
```

### Map Operations

Transform query results into a new format:

```javascript
// Extract just the names of all users
const userNames = bullet.query.map("users", (user) => user.name);
console.log("User names:", userNames);

// Calculate total inventory value
const inventoryValue = bullet.query
  .map("products", (product) => product.price * product.inventory)
  .reduce((total, value) => total + value, 0);

console.log("Total inventory value:", inventoryValue);
```

### Combining Queries

You can combine multiple query operations for more complex scenarios:

```javascript
// Find active premium users with high activity
const activePremiumUsers = bullet.filter(
  "users",
  (user) => user.active === true && user.subscription === "premium"
);

// Further filter these users by activity level
const highActivityPremiumUsers = activePremiumUsers.filter(
  (node) => node.value().activityScore > 75
);

console.log(
  `Found ${highActivityPremiumUsers.length} high-activity premium users`
);
```

## Handling Query Results

Query results are returned as arrays of BulletNode objects. You can:

```javascript
// Example query
const youngUsers = bullet.range("users", "age", 18, 25);

// 1. Iterate through results
youngUsers.forEach((node) => {
  console.log(`Young user: ${node.value().name}`);
});

// 2. Access the full path of each result
const userPaths = youngUsers.map((node) => node.path);
console.log("User paths:", userPaths);

// 3. Extract specific values
const userAges = youngUsers.map((node) => node.value().age);
console.log("User ages:", userAges);

// 4. Modify the results
youngUsers.forEach((node) => {
  // Add a tag to each young user
  const userData = node.value();
  node.put({
    ...userData,
    ageGroup: "young-adult",
  });
});

// 5. Subscribe to changes on query results
youngUsers.forEach((node) => {
  node.on((userData) => {
    console.log(`Young user updated: ${userData.name}`);
  });
});
```

## Query Performance Tips

1. **Create indices** for frequently queried fields
2. **Be specific with path prefixes** to limit the search space
3. **Use equality queries** when possible (they're faster than filters)
4. **Avoid over-indexing** as it increases memory usage
5. **Order queries from most to least selective** for complex operations

```javascript
// Good: Use specific path and indexed fields when possible
const premiumUsers = bullet.equals("users", "subscription", "premium");

// Less efficient: Scan all users with a filter
const premiumUsersAlt = bullet.filter(
  "users",
  (user) => user.subscription === "premium"
);
```

## Nested Queries

You can query nested data structures as well:

```javascript
// Index a nested field
bullet.index("users", "address.country");

// Query based on the nested field
const usUsers = bullet.equals("users", "address.country", "US");

// You can also use dot notation in filter functions
const californiaUsers = bullet.filter(
  "users",
  (user) => user.address && user.address.state === "CA"
);
```

## Querying Arrays

When querying arrays, you need to use filter functions:

```javascript
// Find users with a specific tag
const developersWithJavaScript = bullet.filter(
  "users",
  (user) =>
    user.skills &&
    Array.isArray(user.skills) &&
    user.skills.includes("JavaScript")
);

// Find products in multiple categories
const techProducts = bullet.filter(
  "products",
  (product) =>
    product.categories &&
    Array.isArray(product.categories) &&
    (product.categories.includes("electronics") ||
      product.categories.includes("computers"))
);
```

## Complete Example

Here's a complete example showing various query techniques:

```javascript
const Bullet = require("bullet-js");

// Initialize Bullet with indexing enabled
const bullet = new Bullet({
  enableIndexing: true,
});

// Add sample data
const users = {
  user1: { name: "Alice Johnson", age: 28, active: true, role: "admin" },
  user2: { name: "Bob Smith", age: 35, active: true, role: "user" },
  user3: { name: "Carol Davis", age: 42, active: false, role: "user" },
  user4: { name: "Dave Wilson", age: 23, active: true, role: "editor" },
  user5: { name: "Eve Brown", age: 31, active: true, role: "user" },
  user6: { name: "Frank Miller", age: 47, active: false, role: "admin" },
  user7: { name: "Grace Lee", age: 29, active: true, role: "editor" },
  user8: { name: "Harry Taylor", age: 39, active: true, role: "user" },
  user9: { name: "Irene Clark", age: 26, active: false, role: "user" },
  user10: { name: "Jack Roberts", age: 33, active: true, role: "admin" },
};

// Add products to the database
const products = {
  prod1: { name: "Laptop", price: 1200, stock: 15, category: "electronics" },
  prod2: { name: "Smartphone", price: 800, stock: 25, category: "electronics" },
  prod3: { name: "Headphones", price: 150, stock: 50, category: "accessories" },
  prod4: { name: "Mouse", price: 30, stock: 100, category: "accessories" },
  prod5: { name: "Keyboard", price: 80, stock: 40, category: "accessories" },
  prod6: { name: "Monitor", price: 300, stock: 20, category: "electronics" },
  prod7: { name: "Desk Chair", price: 250, stock: 10, category: "furniture" },
  prod8: { name: "Desk", price: 400, stock: 5, category: "furniture" },
  prod9: { name: "Printer", price: 200, stock: 8, category: "electronics" },
  prod10: { name: "Camera", price: 600, stock: 12, category: "electronics" },
};

// Add data to the database
for (const [id, data] of Object.entries(users)) {
  bullet.get(`users/${id}`).put(data);
}

for (const [id, data] of Object.entries(products)) {
  bullet.get(`products/${id}`).put(data);
}

// Create some indices for faster querying
bullet.index("users", "role"); // Index users by role
bullet.index("users", "age"); // Index users by age
bullet.index("users", "active"); // Index users by active status
bullet.index("products", "category"); // Index products by category
bullet.index("products", "price"); // Index products by price

// Example 1: Find all admin users
console.log("\n1. Find all admin users:");
const admins = bullet.equals("users", "role", "admin");
admins.forEach((node) => {
  console.log(`- ${node.value().name} (ID: ${node.path.split("/").pop()})`);
});

// Example 2: Find users in age range 30-40
console.log("\n2. Find users aged 30-40:");
const middleAgedUsers = bullet.range("users", "age", 30, 40);
middleAgedUsers.forEach((node) => {
  console.log(`- ${node.value().name}, ${node.value().age} years old`);
});

// Example 3: Find active editors
console.log("\n3. Find active editors:");
const activeEditors = bullet.filter(
  "users",
  (user) => user.active === true && user.role === "editor"
);
activeEditors.forEach((node) => {
  console.log(`- ${node.value().name}`);
});

// Example 4: Count users by role
console.log("\n4. Count users by role:");
const roles = ["admin", "user", "editor"];
roles.forEach((role) => {
  const count = bullet.query.count("users", "role", role);
  console.log(`- ${role}: ${count} users`);
});

// Example 5: Find expensive electronics
console.log("\n5. Find expensive electronics (price > 500):");
const expensiveElectronics = bullet.filter(
  "products",
  (product) => product.category === "electronics" && product.price > 500
);
expensiveElectronics.forEach((node) => {
  console.log(`- ${node.value().name}: $${node.value().price}`);
});

// Example 6: Find products with low stock
console.log("\n6. Find products with low stock (less than 10):");
const lowStockProducts = bullet.filter(
  "products",
  (product) => product.stock < 10
);
lowStockProducts.forEach((node) => {
  console.log(`- ${node.value().name}: ${node.value().stock} in stock`);
});

// Example 7: Extract all user names
console.log("\n7. Extract all user names:");
const userNames = bullet.query.map("users", (user) => user.name);
console.log(`- ${userNames.join(", ")}`);

// Example 8: Complex filter with multiple conditions
console.log("\n8. Find active users under 30 with non-admin roles:");
const youngActiveNonAdmins = bullet.filter(
  "users",
  (user) => user.active === true && user.age < 30 && user.role !== "admin"
);
youngActiveNonAdmins.forEach((node) => {
  console.log(
    `- ${node.value().name}, ${node.value().age}, ${node.value().role}`
  );
});
```

## Subscribing to Query Results

One powerful pattern is to subscribe to the results of a query:

```javascript
// Find users matching criteria
const activeUsers = bullet.filter("users", (user) => user.active === true);

// Subscribe to changes in any of the matching users
activeUsers.forEach((node) => {
  node.on((userData) => {
    console.log(`Active user updated: ${userData.name}`);
    // Update your UI or trigger other logic
  });
});

// You can also create a list of IDs from your query
const activeUserIds = activeUsers.map((node) => node.path.split("/").pop());
console.log("Active user IDs:", activeUserIds);
```

## Combining with Middleware

Queries can be enhanced with middleware for more powerful operations:

```javascript
// Add computed values to product data after retrieval
bullet.afterGet((path, data) => {
  if (
    path.startsWith("products/") &&
    typeof data === "object" &&
    data !== null
  ) {
    // Add calculated fields
    data.valueInStock = data.price * data.stock;
    data.onSale = data.discount > 0;
  }
  return data;
});

// Now queries can use these computed fields
const onSaleProducts = bullet.filter(
  "products",
  (product) => product.onSale === true
);
```

## Next Steps

Now that you've learned about querying data in Bullet.js, you might want to explore:

- [Serialization](/docs/serialization) - Import and export data in different formats
- [Network Topologies](/docs/network-topologies) - Configure different distributed architectures
- [Conflict Resolution](/docs/conflict-resolution) - Learn how data conflicts are handled
- [Optimizing Performance](/docs/performance) - Strategies for faster queries and operations
