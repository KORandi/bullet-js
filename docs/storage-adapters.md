# Storage Adapters

Bullet.js offers flexible storage options through its storage adapter system. This guide explains how persistence works in Bullet.js and how you can create custom storage adapters to meet your specific needs.

## You will learn

- How storage works in Bullet.js
- How to configure built-in storage options
- How to create custom storage adapters
- How to implement encryption for stored data
- Best practices for data persistence

## Understanding Storage in Bullet.js

Bullet.js can operate as an in-memory database or persist data using various storage mechanisms. The storage system is responsible for:

- Saving data to persistent storage
- Loading data when the database starts
- Handling encryption and decryption
- Managing incremental saves and backups

## Built-in Storage Options

Bullet.js comes with two built-in storage adapters:

### File Storage

The default storage adapter saves data to the filesystem as JSON files:

```javascript
const bullet = new Bullet({
  storage: true, // Enable storage
  storageType: "file", // Use file storage (default)
  storagePath: "./data", // Where to store data files
  saveInterval: 5000, // Save every 5 seconds
  encrypt: false, // Whether to encrypt stored data
  encryptionKey: null, // Encryption key if enabled
  enableStorageLog: false, // Whether to log storage operations
});
```

File storage creates three main files:

- `store.json`: Contains your database data
- `meta.json`: Contains metadata like timestamps and vector clocks
- `log.json`: Contains a transaction log

### Memory Storage

The memory storage adapter keeps data only in memory with no persistence:

```javascript
const bullet = new Bullet({
  storage: true,
  storageType: "memory", // Use memory storage
  snapshotInterval: 0, // Optional in-memory snapshots
  enableStorageLog: false, // Whether to log storage operations
});
```

Memory storage is useful for:

- Testing and development
- Temporary data that doesn't need to persist
- Scenarios where you handle persistence separately

## Configuring Storage

### Basic Configuration

```javascript
// File storage with encryption
const bullet = new Bullet({
  storage: true,
  storageType: "file",
  storagePath: "./secure-data",
  encrypt: true,
  encryptionKey: "your-secret-key", // In production, use a secure method
  saveInterval: 10000, // Save every 10 seconds
});

// Memory storage with snapshots
const bullet = new Bullet({
  storage: true,
  storageType: "memory",
  snapshotInterval: 60000, // Create in-memory snapshots every minute
});
```

### Advanced Configuration

```javascript
// More detailed configuration
const bullet = new Bullet({
  storage: true,
  storageType: "file",
  storagePath: "./data",
  saveInterval: 5000,

  // Encryption options
  encrypt: true,
  encryptionKey: process.env.ENCRYPTION_KEY,
  encryptionAlgorithm: "aes-256-cbc", // Encryption algorithm

  // Advanced options
  compressData: true, // Compress data before storage
  backupInterval: 24 * 60 * 60 * 1000, // Daily backups
  maxBackups: 7, // Keep last 7 backups
  enableStorageLog: true, // Log storage operations
});
```

## Creating Custom Storage Adapters

Bullet.js allows you to create custom storage adapters to integrate with any storage system.

### Basic Storage Adapter Template

Here's the basic structure of a custom storage adapter:

