/**
 * Bullet.js Serialization Example
 */

const Bullet = require("../src/bullet");
const fs = require("fs");
const path = require("path");

// Initialize a Bullet instance with serializer enabled
const bullet = new Bullet({
  server: false, // Disable networking for this example
  storage: false, // Disable storage for this example
  enableSerializer: true,
});

// Create a directory for exported files
const exportDir = "./exports";
if (!fs.existsSync(exportDir)) {
  fs.mkdirSync(exportDir);
}

// Helper function to write file
function writeFile(filename, content) {
  fs.writeFileSync(path.join(exportDir, filename), content);
  console.log(`File written: ${filename}`);
}

console.log("\n=== SERIALIZATION EXAMPLES ===\n");

// Populate with sample data
console.log("Populating database with sample data...");

// Users
bullet.get("users/user1").put({
  name: "Alice Johnson",
  email: "alice@example.com",
  createdAt: new Date("2023-01-15T08:30:00Z"),
  role: "admin",
  settings: {
    notifications: true,
    theme: "dark",
  },
  tags: ["staff", "developer"],
});

bullet.get("users/user2").put({
  name: "Bob Smith",
  email: "bob@example.com",
  createdAt: new Date("2023-02-20T14:45:00Z"),
  role: "user",
  settings: {
    notifications: false,
    theme: "light",
  },
  tags: ["customer"],
});

// Products
bullet.get("products/prod1").put({
  name: "Smartphone",
  price: 699.99,
  stock: 42,
  features: ["5G", "Dual camera", "Fast charging"],
  category: "electronics",
});

bullet.get("products/prod2").put({
  name: "Laptop",
  price: 1299.99,
  stock: 15,
  features: ["SSD", "16GB RAM", "Dedicated GPU"],
  category: "electronics",
});

bullet.get("products/prod3").put({
  name: "Headphones",
  price: 149.99,
  stock: 78,
  features: ["Noise cancellation", "Bluetooth", "Long battery life"],
  category: "accessories",
});

// Orders
bullet.get("orders/order1").put({
  customerId: "user2",
  items: [
    { productId: "prod1", quantity: 1, price: 699.99 },
    { productId: "prod3", quantity: 1, price: 149.99 },
  ],
  total: 849.98,
  status: "shipped",
  createdAt: new Date("2023-03-10T09:15:00Z"),
});

// Example 1: JSON Export & Import
console.log("\n1. JSON Export & Import:");

// Export all data
const allDataJson = bullet.exportToJSON("", { prettyPrint: true });
writeFile("all_data.json", allDataJson);

// Export just users
const usersJson = bullet.exportToJSON("users", { prettyPrint: true });
writeFile("users.json", usersJson);

// Create a new Bullet instance for import testing
const importBullet = new Bullet({
  server: false,
  storage: false,
  enableSerializer: true,
});

// Import the users data
const importResult = importBullet.importFromJSON(usersJson, "imported_users");
console.log("Import result:", importResult);
console.log("Imported data:", importBullet.get("imported_users").value());

// Example 2: CSV Export & Import
console.log("\n2. CSV Export & Import:");

// Export users to CSV
const usersCSV = bullet.exportToCSV("users", {
  delimiter: ",",
  includeHeaders: true,
});
writeFile("users.csv", usersCSV);

// Export products to CSV
const productsCSV = bullet.exportToCSV("products", {
  delimiter: ",",
  includeHeaders: true,
});
writeFile("products.csv", productsCSV);

// Import CSV data
const csvImportBullet = new Bullet({
  server: false,
  storage: false,
  enableSerializer: true,
});

// Import from CSV
const csvContent = `id,name,email,role
user3,Charlie Brown,charlie@example.com,editor
user4,Diana Prince,diana@example.com,admin`;

const csvImportResult = csvImportBullet.importFromCSV(csvContent, "csv_users");
console.log("CSV Import result:", csvImportResult);
console.log("Imported CSV data:", csvImportBullet.get("csv_users").value());

// Example 3: XML Export & Import
console.log("\n3. XML Export & Import:");

// Export all data to XML
const allDataXML = bullet.exportToXML("", {
  rootName: "bulletData",
  indent: "  ",
});
writeFile("all_data.xml", allDataXML);

// Export just products to XML
const productsXML = bullet.exportToXML("products", {
  rootName: "products",
  indent: "  ",
});
writeFile("products.xml", productsXML);

// Example 4: Custom Type Serialization
console.log("\n4. Custom Type Serialization:");

// Define a custom type
class CustomPoint {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  distance() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
}

// Register serializer for the custom type
bullet.registerSerializerType(
  "CustomPoint",
  (point) => ({ __type: "CustomPoint", x: point.x, y: point.y }),
  (data) => new CustomPoint(data.x, data.y)
);

// Add data with custom type
bullet.get("locations/loc1").put({
  name: "Office",
  position: new CustomPoint(10, 20),
  active: true,
});

bullet.get("locations/loc2").put({
  name: "Warehouse",
  position: new CustomPoint(30, 40),
  active: false,
});

// Export with custom types
const locationsJson = bullet.exportToJSON("locations", { prettyPrint: true });
writeFile("locations.json", locationsJson);

// Import with custom types
const customTypeBullet = new Bullet({
  server: false,
  storage: false,
  enableSerializer: true,
});

// Register the same custom type
customTypeBullet.registerSerializerType(
  "CustomPoint",
  (point) => ({ __type: "CustomPoint", x: point.x, y: point.y }),
  (data) => new CustomPoint(data.x, data.y)
);

// Import the data
const customImportResult = customTypeBullet.importFromJSON(
  locationsJson,
  "imported_locations"
);
console.log("Custom type import result:", customImportResult);

// Verify the custom type was properly deserialized
const location = customTypeBullet.get("imported_locations/loc1").value();
console.log("Imported location:", location);
// Change to:
console.log(
  "Position has x and y:",
  "x" in location.position && "y" in location.position
);
console.log(
  "Distance calculation:",
  Math.sqrt(
    location.position.x * location.position.x +
      location.position.y * location.position.y
  )
);

// Example 5: Incremental Exports
console.log("\n5. Incremental Export:");

// Add a new user
bullet.get("users/user3").put({
  name: "Charlie Davis",
  email: "charlie@example.com",
  createdAt: new Date(),
  role: "editor",
});

// Export just the new user
const newUserJson = bullet.exportToJSON("users/user3", { prettyPrint: true });
writeFile("new_user.json", newUserJson);

console.log("\nAll serialization examples completed.");
console.log(`Files have been written to ${path.resolve(exportDir)}`);

// Clean up
bullet.close();
importBullet.close();
csvImportBullet.close();
customTypeBullet.close();
