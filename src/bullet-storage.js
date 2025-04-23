/**
 * Example integration of BulletStorageLog with bullet-storage.js
 */

// Modified version of bullet-storage.js that uses the persistent log

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const BulletStorageLog = require("./bullet-storage-log");

class BulletStorage {
  constructor(bullet, options = {}) {
    this.bullet = bullet;
    this.options = {
      path: "./.bullet",
      saveInterval: 5000, // 5 seconds
      encrypt: false,
      encryptionKey: null,
      ...options,
    };

    // Create storage directory if it doesn't exist
    if (!fs.existsSync(this.options.path)) {
      fs.mkdirSync(this.options.path, { recursive: true });
    }

    // Track persisted state to optimize saves
    this.persisted = {
      store: {},
      meta: {},
      log: [],
    };

    // Initialize the persistent log - keep separate from the in-memory log
    this.historyLog = new BulletStorageLog(bullet, {
      path: path.join(this.options.path, "logs"),
      encrypt: this.options.encrypt,
      encryptionKey: this.options.encryptionKey,
    });

    // Initialize persistence
    this._initPersistence();
  }

  /**
   * Initialize persistence mechanisms
   * @private
   */
  _initPersistence() {
    // Load existing data if available
    this._loadData();

    // Hook into bullet's _setData to also log to historyLog without changing the original behavior
    const originalSetData = this.bullet._setData.bind(this.bullet);

    this.bullet._setData = (
      path,
      data,
      timestamp = Date.now(),
      broadcast = true
    ) => {
      // Call original method which handles the in-memory log
      originalSetData(path, data, timestamp, broadcast);

      // Also log the operation to persistent historyLog (don't await to avoid blocking)
      this.historyLog.append(path, data, timestamp).catch((err) => {
        console.error("Error appending to history log:", err);
      });
    };

    // Start periodic save
    this.saveInterval = setInterval(() => {
      this._saveData();
    }, this.options.saveInterval);

    // Setup save on exit
    process.on("exit", () => {
      this._saveData();
      this.historyLog.close(); // Close the historyLog
    });

    // Handle other exit signals
    ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
      process.on(signal, () => {
        this._saveData();
        this.historyLog
          .close() // Close the historyLog
          .then(() => {
            process.exit();
          })
          .catch((err) => {
            console.error("Error closing history log:", err);
            process.exit(1);
          });
      });
    });
  }

  /**
   * Load persisted data from disk
   * @private
   */
  _loadData() {
    try {
      // Load main store
      const storePath = path.join(this.options.path, "store.json");
      if (fs.existsSync(storePath)) {
        const storeData = fs.readFileSync(storePath);
        const storeJson = this._decrypt(storeData);

        // Merge with existing store
        this._deepMerge(this.bullet.store, JSON.parse(storeJson));

        // Update persisted state
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
      }

      // Load metadata
      const metaPath = path.join(this.options.path, "meta.json");
      if (fs.existsSync(metaPath)) {
        const metaData = fs.readFileSync(metaPath);
        const metaJson = this._decrypt(metaData);

        // Merge with existing metadata
        Object.assign(this.bullet.meta, JSON.parse(metaJson));

        // Update persisted state
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
      }

      // Load transaction log
      const logPath = path.join(this.options.path, "log.json");
      if (fs.existsSync(logPath)) {
        const logData = fs.readFileSync(logPath);
        const logJson = this._decrypt(logData);

        // Merge with existing log
        this.bullet.log = [...this.bullet.log, ...JSON.parse(logJson)];

        // Trim log if too large - THIS STILL HAPPENS FOR IN-MEMORY LOG
        // But the historyLog will retain all entries
        if (this.bullet.log.length > 1000) {
          this.bullet.log = this.bullet.log.slice(-1000);
        }

        // Update persisted state
        this.persisted.log = [...this.bullet.log];
      }

      console.log("Bullet: Data loaded from persistent storage");
    } catch (err) {
      console.error("Error loading persisted data:", err);
    }
  }

  /**
   * Save data to disk
   * @private
   */
  _saveData() {
    try {
      // Check if anything has changed
      if (this._hasChanges()) {
        // Save main store
        const storeJson = JSON.stringify(this.bullet.store);
        const storeData = this._encrypt(storeJson);
        fs.writeFileSync(path.join(this.options.path, "store.json"), storeData);

        // Save metadata
        const metaJson = JSON.stringify(this.bullet.meta);
        const metaData = this._encrypt(metaJson);
        fs.writeFileSync(path.join(this.options.path, "meta.json"), metaData);

        // Save transaction log - still maintain the in-memory log compatibility
        const logJson = JSON.stringify(this.bullet.log);
        const logData = this._encrypt(logJson);
        fs.writeFileSync(path.join(this.options.path, "log.json"), logData);

        // Update persisted state
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];

        // Ensure historyLog is flushed
        this.historyLog.flush().catch((err) => {
          console.error("Error flushing history log:", err);
        });

        console.log("Bullet: Data persisted to storage");
      }
    } catch (err) {
      console.error("Error saving data:", err);
    }
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
   * @return {Buffer|string} - Encrypted data or original data
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
      return Buffer.from(iv.toString("hex") + encrypted);
    } catch (err) {
      console.error("Encryption failed:", err);
      return data;
    }
  }

  /**
   * Decrypt data if encryption is enabled
   * @param {Buffer|string} data - Data to decrypt
   * @return {string} - Decrypted data or original data
   * @private
   */
  _decrypt(data) {
    if (!this.options.encrypt) {
      return data.toString();
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

      return decrypted;
    } catch (err) {
      console.error("Decryption failed:", err);
      return data.toString();
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
   * Get an iterator for the history log
   * @param {Object} options - Iterator options
   * @return {Object} - History log iterator
   * @public
   */
  getHistoryIterator(options = {}) {
    return this.historyLog.iterator(options);
  }

  /**
   * Rebuild database state from the history log
   * @param {Object} options - Rebuild options
   * @param {boolean} options.clear - Whether to clear existing state first
   * @param {string} options.pathPrefix - Only rebuild data under this path
   * @param {number} options.startTime - Only include entries after this time
   * @param {number} options.endTime - Only include entries before this time
   * @return {Promise<number>} - Number of entries processed
   * @public
   */
  async rebuildFromHistory(options = {}) {
    console.log("Rebuilding state from history log...");

    const rebuildOptions = {
      clear: false,
      pathPrefix: "",
      startTime: 0,
      endTime: Date.now(),
      ...options,
    };

    // Clear existing state if requested
    if (rebuildOptions.clear) {
      this.bullet.store = {};
      this.bullet.meta = {};
      this.bullet.log = [];
    }

    // Create an iterator for the history log
    const iterator = this.historyLog.iterator({
      filter: (entry) => {
        if (
          entry.timestamp < rebuildOptions.startTime ||
          entry.timestamp > rebuildOptions.endTime
        ) {
          return false;
        }

        if (
          rebuildOptions.pathPrefix &&
          !entry.path.startsWith(rebuildOptions.pathPrefix)
        ) {
          return false;
        }

        return true;
      },
    });

    // Process all entries
    let entryCount = 0;

    await iterator.forEach((entry) => {
      if (entry.op === "set" && entry.path && entry.data !== undefined) {
        const currentMeta = this.bullet.meta[entry.path] || { timestamp: 0 };

        if (entry.timestamp > currentMeta.timestamp) {
          // Apply the data change directly without triggering hooks
          const parts = entry.path.split("/").filter(Boolean);
          let current = this.bullet.store;

          // Navigate to the parent node
          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current[part]) {
              current[part] = {};
            }
            current = current[part];
          }

          // Set the value
          const lastPart = parts[parts.length - 1];
          if (lastPart) {
            current[lastPart] = entry.data;
          }

          // Update metadata
          this.bullet.meta[entry.path] = {
            timestamp: entry.timestamp,
            source: entry.source || "historyLog",
          };

          // Add to in-memory log
          this.bullet.log.push({
            op: "set",
            path: entry.path,
            data: entry.data,
            timestamp: entry.timestamp,
          });

          // Trim in-memory log if too large
          if (this.bullet.log.length > 1000) {
            this.bullet.log = this.bullet.log.slice(-1000);
          }

          entryCount++;
        }
      }
    });

    console.log(`Rebuild completed. Processed ${entryCount} entries.`);
    return entryCount;
  }

  /**
   * Query the history log for specific entries
   * @param {Object} options - Query options
   * @param {string} options.pathPattern - Regular expression for paths
   * @param {function} options.filter - Custom filter function
   * @param {number} options.limit - Maximum number of entries to return
   * @param {boolean} options.reverse - Whether to return entries in reverse order
   * @return {Promise<Array>} - Matching entries
   * @public
   */
  async queryHistory(options = {}) {
    const { pathPattern, filter, limit = 100, reverse = true } = options;

    // Create a combined filter function
    const combinedFilter = (entry) => {
      // Apply path pattern if specified
      if (pathPattern && !new RegExp(pathPattern).test(entry.path)) {
        return false;
      }

      // Apply custom filter if specified
      if (filter && !filter(entry)) {
        return false;
      }

      return true;
    };

    // Create an iterator
    const iterator = this.historyLog.iterator({
      filter: combinedFilter,
      reverse: reverse,
    });

    // Find matching entries
    const entries = await iterator.find(() => true, limit);
    return entries;
  }

  /**
   * Manual trigger to save state
   * @return {Promise} - Promise that resolves when save is complete
   * @public
   */
  async save() {
    this._saveData();
    return this.historyLog.flush();
  }

  /**
   * Close storage and clean up
   * @public
   */
  async close() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }

    // Final save
    this._saveData();

    // Close history log
    await this.historyLog.close();

    console.log("BulletStorage closed");
  }
}

module.exports = BulletStorage;