```javascript
// MyCustomStorage.js
const BulletStorage = require('bullet-js').Storage;

class MyCustomStorage extends BulletStorage {
  constructor(bullet, options = {}) {
    super(bullet, {
      // Default options
      customOption1: 'default1',
      customOption2: 'default2',
      ...options
    });

    // Initialize your storage
    this._initStorage();
  }

  /**
   * Initialize the storage system
   * @protected
   * @override
   */
  _initStorage() {
    // Custom initialization code
    // Call super._initStorage() if needed

    // Load data immediately
    this._loadData();

    // Setup save interval if needed
    if (this.options.saveInterval > 0) {
      this.saveInterval = setInterval(() => {
        this._saveData();
      }, this.options.saveInterval);
    }
  }

  /**
   * Load data from storage
   * @protected
   * @override
   */
  _loadData() {
    try {
      // Custom code to load data from your storage system
      const loadedData = /* your loading logic */;

      // Merge loaded data into Bullet's store
      this._deepMerge(this.bullet.store, loadedData.store || {});
      Object.assign(this.bullet.meta, loadedData.meta || {});
      this.bullet.log = [...this.bullet.log, ...(loadedData.log || [])];

      // Track loaded state
      this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
      this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
      this.persisted.log = [...this.bullet.log];

      if (this.options.enableStorageLog) {
        console.log('Bullet: Data loaded from custom storage');
      }
    } catch (err) {
      console.error('Error loading persisted data:', err);
    }
  }

  /**
   * Save data to storage
   * @protected
   * @override
   * @returns {Promise} - Resolves when save is complete
   */
  _saveData() {
    try {
      if (this._hasChanges()) {
        // Custom code to save data to your storage system
        const dataToSave = {
          store: this.bullet.store,
          meta: this.bullet.meta,
          log: this.bullet.log
        };

        /* your saving logic */

        // Update persisted state
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];

        if (this.options.enableStorageLog) {
          console.log('Bullet: Data persisted to custom storage');
        }
      }
    } catch (err) {
      console.error('Error saving data:', err);
    }

    return Promise.resolve();
  }

  /**
   * Clean up resources when closing
   * @public
   * @override
   */
  async close() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    await this._saveData();

    // Custom cleanup code

    if (this.options.enableStorageLog) {
      console.log('Bullet: Custom storage closed');
    }
  }
}

module.exports = MyCustomStorage;
```

### Registering Your Custom Storage Adapter

```javascript
// Register your custom storage adapter
const Bullet = require("bullet-js");
const MyCustomStorage = require("./MyCustomStorage");

// Option 1: Pass the constructor
const bullet = new Bullet({
  storage: true,
  storageType: MyCustomStorage,
  customOption1: "value1",
  customOption2: "value2",
});

// Option 2: Create and attach manually
const bullet = new Bullet({
  storage: false, // Disable automatic storage initialization
});

// Create and attach storage manually
bullet.storage = new MyCustomStorage(bullet, {
  customOption1: "value1",
  customOption2: "value2",
});
```

## Example: MongoDB Storage Adapter

Here's an example implementation of a MongoDB storage adapter:

