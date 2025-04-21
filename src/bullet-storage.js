/**
 * Bullet-Storage.js - Persistence layer for Bullet.js
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

    // Start periodic save
    this.saveInterval = setInterval(() => {
      this._saveData();
    }, this.options.saveInterval);

    // Setup save on exit
    process.on("exit", () => {
      this._saveData();
    });

    // Handle other exit signals
    ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
      process.on(signal, () => {
        this._saveData();
        process.exit();
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

        // Trim log if too large
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

        // Save transaction log
        const logJson = JSON.stringify(this.bullet.log);
        const logData = this._encrypt(logJson);
        fs.writeFileSync(path.join(this.options.path, "log.json"), logData);

        // Update persisted state
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];

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
   * Manually trigger a save
   * @public
   */
  save() {
    this._saveData();
  }

  /**
   * Close storage and clean up
   * @public
   */
  close() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }

    // Final save
    this._saveData();

    console.log("BulletStorage closed");
  }
}

module.exports = BulletStorage;
