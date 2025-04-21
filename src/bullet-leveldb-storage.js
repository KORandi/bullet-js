/**
 * Bullet-LevelDB-Storage.js - LevelDB persistence layer for Bullet.js
 */

const crypto = require("crypto");
const { Level } = require("level");
const path = require("path");

class BulletLevelDBStorage {
  constructor(bullet, options = {}) {
    this.bullet = bullet;
    this.options = {
      path: "./.bullet-leveldb",
      saveInterval: 5000, // 5 seconds
      encrypt: false,
      encryptionKey: null,
      prefix: {
        store: "store:",
        meta: "meta:",
        log: "log:",
      },
      logLimit: 1000, // Maximum number of log entries to keep
      ...options,
    };

    // DB instance
    this.db = null;

    // Track persisted state to optimize saves
    this.persisted = {
      store: {},
      meta: {},
      log: [],
    };

    // Initialize persistence
    this._initPersistence();
  }

  /**
   * Initialize persistence mechanisms
   * @private
   */
  _initPersistence() {
    try {
      // Open levelDB using the correct constructor from the Level package
      this.db = new Level(this.options.path);

      // Load existing data
      this._loadData()
        .then(() => {
          console.log("BulletLevelDBStorage: Data loaded successfully");

          // Start periodic save
          this.saveInterval = setInterval(() => {
            this.save();
          }, this.options.saveInterval);

          // Setup save on exit
          process.on("exit", () => {
            this.save();
          });

          // Handle other exit signals
          ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
            process.on(signal, () => {
              this.save();
              setTimeout(() => {
                process.exit();
              }, 500);
            });
          });
        })
        .catch((err) => {
          console.error("Error loading data from LevelDB:", err);
        });
    } catch (err) {
      console.error("Failed to initialize LevelDB storage:", err);
    }
  }

  /**
   * Load persisted data from LevelDB
   * @return {Promise} - Promise that resolves when data is loaded
   * @private
   */
  async _loadData() {
    try {
      // Create promises for loading store, meta, and log data
      const loadStore = this._loadStoreData();
      const loadMeta = this._loadMetaData();
      const loadLog = this._loadLogData();

      // Wait for all data to load
      await Promise.all([loadStore, loadMeta, loadLog]);

      return true;
    } catch (err) {
      console.error("Error loading data from LevelDB:", err);
      throw err;
    }
  }

  /**
   * Load store data from LevelDB
   * @return {Promise} - Promise that resolves when store data is loaded
   * @private
   */
  async _loadStoreData() {
    const storeData = {};
    const storePrefix = this.options.prefix.store;

    try {
      // Use iterator for level v8+
      const iterator = this.db.iterator({
        gte: storePrefix,
        lte: storePrefix + "\uffff",
      });

      for await (const [key, value] of iterator) {
        // Remove prefix from key
        const path = key.slice(storePrefix.length);

        // Parse the value - level auto-stringifies now
        let parsedValue;
        try {
          parsedValue = typeof value === "string" ? JSON.parse(value) : value;
        } catch (e) {
          parsedValue = value;
        }

        // Handle path with slash notation
        if (path.includes("/")) {
          const parts = path.split("/").filter(Boolean);
          let current = storeData;

          // Navigate through the parts to build the nested structure
          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current[part]) {
              current[part] = {};
            }
            current = current[part];
          }

          // Set the value at the leaf
          const lastPart = parts[parts.length - 1];

          // If encrypted, decrypt the data
          if (this.options.encrypt && typeof parsedValue === "string") {
            current[lastPart] = this._decrypt(parsedValue);
          } else {
            current[lastPart] = parsedValue;
          }
        } else {
          // Top level path without slashes
          if (this.options.encrypt && typeof parsedValue === "string") {
            storeData[path] = this._decrypt(parsedValue);
          } else {
            storeData[path] = parsedValue;
          }
        }
      }

      // Merge with existing store
      this._deepMerge(this.bullet.store, storeData);

      // Update persisted state
      this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));

      return true;
    } catch (err) {
      console.error("Error loading store data:", err);
      throw err;
    }
  }

  /**
   * Load metadata from LevelDB
   * @return {Promise} - Promise that resolves when metadata is loaded
   * @private
   */
  async _loadMetaData() {
    const metaData = {};
    const metaPrefix = this.options.prefix.meta;

    try {
      // Use iterator for level v8+
      const iterator = this.db.iterator({
        gte: metaPrefix,
        lte: metaPrefix + "\uffff",
      });

      for await (const [key, value] of iterator) {
        // Remove prefix from key
        const path = key.slice(metaPrefix.length);

        // Parse the value
        let parsedValue;
        try {
          parsedValue = typeof value === "string" ? JSON.parse(value) : value;
        } catch (e) {
          parsedValue = value;
        }

        // If encrypted, decrypt the data
        if (this.options.encrypt && typeof parsedValue === "string") {
          metaData[path] = this._decrypt(parsedValue);
        } else {
          metaData[path] = parsedValue;
        }
      }

      // Merge with existing metadata
      Object.assign(this.bullet.meta, metaData);

      // Update persisted state
      this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));

      return true;
    } catch (err) {
      console.error("Error loading meta data:", err);
      throw err;
    }
  }

  /**
   * Load transaction log from LevelDB
   * @return {Promise} - Promise that resolves when log data is loaded
   * @private
   */
  async _loadLogData() {
    const logEntries = [];
    const logPrefix = this.options.prefix.log;

    try {
      // Use iterator for level v8+
      const iterator = this.db.iterator({
        gte: logPrefix,
        lte: logPrefix + "\uffff",
      });

      for await (const [key, value] of iterator) {
        // Parse the value
        let parsedValue;
        try {
          parsedValue = typeof value === "string" ? JSON.parse(value) : value;
        } catch (e) {
          parsedValue = value;
        }

        // If encrypted, decrypt the data
        if (this.options.encrypt && typeof parsedValue === "string") {
          logEntries.push(this._decrypt(parsedValue));
        } else {
          logEntries.push(parsedValue);
        }
      }

      // Sort log entries by timestamp
      logEntries.sort((a, b) => a.timestamp - b.timestamp);

      // Merge with existing log
      this.bullet.log = [...this.bullet.log, ...logEntries];

      // Trim log if too large
      if (this.bullet.log.length > this.options.logLimit) {
        this.bullet.log = this.bullet.log.slice(-this.options.logLimit);
      }

      // Update persisted state
      this.persisted.log = [...this.bullet.log];

      return true;
    } catch (err) {
      console.error("Error loading log data:", err);
      throw err;
    }
  }

  /**
   * Save data to LevelDB
   * @return {Promise} - Promise that resolves when data is saved
   * @public
   */
  async save() {
    try {
      // Check if anything has changed
      if (this._hasChanges()) {
        // Create batch operations array
        const operations = [];

        // Add store data operations
        await this._saveStoreData(operations);

        // Add metadata operations
        await this._saveMetaData(operations);

        // Add transaction log operations
        await this._saveLogData(operations);

        // Execute batch operations
        if (operations.length > 0) {
          await this.db.batch(operations);

          // Update persisted state
          this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
          this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
          this.persisted.log = [...this.bullet.log];

          console.log("BulletLevelDBStorage: Data persisted to storage");
        }

        return true;
      }

      return false;
    } catch (err) {
      console.error("Error saving data to LevelDB:", err);
      return false;
    }
  }

  /**
   * Save store data to LevelDB
   * @param {Array} operations - Array of batch operations
   * @return {Promise} - Promise that resolves when store data is added to batch
   * @private
   */
  async _saveStoreData(operations) {
    // Flatten the store object into key-value pairs
    const flattenedStore = this._flattenObject(this.bullet.store);
    const storePrefix = this.options.prefix.store;

    // Add each flattened path to the operations
    for (const [path, value] of Object.entries(flattenedStore)) {
      const key = storePrefix + path;
      let storeValue = value;

      // Encode value for storage
      if (this.options.encrypt) {
        storeValue = this._encrypt(JSON.stringify(value));
      } else {
        storeValue = typeof value === "object" ? JSON.stringify(value) : value;
      }

      operations.push({ type: "put", key, value: storeValue });
    }

    return true;
  }

  /**
   * Save metadata to LevelDB
   * @param {Array} operations - Array of batch operations
   * @return {Promise} - Promise that resolves when metadata is added to batch
   * @private
   */
  async _saveMetaData(operations) {
    const metaPrefix = this.options.prefix.meta;

    // Add each metadata entry to the operations
    for (const [path, value] of Object.entries(this.bullet.meta)) {
      const key = metaPrefix + path;
      let metaValue = value;

      // Encode value for storage
      if (this.options.encrypt) {
        metaValue = this._encrypt(JSON.stringify(value));
      } else {
        metaValue = typeof value === "object" ? JSON.stringify(value) : value;
      }

      operations.push({ type: "put", key, value: metaValue });
    }

    return true;
  }

  /**
   * Save transaction log to LevelDB
   * @param {Array} operations - Array of batch operations
   * @return {Promise} - Promise that resolves when log data is added to batch
   * @private
   */
  async _saveLogData(operations) {
    const logPrefix = this.options.prefix.log;

    // First, clear existing log entries
    await this._clearLogEntries(operations);

    // Add each log entry to the operations with a timestamp-based key
    for (let i = 0; i < this.bullet.log.length; i++) {
      const entry = this.bullet.log[i];
      const key = `${logPrefix}${entry.timestamp}_${i}`;
      let logValue;

      // Encode value for storage
      if (this.options.encrypt) {
        logValue = this._encrypt(JSON.stringify(entry));
      } else {
        logValue = JSON.stringify(entry);
      }

      operations.push({ type: "put", key, value: logValue });
    }

    return true;
  }

  /**
   * Clear existing log entries before saving new ones
   * @param {Array} operations - Array of batch operations
   * @return {Promise} - Promise that resolves when log entries are cleared
   * @private
   */
  async _clearLogEntries(operations) {
    try {
      const logPrefix = this.options.prefix.log;
      const keysToDelete = [];

      // Use iterator to find keys
      const iterator = this.db.iterator({
        gte: logPrefix,
        lte: logPrefix + "\uffff",
        keys: true,
        values: false,
      });

      for await (const key of iterator) {
        keysToDelete.push(key);
      }

      // Add delete operations
      for (const key of keysToDelete) {
        operations.push({ type: "del", key });
      }

      return true;
    } catch (err) {
      console.error("Error clearing log entries:", err);
      return false;
    }
  }

  /**
   * Flatten a nested object into path-value pairs
   * @param {Object} obj - Object to flatten
   * @param {string} prefix - Path prefix
   * @return {Object} - Flattened object
   * @private
   */
  _flattenObject(obj, prefix = "") {
    const result = {};

    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}/${key}` : key;

      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        // Recursively flatten nested objects
        Object.assign(result, this._flattenObject(value, path));
      } else {
        // Add leaf value
        result[path] = value;
      }
    }

    return result;
  }

  /**
   * Check if there are changes to persist
   * @return {boolean} - Whether there are changes
   * @private
   */
  _hasChanges() {
    // Compare log lengths as a quick check
    if (this.bullet.log.length !== this.persisted.log.length) {
      return true;
    }

    // Check for different timestamps in meta
    for (const path in this.bullet.meta) {
      if (
        !this.persisted.meta[path] ||
        this.bullet.meta[path].timestamp !== this.persisted.meta[path].timestamp
      ) {
        return true;
      }
    }

    // Deep comparison is expensive, so we rely on metadata changes
    // as a proxy for data changes
    return false;
  }

  /**
   * Deep merge objects
   * @param {Object} target - Target object
   * @param {Object} source - Source object
   * @private
   */
  _deepMerge(target, source) {
    for (const key in source) {
      if (
        source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
      ) {
        // Create the property if it doesn't exist
        if (!target[key]) {
          target[key] = {};
        }

        this._deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }

    return target;
  }

  /**
   * Encrypt data if encryption is enabled
   * @param {string} data - Data to encrypt
   * @return {string} - Encrypted data or original data
   * @private
   */
  _encrypt(data) {
    if (!this.options.encrypt) {
      return data;
    }

    try {
      const key = this._getEncryptionKey();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

      let encrypted = cipher.update(data, "utf8", "hex");
      encrypted += cipher.final("hex");

      // Prepend IV for later decryption
      return iv.toString("hex") + encrypted;
    } catch (err) {
      console.error("Encryption failed:", err);
      return data;
    }
  }

  /**
   * Decrypt data if encryption is enabled
   * @param {string} data - Data to decrypt
   * @return {Object} - Decrypted data or original data
   * @private
   */
  _decrypt(data) {
    if (!this.options.encrypt) {
      return typeof data === "string" ? JSON.parse(data) : data;
    }

    try {
      const key = this._getEncryptionKey();

      // Extract IV from the beginning of the data
      const dataStr = data.toString();
      const iv = Buffer.from(dataStr.slice(0, 32), "hex");
      const encryptedText = dataStr.slice(32);

      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

      let decrypted = decipher.update(encryptedText, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return JSON.parse(decrypted);
    } catch (err) {
      console.error("Decryption failed:", err);
      return typeof data === "string" ? JSON.parse(data) : data;
    }
  }

  /**
   * Get the encryption key or derive one from the provided key
   * @return {Buffer} - 32-byte encryption key
   * @private
   */
  _getEncryptionKey() {
    if (!this.options.encryptionKey) {
      throw new Error("Encryption key is required when encryption is enabled");
    }

    // If it's already a Buffer of the right length, use it directly
    if (
      Buffer.isBuffer(this.options.encryptionKey) &&
      this.options.encryptionKey.length === 32
    ) {
      return this.options.encryptionKey;
    }

    // Otherwise, derive a key using SHA-256
    return crypto
      .createHash("sha256")
      .update(String(this.options.encryptionKey))
      .digest();
  }

  /**
   * Close storage and clean up
   * @public
   */
  async close() {
    try {
      if (this.saveInterval) {
        clearInterval(this.saveInterval);
      }

      // Final save
      await this.save();

      // Close LevelDB
      if (this.db) {
        await this.db.close();
      }

      console.log("BulletLevelDBStorage closed");
    } catch (err) {
      console.error("Error closing LevelDB storage:", err);
    }
  }
}

module.exports = BulletLevelDBStorage;