```javascript
// MongoDBStorage.js
const BulletStorage = require("bullet-js").Storage;
const { MongoClient } = require("mongodb");

class MongoDBStorage extends BulletStorage {
  constructor(bullet, options = {}) {
    super(bullet, {
      // MongoDB connection options
      url: "mongodb://localhost:27017",
      database: "bulletjs",
      collection: "bulletData",
      connectOptions: {},
      saveInterval: 5000,
      ...options,
    });

    this.client = null;
    this.db = null;
    this.collection = null;

    // Initialize
    this._initStorage();
  }

  async _initStorage() {
    try {
      // Connect to MongoDB
      this.client = new MongoClient(
        this.options.url,
        this.options.connectOptions
      );
      await this.client.connect();

      this.db = this.client.db(this.options.database);
      this.collection = this.db.collection(this.options.collection);

      if (this.options.enableStorageLog) {
        console.log(`Bullet: Connected to MongoDB at ${this.options.url}`);
      }

      // Load data
      await this._loadData();

      // Setup save interval
      if (this.options.saveInterval > 0) {
        this.saveInterval = setInterval(() => {
          this._saveData();
        }, this.options.saveInterval);
      }
    } catch (err) {
      console.error("Error initializing MongoDB storage:", err);
    }
  }

  async _loadData() {
    try {
      // Find the latest data document
      const document = await this.collection.findOne(
        { type: "bullet-data" },
        { sort: { timestamp: -1 } }
      );

      if (document) {
        // Decrypt if needed
        let storeData, metaData, logData;

        if (this.options.encrypt) {
          storeData = JSON.parse(this._decrypt(document.store));
          metaData = JSON.parse(this._decrypt(document.meta));
          logData = JSON.parse(this._decrypt(document.log));
        } else {
          storeData = document.store;
          metaData = document.meta;
          logData = document.log;
        }

        // Apply data to Bullet instance
        this._deepMerge(this.bullet.store, storeData);
        Object.assign(this.bullet.meta, metaData);
        this.bullet.log = [...this.bullet.log, ...logData];

        // Track persisted state
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];

        if (this.options.enableStorageLog) {
          console.log("Bullet: Data loaded from MongoDB");
        }
      }
    } catch (err) {
      console.error("Error loading data from MongoDB:", err);
    }
  }

  async _saveData() {
    try {
      if (this._hasChanges()) {
        let storeData = this.bullet.store;
        let metaData = this.bullet.meta;
        let logData = this.bullet.log;

        // Encrypt if needed
        if (this.options.encrypt) {
          storeData = this._encrypt(JSON.stringify(storeData));
          metaData = this._encrypt(JSON.stringify(metaData));
          logData = this._encrypt(JSON.stringify(logData));
        }

        // Save data document
        await this.collection.insertOne({
          type: "bullet-data",
          timestamp: new Date(),
          store: storeData,
          meta: metaData,
          log: logData,
        });

        // Update persisted state
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];

        if (this.options.enableStorageLog) {
          console.log("Bullet: Data persisted to MongoDB");
        }
      }
    } catch (err) {
      console.error("Error saving data to MongoDB:", err);
    }

    return Promise.resolve();
  }

  /**
   * Encrypt data if encryption is enabled
   * @param {string} data - Data to encrypt
   * @return {string} - Encrypted data
   * @private
   */
  _encrypt(data) {
    // Implement encryption using this.options.encryptionKey
    // This is a simplified example
    return `encrypted:${data}`;
  }

  /**
   * Decrypt data if encryption is enabled
   * @param {string} data - Data to decrypt
   * @return {string} - Decrypted data
   * @private
   */
  _decrypt(data) {
    // Implement decryption using this.options.encryptionKey
    // This is a simplified example
    return data.replace("encrypted:", "");
  }

  async close() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    await this._saveData();

    if (this.client) {
      await this.client.close();

      if (this.options.enableStorageLog) {
        console.log("Bullet: MongoDB connection closed");
      }
    }
  }
}

module.exports = MongoDBStorage;
```

## Example: Redis Storage Adapter

Here's an example of a Redis storage adapter:

```javascript
// RedisStorage.js
const BulletStorage = require("bullet-js").Storage;
const Redis = require("ioredis");

class RedisStorage extends BulletStorage {
  constructor(bullet, options = {}) {
    super(bullet, {
      // Redis connection options
      host: "localhost",
      port: 6379,
      keyPrefix: "bullet:",
      saveInterval: 5000,
      ...options,
    });

    this.redis = null;

    // Initialize
    this._initStorage();
  }

  _initStorage() {
    // Connect to Redis
    this.redis = new Redis({
      host: this.options.host,
      port: this.options.port,
      // Additional Redis options
      ...this.options.redisOptions,
    });

    // Handle connection events
    this.redis.on("connect", () => {
      if (this.options.enableStorageLog) {
        console.log(
          `Bullet: Connected to Redis at ${this.options.host}:${this.options.port}`
        );
      }
    });

    this.redis.on("error", (err) => {
      console.error("Redis connection error:", err);
    });

    // Load data
    this._loadData();

    // Setup save interval
    if (this.options.saveInterval > 0) {
      this.saveInterval = setInterval(() => {
        this._saveData();
      }, this.options.saveInterval);
    }
  }

  async _loadData() {
    try {
      // Get data from Redis
      const storeData = await this.redis.get(`${this.options.keyPrefix}store`);
      const metaData = await this.redis.get(`${this.options.keyPrefix}meta`);
      const logData = await this.redis.get(`${this.options.keyPrefix}log`);

      if (storeData) {
        const store = JSON.parse(
          this.options.encrypt ? this._decrypt(storeData) : storeData
        );
        this._deepMerge(this.bullet.store, store);
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
      }

      if (metaData) {
        const meta = JSON.parse(
          this.options.encrypt ? this._decrypt(metaData) : metaData
        );
        Object.assign(this.bullet.meta, meta);
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
      }

      if (logData) {
        const log = JSON.parse(
          this.options.encrypt ? this._decrypt(logData) : logData
        );
        this.bullet.log = [...this.bullet.log, ...log];
        this.persisted.log = [...this.bullet.log];
      }

      if (this.options.enableStorageLog) {
        console.log("Bullet: Data loaded from Redis");
      }
    } catch (err) {
      console.error("Error loading data from Redis:", err);
    }
  }

  async _saveData() {
    try {
      if (this._hasChanges()) {
        const storeJson = JSON.stringify(this.bullet.store);
        const metaJson = JSON.stringify(this.bullet.meta);
        const logJson = JSON.stringify(this.bullet.log);

        const storeData = this.options.encrypt
          ? this._encrypt(storeJson)
          : storeJson;
        const metaData = this.options.encrypt
          ? this._encrypt(metaJson)
          : metaJson;
        const logData = this.options.encrypt ? this._encrypt(logJson) : logJson;

        // Use pipeline for atomic multi-key update
        await this.redis
          .pipeline()
          .set(`${this.options.keyPrefix}store`, storeData)
          .set(`${this.options.keyPrefix}meta`, metaData)
          .set(`${this.options.keyPrefix}log`, logData)
          .exec();

        // Update persisted state
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];

        if (this.options.enableStorageLog) {
          console.log("Bullet: Data persisted to Redis");
        }
      }
    } catch (err) {
      console.error("Error saving data to Redis:", err);
    }

    return Promise.resolve();
  }

  // Encryption methods (implement as needed)
  _encrypt(data) {
    // Implement encryption
    return `encrypted:${data}`;
  }

  _decrypt(data) {
    // Implement decryption
    return data.replace("encrypted:", "");
  }

  async close() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    await this._saveData();

    if (this.redis) {
      this.redis.disconnect();

      if (this.options.enableStorageLog) {
        console.log("Bullet: Redis connection closed");
      }
    }
  }
}

module.exports = RedisStorage;
```

