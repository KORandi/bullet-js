const crypto = require("crypto");
const { Level } = require("level");
const path = require("path");

class BulletLevelDBStorage {
  constructor(bullet, options = {}) {
    this.bullet = bullet;
    this.options = {
      path: "./.bullet-leveldb",
      saveInterval: 5000,
      encrypt: false,
      encryptionKey: null,
      prefix: {
        store: "store:",
        meta: "meta:",
        log: "log:",
      },
      logLimit: 1000,
      ...options,
    };

    this.db = null;

    this.persisted = {
      store: {},
      meta: {},
      log: [],
    };

    this._initPersistence();
  }

  /**
   * Initialize persistence mechanisms
   * @private
   */
  _initPersistence() {
    try {
      this.db = new Level(this.options.path);

      this._loadData()
        .then(() => {
          console.log("BulletLevelDBStorage: Data loaded successfully");

          this.saveInterval = setInterval(() => {
            this.save();
          }, this.options.saveInterval);

          process.on("exit", () => {
            this.save();
          });

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
      const loadStore = this._loadStoreData();
      const loadMeta = this._loadMetaData();
      const loadLog = this._loadLogData();

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
      const iterator = this.db.iterator({
        gte: storePrefix,
        lte: storePrefix + "\uffff",
      });

      for await (const [key, value] of iterator) {
        const path = key.slice(storePrefix.length);

        let parsedValue;
        try {
          parsedValue = typeof value === "string" ? JSON.parse(value) : value;
        } catch (e) {
          parsedValue = value;
        }

        if (path.includes("/")) {
          const parts = path.split("/").filter(Boolean);
          let current = storeData;

          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current[part]) {
              current[part] = {};
            }
            current = current[part];
          }

          const lastPart = parts[parts.length - 1];

          if (this.options.encrypt && typeof parsedValue === "string") {
            current[lastPart] = this._decrypt(parsedValue);
          } else {
            current[lastPart] = parsedValue;
          }
        } else {
          if (this.options.encrypt && typeof parsedValue === "string") {
            storeData[path] = this._decrypt(parsedValue);
          } else {
            storeData[path] = parsedValue;
          }
        }
      }

      this._deepMerge(this.bullet.store, storeData);

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
      const iterator = this.db.iterator({
        gte: metaPrefix,
        lte: metaPrefix + "\uffff",
      });

      for await (const [key, value] of iterator) {
        const path = key.slice(metaPrefix.length);

        let parsedValue;
        try {
          parsedValue = typeof value === "string" ? JSON.parse(value) : value;
        } catch (e) {
          parsedValue = value;
        }

        if (this.options.encrypt && typeof parsedValue === "string") {
          metaData[path] = this._decrypt(parsedValue);
        } else {
          metaData[path] = parsedValue;
        }
      }

      Object.assign(this.bullet.meta, metaData);

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
      const iterator = this.db.iterator({
        gte: logPrefix,
        lte: logPrefix + "\uffff",
      });

      for await (const [key, value] of iterator) {
        let parsedValue;
        try {
          parsedValue = typeof value === "string" ? JSON.parse(value) : value;
        } catch (e) {
          parsedValue = value;
        }

        if (this.options.encrypt && typeof parsedValue === "string") {
          logEntries.push(this._decrypt(parsedValue));
        } else {
          logEntries.push(parsedValue);
        }
      }

      this.bullet.log = [...this.bullet.log, ...logEntries];

      if (this.bullet.log.length > this.options.logLimit) {
        this.bullet.log = this.bullet.log.slice(-this.options.logLimit);
      }

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
      if (this._hasChanges()) {
        const operations = [];

        await this._saveStoreData(operations);

        await this._saveMetaData(operations);

        await this._saveLogData(operations);

        if (operations.length > 0) {
          await this.db.batch(operations);

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
    const flattenedStore = this._flattenObject(this.bullet.store);
    const storePrefix = this.options.prefix.store;

    for (const [path, value] of Object.entries(flattenedStore)) {
      const key = storePrefix + path;
      let storeValue = value;

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

    for (const [path, value] of Object.entries(this.bullet.meta)) {
      const key = metaPrefix + path;
      let metaValue = value;

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

    await this._clearLogEntries(operations);

    for (let i = 0; i < this.bullet.log.length; i++) {
      const entry = this.bullet.log[i];
      const key = `${logPrefix}${entry.timestamp}_${i}`;
      let logValue;

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

      const iterator = this.db.iterator({
        gte: logPrefix,
        lte: logPrefix + "\uffff",
        keys: true,
        values: false,
      });

      for await (const key of iterator) {
        keysToDelete.push(key);
      }

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
        Object.assign(result, this._flattenObject(value, path));
      } else {
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
    if (this.bullet.log.length !== this.persisted.log.length) {
      return true;
    }

    for (const path in this.bullet.meta) {
      if (!this.persisted.meta[path]) {
        return true;
      }
    }

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

    if (
      Buffer.isBuffer(this.options.encryptionKey) &&
      this.options.encryptionKey.length === 32
    ) {
      return this.options.encryptionKey;
    }

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

      await this.save();

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
