const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

    this._initPersistence();
  }

  /**
   * Initialize persistence mechanisms
   * @private
   */
  _initPersistence() {
    this._loadData();

    const originalSetData = this.bullet.setData.bind(this.bullet);

    this.bullet.setData = (path, data, broadcast = true) => {
      originalSetData(path, data, broadcast);
    };

    this.saveInterval = setInterval(() => {
      this._saveData();
    }, this.options.saveInterval);

    process.on("exit", () => {
      this._saveData();
    });

    ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
      process.on(signal, () => {
        this._saveData();
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
   * Manual trigger to save state
   * @return {Promise} - Promise that resolves when save is complete
   * @public
   */
  async save() {
    this._saveData();
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
  }
}

module.exports = BulletStorage;