## Implementing Secure Encryption

For production systems, implement proper encryption:

```javascript
// Secure encryption implementation example
const crypto = require("crypto");

// Encrypt data
function encryptData(data, key) {
  try {
    // Derive a key from the provided key
    const derivedKey = crypto.scryptSync(key, "salt", 32);

    // Generate a random initialization vector
    const iv = crypto.randomBytes(16);

    // Create cipher
    const cipher = crypto.createCipheriv("aes-256-cbc", derivedKey, iv);

    // Encrypt the data
    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");

    // Return IV and encrypted data
    return iv.toString("hex") + ":" + encrypted;
  } catch (err) {
    console.error("Encryption error:", err);
    return data;
  }
}

// Decrypt data
function decryptData(data, key) {
  try {
    // Split IV and encrypted data
    const parts = data.split(":");
    if (parts.length !== 2) return data;

    // Derive the same key
    const derivedKey = crypto.scryptSync(key, "salt", 32);

    // Convert IV back to Buffer
    const iv = Buffer.from(parts[0], "hex");

    // Create decipher
    const decipher = crypto.createDecipheriv("aes-256-cbc", derivedKey, iv);

    // Decrypt the data
    let decrypted = decipher.update(parts[1], "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (err) {
    console.error("Decryption error:", err);
    return data;
  }
}
```

## Partial Storage Implementation

You might want to store only certain paths:

