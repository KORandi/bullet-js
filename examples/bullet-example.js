/**
 * Bullet.js Example with Storage
 */

const Bullet = require("../src/bullet");

// Initialize a Bullet instance with storage enabled
const bullet = new Bullet({
  server: false, // Disable networking for this example
  storage: true,
  storagePath: "./bullet-data",
  encrypt: true,
  encryptionKey: "my-secret-key",
});

// Listen for data changes
bullet.get("users/john").on((data) => {
  console.log("User data updated:", data);
});

// Set some initial data
bullet.get("users/john").put({
  name: "John Doe",
  email: "john@example.com",
  age: 30,
});

// After some time, update the data
setTimeout(() => {
  bullet.get("users/john").put({
    name: "John Doe",
    email: "john@example.com",
    age: 31,
    lastLogin: new Date().toISOString(),
  });

  // Show current data state
  console.log("Current store:", bullet.store);
}, 2000);

// Proper shutdown after 5 seconds
setTimeout(() => {
  console.log("Shutting down...");
  bullet.close();

  // Example of reopening with the same storage
  setTimeout(() => {
    console.log("Reopening database...");

    const newBullet = new Bullet({
      server: false,
      storage: true,
      storagePath: "./bullet-data",
      encrypt: true,
      encryptionKey: "my-secret-key",
    });

    // Verify data was restored from storage
    console.log("Restored data:", newBullet.store);

    // Get a specific node
    const johnData = newBullet.get("users/john").value();
    console.log("Restored user data:", johnData);

    // Close again
    newBullet.close();

    console.log("Example completed");
  }, 1000);
}, 5000);
