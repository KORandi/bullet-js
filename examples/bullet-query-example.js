/**
 * Bullet.js Query Example
 */

const Bullet = require("../src/bullet");

// Initialize a Bullet instance
const bullet = new Bullet({
  server: false, // Disable networking for this example
  storage: false, // Disable storage for this example
  enableIndexing: true, // Enable query capabilities
});

// Populate with sample user data
console.log("Populating database with sample data...");

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

// Add users to the database
for (const [id, data] of Object.entries(users)) {
  bullet.get(`users/${id}`).put(data);
}

// Add some products
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

// Add products to the database
for (const [id, data] of Object.entries(products)) {
  bullet.get(`products/${id}`).put(data);
}

// Create some indices for faster querying
console.log("Creating indices...");
bullet.index("users", "role"); // Index users by role
bullet.index("users", "age"); // Index users by age
bullet.index("users", "active"); // Index users by active status
bullet.index("products", "category"); // Index products by category
bullet.index("products", "price"); // Index products by price

// Wait a moment for indices to be built
setTimeout(() => {
  console.log("\n--- QUERY EXAMPLES ---\n");

  // Example 1: Find all admin users
  console.log("1. Find all admin users:");
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

  // Example 6: Find the first user over 40
  console.log("\n6. Find the first user over 40:");
  const olderUser = bullet.find("users", (user) => user.age > 40);
  if (olderUser) {
    console.log(
      `- ${olderUser.value().name}, ${olderUser.value().age} years old`
    );
  } else {
    console.log("- No users over 40 found");
  }

  // Example 7: Map user names to an array
  console.log("\n7. Extract all user names:");
  const userNames = bullet.query.map("users", (user) => user.name);
  console.log(`- ${userNames.join(", ")}`);

  // Example 8: Find low stock products
  console.log("\n8. Find products with low stock (less than 10):");
  const lowStockProducts = bullet.filter(
    "products",
    (product) => product.stock < 10
  );
  lowStockProducts.forEach((node) => {
    console.log(`- ${node.value().name}: ${node.value().stock} in stock`);
  });

  // Example 9: Price range query using the index
  console.log("\n9. Find medium-priced products ($100-$300):");
  const mediumPriced = bullet.range("products", "price", 100, 300);
  mediumPriced.forEach((node) => {
    console.log(`- ${node.value().name}: $${node.value().price}`);
  });

  // Example 10: Complex filter with multiple conditions
  console.log("\n10. Find active users under 30 with non-admin roles:");
  const youngActiveNonAdmins = bullet.filter(
    "users",
    (user) => user.active === true && user.age < 30 && user.role !== "admin"
  );
  youngActiveNonAdmins.forEach((node) => {
    console.log(
      `- ${node.value().name}, ${node.value().age}, ${node.value().role}`
    );
  });

  console.log("\nAll query examples completed.");

  // Clean up
  bullet.close();
}, 1000);