```javascript
class PartialStorage extends BulletStorage {
  constructor(bullet, options = {}) {
    super(bullet, {
      // Store only specific paths
      includePaths: ["users", "settings"],
      excludePaths: ["temp", "cache"],
      ...options,
    });

    // ...implementation details
  }

  _saveData() {
    try {
      if (this._hasChanges()) {
        // Filter data based on include/exclude paths
        const dataToSave = {
          store: this._filterPaths(this.bullet.store),
          meta: this._filterMetadata(),
          log: this.bullet.log,
        };

        // Save filtered data
        // ...saving implementation
      }
    } catch (err) {
      console.error("Error saving data:", err);
    }

    return Promise.resolve();
  }

  _filterPaths(data, currentPath = "") {
    const result = {};

    for (const [key, value] of Object.entries(data)) {
      const path = currentPath ? `${currentPath}/${key}` : key;

      // Check if path should be included
      const shouldInclude = this._shouldIncludePath(path);

      if (shouldInclude) {
        if (
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value)
        ) {
          // Recursively filter nested objects
          result[key] = this._filterPaths(value, path);
        } else {
          // Include the value
          result[key] = value;
        }
      }
    }

    return result;
  }

  _shouldIncludePath(path) {
    // Check exclude paths first
    if (this.options.excludePaths) {
      for (const excludePath of this.options.excludePaths) {
        if (path === excludePath || path.startsWith(`${excludePath}/`)) {
          return false;
        }
      }
    }

    // If include paths are specified, check those
    if (this.options.includePaths && this.options.includePaths.length > 0) {
      for (const includePath of this.options.includePaths) {
        if (path === includePath || path.startsWith(`${includePath}/`)) {
          return true;
        }
      }
      return false;
    }

    // Default to include all paths not excluded
    return true;
  }

  _filterMetadata() {
    // Filter metadata to match filtered paths
    const filteredMeta = {};

    for (const [path, meta] of Object.entries(this.bullet.meta)) {
      if (this._shouldIncludePath(path)) {
        filteredMeta[path] = meta;
      }
    }

    return filteredMeta;
  }
}
```

## Best Practices

### 1. Choose the Right Storage Type

```javascript
// For development and testing
const devBullet = new Bullet({
  storage: true,
  storageType: "memory",
});

// For production with sensitive data
const prodBullet = new Bullet({
  storage: true,
  storageType: "file",
  storagePath: "./data",
  encrypt: true,
  encryptionKey: process.env.ENCRYPTION_KEY,
});

// For high-performance applications
const highPerfBullet = new Bullet({
  storage: true,
  storageType: CustomRedisStorage,
  host: "redis.example.com",
  port: 6379,
});
```

### 2. Handle Storage Errors Gracefully

```javascript
bullet.on("storage:error", (error) => {
  console.error("Storage error:", error);

  // Notify administrators
  notifyAdmin("Storage error: " + error.message);

  // Try to recover
  setTimeout(() => {
    bullet.storage.save();
  }, 5000);
});
```

### 3. Implement Backup Strategies

```javascript
// Regular backups
setInterval(async () => {
  // Export database to JSON
  const backup = bullet.exportToJSON();

  // Save to backup location with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(`./backups/bullet-${timestamp}.json`, backup);

  // Keep only last 10 backups
  const backups = fs.readdirSync("./backups").sort();
  while (backups.length > 10) {
    fs.unlinkSync("./backups/" + backups.shift());
  }
}, 24 * 60 * 60 * 1000); // Daily backups
```

### 4. Optimize Storage Frequency

```javascript
// Heavy write operations
const writeBullet = new Bullet({
  storage: true,
  saveInterval: 30000, // Less frequent saves
});

// Critical data
const criticalBullet = new Bullet({
  storage: true,
  saveInterval: 1000, // More frequent saves
});
```

### 5. Monitor Storage Performance

```javascript
let lastSaveTime = 0;
let maxSaveTime = 0;

bullet.on("storage:save:start", () => {
  lastSaveTime = Date.now();
});

bullet.on("storage:save:complete", () => {
  const duration = Date.now() - lastSaveTime;
  maxSaveTime = Math.max(maxSaveTime, duration);

  console.log(`Storage save completed in ${duration}ms`);

  if (duration > 5000) {
    console.warn("Storage save took more than 5 seconds!");
  }
});
```

## Complete Example

Here's a complete example showing how to use and create storage adapters:

