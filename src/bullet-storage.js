const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const BulletStorageLog = require("./bullet-storage-log");

class BulletStorage {
  constructor(bullet, options = {}) {
    this.bullet = bullet;
    this.options = {
      path: "./.bullet",
      saveInterval: 5000,
      encrypt: false,
      encryptionKey: null,
      enableStorageLog: false,
      ...options,
    };

    if (!fs.existsSync(this.options.path)) {
      fs.mkdirSync(this.options.path, { recursive: true });
    }

    this.persisted = {
      store: {},
      meta: {},
      log: [],
    };

    if (this.options.enableStorageLog) {
      this.historyLog = new BulletStorageLog(bullet, {
        path: path.join(this.options.path, "logs"),
        encrypt: this.options.encrypt,
        encryptionKey: this.options.encryptionKey,
      });
    }

    this._initPersistence();
  }

  /**
   * Initialize persistence mechanisms
   * @private
   */
  _initPersistence() {
    this._loadData();

    const originalSetData = this.bullet._setData.bind(this.bullet);

    this.bullet._setData = (
      path,
      data,
      timestamp = Date.now(),
      broadcast = true
    ) => {
      originalSetData(path, data, timestamp, broadcast);

      if (this.options.enableStorageLog) {
        this.historyLog.append(path, data, timestamp).catch((err) => {
          console.error("Error appending to history log:", err);
        });
      }
    };

    this.saveInterval = setInterval(() => {
      this._saveData();
    }, this.options.saveInterval);

    process.on("exit", () => {
      this._saveData();
      if (this.options.enableStorageLog) {
        this.historyLog.close();
      }
    });

    ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
      process.on(signal, () => {
        this._saveData();
        if (this.options.enableStorageLog) {
          this.historyLog
            .close()
            .then(() => {
              process.exit();
            })
            .catch((err) => {
              console.error("Error closing history log:", err);
              process.exit(1);
            });
        }
      });
    });
  }

  /**
   * Load persisted data from disk
   * @private
   */
  _loadData() {
    try {
      const storePath = path.join(this.options.path, "store.json");
      if (fs.existsSync(storePath)) {
        const storeData = fs.readFileSync(storePath);
        const storeJson = this._decrypt(storeData);

        this._deepMerge(this.bullet.store, JSON.parse(storeJson));
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
      }

      const metaPath = path.join(this.options.path, "meta.json");
      if (fs.existsSync(metaPath)) {
        const metaData = fs.readFileSync(metaPath);
        const metaJson = this._decrypt(metaData);

        Object.assign(this.bullet.meta, JSON.parse(metaJson));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
      }

      const logPath = path.join(this.options.path, "log.json");
      if (fs.existsSync(logPath)) {
        const logData = fs.readFileSync(logPath);
        const logJson = this._decrypt(logData);

        this.bullet.log = [...this.bullet.log, ...JSON.parse(logJson)];

        if (this.bullet.log.length > 1000) {
          this.bullet.log = this.bullet.log.slice(-1000);
        }

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
      if (this._hasChanges()) {
        const storeJson = JSON.stringify(this.bullet.store);
        const storeData = this._encrypt(storeJson);
        fs.writeFileSync(path.join(this.options.path, "store.json"), storeData);

        const metaJson = JSON.stringify(this.bullet.meta);
        const metaData = this._encrypt(metaJson);
        fs.writeFileSync(path.join(this.options.path, "meta.json"), metaData);

        const logJson = JSON.stringify(this.bullet.log);
        const logData = this._encrypt(logJson);
        fs.writeFileSync(path.join(this.options.path, "log.json"), logData);

        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];

        if (this.options.enableStorageLog) {
          this.historyLog.flush().catch((err) => {
            console.error("Error flushing history log:", err);
          });
        }

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
    if (this.bullet.log.length !== this.persisted.log.length) {
      return true;
    }

    for (const path in this.bullet.meta) {
      if (
        !this.persisted.meta[path] ||
        this.bullet.meta[path].timestamp !== this.persisted.meta[path].timestamp
      ) {
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
   * Get an iterator for the history log
   * @param {Object} options - Iterator options
   * @return {Object} - History log iterator
   * @public
   */
  getHistoryIterator(options = {}) {
    if (this.options.enableStorageLog) {
      return this.historyLog.iterator(options);
    }
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
    if (!this.options.enableStorageLog) {
      return;
    }

    const rebuildOptions = {
      clear: false,
      pathPrefix: "",
      startTime: 0,
      endTime: Date.now(),
      ...options,
    };

    if (rebuildOptions.clear) {
      this.bullet.store = {};
      this.bullet.meta = {};
      this.bullet.log = [];
    }

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

    let entryCount = 0;

    await iterator.forEach((entry) => {
      if (entry.op === "set" && entry.path && entry.data !== undefined) {
        const currentMeta = this.bullet.meta[entry.path] || { timestamp: 0 };

        if (entry.timestamp > currentMeta.timestamp) {
          const parts = entry.path.split("/").filter(Boolean);
          let current = this.bullet.store;

          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current[part]) {
              current[part] = {};
            }
            current = current[part];
          }

          const lastPart = parts[parts.length - 1];
          if (lastPart) {
            current[lastPart] = entry.data;
          }

          this.bullet.meta[entry.path] = {
            timestamp: entry.timestamp,
            source: entry.source || "historyLog",
          };

          this.bullet.log.push({
            op: "set",
            path: entry.path,
            data: entry.data,
            timestamp: entry.timestamp,
          });

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

    const combinedFilter = (entry) => {
      if (pathPattern && !new RegExp(pathPattern).test(entry.path)) {
        return false;
      }

      if (filter && !filter(entry)) {
        return false;
      }

      return true;
    };

    const iterator = this.historyLog.iterator({
      filter: combinedFilter,
      reverse: reverse,
    });

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
    if (this.options.enableStorageLog) {
      return this.historyLog.flush();
    }
  }

  /**
   * Close storage and clean up
   * @public
   */
  async close() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }

    this._saveData();

    if (this.options.enableStorageLog) {
      await this.historyLog.close();
    }
  }
}

module.exports = BulletStorage;
