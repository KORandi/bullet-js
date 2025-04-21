/**
 * Bullet.js LevelDB Storage Example
 */

const Bullet = require("../src/bullet");
const BulletLevelDBStorage = require("../src/bullet-leveldb-storage");

// Initialize a Bullet instance
const bullet = new Bullet({
  server: false, // Disable networking for this example
  storage: false, // Disable built-in storage
});

// Initialize and attach LevelDB storage
const levelStorage = new BulletLevelDBStorage(bullet, {
  path: "./bullet-leveldb-data",
  encrypt: true,
  encryptionKey: "my-secret-leveldb-key",
  saveInterval: 2000, // Save every 2 seconds
});

// Replace built-in storage
bullet.storage = levelStorage;

// Listen for data changes
bullet.get("users/john").on((data) => {
  console.log("User data updated:", data);
});

// Set some initial data
console.log("Setting initial data...");
bullet.get("users/john").put({
  name: "John Doe",
  email: "john@example.com",
  age: 30,
});

// After a few seconds, update the data
setTimeout(() => {
  console.log("\nUpdating user data...");
  bullet.get("users/john").put({
    name: "John Doe",
    email: "john@example.com",
    age: 31,
    lastLogin: new Date().toISOString(),
  });

  // Show current data state
  console.log("Current store:", bullet.store);
}, 3000);

// Add more complex nested data after a delay
setTimeout(() => {
  console.log("\nAdding more complex nested data...");

  bullet.get("users/jane").put({
    name: "Jane Smith",
    email: "jane@example.com",
    age: 28,
    preferences: {
      theme: "dark",
      notifications: true,
      privacy: {
        showEmail: false,
        showAge: true,
      },
    },
    lastLogin: new Date().toISOString(),
    favorites: [1, 2, 3, 5, 8, 13],
  });

  // Add product data
  bullet.get("products/product1").put({
    name: "Awesome Product",
    price: 99.99,
    inStock: true,
    tags: ["electronics", "featured"],
    attributes: {
      color: "blue",
      size: "medium",
      dimensions: {
        width: 10,
        height: 15,
        depth: 5,
      },
    },
  });

  console.log("Added complex data");
}, 5000);

// Proper shutdown after a few seconds
setTimeout(() => {
  console.log("\nShutting down...");
  bullet.close();

  // Example of reopening with the same storage
  setTimeout(() => {
    console.log("\nReopening database with LevelDB storage...");

    const newBullet = new Bullet({
      server: false,
      storage: false,
    });

    // Initialize and attach LevelDB storage again
    const newLevelStorage = new BulletLevelDBStorage(newBullet, {
      path: "./bullet-leveldb-data",
      encrypt: true,
      encryptionKey: "my-secret-leveldb-key",
    });

    // Replace built-in storage
    newBullet.storage = newLevelStorage;

    // Wait for data to load
    setTimeout(() => {
      // Verify data was restored from storage
      console.log("\nRestored data:");
      console.log("- Users:", Object.keys(newBullet.store.users || {}));
      console.log("- Products:", Object.keys(newBullet.store.products || {}));

      // Get a specific node
      const johnData = newBullet.get("users/john").value();
      console.log("\nRestored user data for John:", johnData);

      // Get complex nested data
      const janeData = newBullet.get("users/jane").value();
      console.log("\nRestored user data for Jane:", janeData);

      // Get a product
      const productData = newBullet.get("products/product1").value();
      console.log("\nRestored product data:", productData);

      // Close again
      newBullet.close();

      console.log("\nExample completed");
    }, 2000);
  }, 2000);
}, 8000);

console.log("LevelDB storage example running...");