```javascript
const Bullet = require("bullet-js");
const fs = require("fs");
const path = require("path");

// Create a custom storage adapter
class JsonFileStorage extends BulletStorage {
  constructor(bullet, options = {}) {
    super(bullet, {
      directory: "./custom-data",
      filename: "bullet-data.json",
      saveInterval: 10000,
      createBackups: true,
      maxBackups: 5,
      ...options,
    });

    // Ensure directory exists
    if (!fs.existsSync(this.options.directory)) {
      fs.mkdirSync(this.options.directory, { recursive: true });
    }

    this._initStorage();
  }

  _initStorage() {
    this._loadData();

    if (this.options.saveInterval > 0) {
      this.saveInterval = setInterval(() => {
        this._saveData();
      }, this.options.saveInterval);
    }
  }

  _loadData() {
    try {
      const filePath = path.join(this.options.directory, this.options.filename);

      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(data);

        if (parsed.store) {
          this._deepMerge(this.bullet.store, parsed.store);
        }

        if (parsed.meta) {
          Object.assign(this.bullet.meta, parsed.meta);
        }

        if (parsed.log) {
          this.bullet.log = [...this.bullet.log, ...parsed.log];
        }

        // Update persisted state
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];

        if (this.options.enableStorageLog) {
          console.log(`Bullet: Data loaded from ${filePath}`);
        }
      }
    } catch (err) {
      console.error("Error loading data:", err);
    }
  }

  async _saveData() {
    try {
      if (this._hasChanges()) {
        const filePath = path.join(
          this.options.directory,
          this.options.filename
        );

        // Create backup if needed
        if (this.options.createBackups && fs.existsSync(filePath)) {
          this._createBackup(filePath);
        }

        // Prepare data
        const dataToSave = {
          timestamp: new Date().toISOString(),
          store: this.bullet.store,
          meta: this.bullet.meta,
          log: this.bullet.log,
        };

        // Write to file
        fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2));

        // Update persisted state
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];

        if (this.options.enableStorageLog) {
          console.log(`Bullet: Data saved to ${filePath}`);
        }
      }
    } catch (err) {
      console.error("Error saving data:", err);
    }

    return Promise.resolve();
  }

  _createBackup(filePath) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = `${filePath}.${timestamp}.bak`;

      fs.copyFileSync(filePath, backupPath);

      if (this.options.enableStorageLog) {
        console.log(`Bullet: Created backup at ${backupPath}`);
      }

      // Manage backup count
      if (this.options.maxBackups > 0) {
        const dir = path.dirname(filePath);
        const baseFilename = path.basename(filePath);

        // Find all backups
        const backups = fs
          .readdirSync(dir)
          .filter(
            (file) =>
              file.startsWith(`${baseFilename}.`) && file.endsWith(".bak")
          )
          .sort()
          .reverse();

        // Remove excess backups
        while (backups.length > this.options.maxBackups) {
          const oldBackup = backups.pop();
          fs.unlinkSync(path.join(dir, oldBackup));

          if (this.options.enableStorageLog) {
            console.log(`Bullet: Removed old backup ${oldBackup}`);
          }
        }
      }
    } catch (err) {
      console.error("Error creating backup:", err);
    }
  }

  async close() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    await this._saveData();

    if (this.options.enableStorageLog) {
      console.log("Bullet: Custom storage closed");
    }
  }
}

// Initialize Bullet with custom storage
const bullet = new Bullet({
  storage: true,
  storageType: JsonFileStorage,
  directory: "./custom-storage",
  createBackups: true,
  enableStorageLog: true,
});

// Add some data
bullet.get("users/alice").put({
  name: "Alice Johnson",
  email: "alice@example.com",
  role: "admin",
});

bullet.get("users/bob").put({
  name: "Bob Smith",
  email: "bob@example.com",
  role: "user",
});

// Force a save
bullet.storage.save();

// Properly shut down
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await bullet.close();
  process.exit(0);
});
```

## Multi-Tier Storage Strategy

For advanced applications, you might want to implement a multi-tier storage strategy:

