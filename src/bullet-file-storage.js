const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const BulletStorage = require("./bullet-storage");

/**
 * BulletFileStorage - File-based storage implementation
 * Stores data in JSON files on the filesystem
 */
class BulletFileStorage extends BulletStorage {
  /**
   * Create a new file storage instance
   * @param {Object} bullet - The Bullet instance
   * @param {Object} options - Storage options
   */
  constructor(bullet, options = {}) {
    super(bullet, {
      path: "./.bullet",
      saveInterval: 5000,
      encrypt: false,
      encryptionKey: null,
      enableStorageLog: false,
      ...options,
    });

    // Create storage directory if it doesn't exist
    if (!fs.existsSync(this.options.path)) {
      fs.mkdirSync(this.options.path, { recursive: true });
    }
  }

  /**
   * Initialize the file storage
   * @protected
   * @override
   */
  _initStorage() {
    // Load data from disk
    this._loadData();

    // Set up save interval - specific to file storage
    if (this.options.saveInterval > 0) {
      this.saveInterval = setInterval(() => {
        this._saveData();
      }, this.options.saveInterval);
    }

    // Handle graceful shutdown
    process.on("exit", () => {
      this._saveData();
    });

    ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
      process.on(signal, () => {
        this._saveData();
        if (this.saveInterval) {
          clearInterval(this.saveInterval);
        }
      });
    });
  }

  /**
   * Load persisted data from disk
   * @protected
   * @override
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

      if (this.options.enableStorageLog) {
        console.log("Bullet: Data loaded from file storage");
      }
    } catch (err) {
      console.error("Error loading persisted data:", err);
    }
  }

  /**
   * Save data to disk
   * @protected
   * @override
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
          console.log("Bullet: Data persisted to file storage");
        }
      }
    } catch (err) {
      console.error("Error saving data:", err);
    }

    return Promise.resolve();
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

    if (this.options.enableStorageLog) {
      console.log("Bullet: File storage closed");
    }
  }
}

module.exports = BulletFileStorage;