```javascript
// MultiTierStorage.js
const BulletStorage = require("bullet-js").Storage;
const fs = require("fs");
const Redis = require("ioredis");

class MultiTierStorage extends BulletStorage {
  constructor(bullet, options = {}) {
    super(bullet, {
      // Primary storage (fast)
      primary: {
        type: "redis",
        host: "localhost",
        port: 6379,
        keyPrefix: "bullet:primary:",
      },

      // Secondary storage (persistent)
      secondary: {
        type: "file",
        directory: "./data",
        filename: "bullet-data.json",
      },

      // Settings
      primarySaveInterval: 1000, // Save to primary every second
      secondarySaveInterval: 60000, // Save to secondary every minute
      ...options,
    });

    this.redis = null;
    this.primaryTimer = null;
    this.secondaryTimer = null;

    this._initStorage();
  }

  async _initStorage() {
    // Initialize Redis for primary storage
    if (this.options.primary.type === "redis") {
      this.redis = new Redis({
        host: this.options.primary.host,
        port: this.options.primary.port,
      });

      this.redis.on("error", (err) => {
        console.error("Redis error:", err);
      });
    }

    // Load data (prioritize secondary as it's persistent)
    await this._loadFromSecondary();

    // Only try primary if secondary load failed or was empty
    if (Object.keys(this.bullet.store).length === 0) {
      await this._loadFromPrimary();
    }

    // Set up save intervals
    if (this.options.primarySaveInterval > 0) {
      this.primaryTimer = setInterval(() => {
        this._saveToPrimary();
      }, this.options.primarySaveInterval);
    }

    if (this.options.secondarySaveInterval > 0) {
      this.secondaryTimer = setInterval(() => {
        this._saveToSecondary();
      }, this.options.secondarySaveInterval);
    }
  }

  async _loadFromPrimary() {
    if (!this.redis) return;

    try {
      const data = await this.redis.get(
        `${this.options.primary.keyPrefix}data`
      );

      if (data) {
        const parsed = JSON.parse(data);

        this._deepMerge(this.bullet.store, parsed.store || {});
        Object.assign(this.bullet.meta, parsed.meta || {});
        this.bullet.log = [...this.bullet.log, ...(parsed.log || [])];

        if (this.options.enableStorageLog) {
          console.log("Bullet: Data loaded from primary storage");
        }
      }
    } catch (err) {
      console.error("Error loading from primary storage:", err);
    }
  }

  async _loadFromSecondary() {
    try {
      const filePath = `${this.options.secondary.directory}/${this.options.secondary.filename}`;

      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(data);

        this._deepMerge(this.bullet.store, parsed.store || {});
        Object.assign(this.bullet.meta, parsed.meta || {});
        this.bullet.log = [...this.bullet.log, ...(parsed.log || [])];

        // Update persisted state
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];

        if (this.options.enableStorageLog) {
          console.log("Bullet: Data loaded from secondary storage");
        }

        return true;
      }
    } catch (err) {
      console.error("Error loading from secondary storage:", err);
    }

    return false;
  }

  async _saveToPrimary() {
    if (!this.redis) return;

    try {
      if (this._hasChanges()) {
        const data = {
          timestamp: Date.now(),
          store: this.bullet.store,
          meta: this.bullet.meta,
          log: this.bullet.log,
        };

        await this.redis.set(
          `${this.options.primary.keyPrefix}data`,
          JSON.stringify(data)
        );

        if (this.options.enableStorageLog) {
          console.log("Bullet: Data saved to primary storage");
        }
      }
    } catch (err) {
      console.error("Error saving to primary storage:", err);
    }
  }

  async _saveToSecondary() {
    try {
      if (this._hasChanges()) {
        const dirPath = this.options.secondary.directory;
        const filePath = `${dirPath}/${this.options.secondary.filename}`;

        // Ensure directory exists
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }

        const data = {
          timestamp: Date.now(),
          store: this.bullet.store,
          meta: this.bullet.meta,
          log: this.bullet.log,
        };

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

        // Update persisted state
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];

        if (this.options.enableStorageLog) {
          console.log("Bullet: Data saved to secondary storage");
        }
      }
    } catch (err) {
      console.error("Error saving to secondary storage:", err);
    }
  }

  async _saveData() {
    // We save to both tiers
    await this._saveToPrimary();
    await this._saveToSecondary();
    return Promise.resolve();
  }

  async close() {
    // Clear intervals
    if (this.primaryTimer) {
      clearInterval(this.primaryTimer);
      this.primaryTimer = null;
    }

    if (this.secondaryTimer) {
      clearInterval(this.secondaryTimer);
      this.secondaryTimer = null;
    }

    // Save to both tiers
    await this._saveData();

    // Close Redis connection
    if (this.redis) {
      this.redis.disconnect();
    }

    if (this.options.enableStorageLog) {
      console.log("Bullet: Multi-tier storage closed");
    }
  }
}
```

## Storage Performance Tips

### Optimize Save Frequency

Balance data safety with performance:

```javascript
// High-write scenario with less critical data
const bullet = new Bullet({
  storage: true,
  saveInterval: 30000, // Save every 30 seconds
});

// Critical data that can't be lost
const criticalBullet = new Bullet({
  storage: true,
  saveInterval: 1000, // Save every second
});

// Manual save for important operations
function processPayment(userId, amount) {
  // Update balance
  const user = bullet.get(`users/${userId}`).value();
  bullet.get(`users/${userId}/balance`).put(user.balance - amount);

  // Record transaction
  bullet.get(`transactions/${Date.now()}`).put({
    userId,
    amount,
    type: "payment",
    timestamp: new Date().toISOString(),
  });

  // Force an immediate save for critical financial data
  bullet.storage.save();

  return true;
}
```

### Limit Data Size

Be mindful of what you store:

```javascript
// Store only necessary data
bullet.middleware.beforePut((path, data) => {
  // Don't store temporary calculation results
  if (path.startsWith("temp/")) {
    return data;
  }

  // Exclude large blobs from storage
  if (typeof data === "object" && data !== null) {
    // Remove base64 images
    if (data.avatar && data.avatar.startsWith("data:image")) {
      data.avatar = data.avatar.substring(0, 100) + "... [truncated]";
    }

    // Remove logs from stored objects
    if (data.logs && Array.isArray(data.logs) && data.logs.length > 10) {
      data.logs = data.logs.slice(-10); // Keep only last 10 logs
    }
  }

  return data;
});
```

### Use Compression for Large Data

Reduce storage size:

```javascript
// Implement compression in a custom storage adapter
const zlib = require('zlib');

function compressData(data) {
  return zlib.gzipSync(data).toString('base64');
}

function decompressData(compressed) {
  return zlib.gunzipSync(Buffer.from(compressed, 'base64')).toString();
}

// Use in storage adapter
async _saveData() {
  if (this._hasChanges()) {
    const json = JSON.stringify({
      store: this.bullet.store,
      meta: this.bullet.meta,
      log: this.bullet.log
    });

    // Compress before saving
    const compressed = compressData(json);

    // Save compressed data
    fs.writeFileSync(this.options.filePath, compressed);

    // Update persisted state
    // ...
  }
}

async _loadData() {
  if (fs.existsSync(this.options.filePath)) {
    const compressed = fs.readFileSync(this.options.filePath, 'utf8');

    // Decompress data
    const json = decompressData(compressed);
    const data = JSON.parse(json);

    // Apply to bullet instance
    // ...
  }
}
```

## Storage Events

Monitor storage operations with events:

```javascript
// Register for storage events
bullet.on("storage:load:start", () => {
  console.log("Starting to load data from storage");
});

bullet.on("storage:load:complete", (info) => {
  console.log(
    `Loaded ${Object.keys(info.store).length} items in ${info.duration}ms`
  );
});

bullet.on("storage:save:start", () => {
  console.log("Starting to save data to storage");
});

bullet.on("storage:save:complete", (info) => {
  console.log(`Saved ${info.changes} changes in ${info.duration}ms`);
});

bullet.on("storage:error", (error) => {
  console.error("Storage error:", error);
  // Notify admins, try recovery, etc.
});
```

## Conclusion

Storage adapters in Bullet.js offer flexible ways to persist your data. By understanding how storage works and implementing custom adapters, you can tailor Bullet.js to work with any backend technology or storage system, from simple file storage to complex distributed databases.

## Next Steps

Now that you've learned about storage adapters, you might want to explore:

- [Performance Optimization](/docs/performance) - Strategies to optimize Bullet.js
- [Security](/docs/security) - Secure your Bullet.js applications
- [Deployment](/docs/deployment) - Deploy Bullet.js in production environments
- [Scaling](/docs/scaling) - Scale your Bullet.js applications
