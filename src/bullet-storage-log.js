/**
 * bullet-storage-log.js - Persistent storage log for Bullet.js
 * A component that provides append-only persistent logging for the Bullet database
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const EventEmitter = require("events");

class BulletStorageLog extends EventEmitter {
  constructor(bullet, options = {}) {
    super();
    this.bullet = bullet;

    this.options = {
      path: options.path || "./.bullet/logs",
      prefix: "transaction-log",
      maxFileSize: 50 * 1024 * 1024, // 50 MB max file size before rotation
      rotationCount: 5, // Keep 5 rotated files by default
      memoryCache: 1000, // How many recent entries to keep in memory
      encrypt: options.encrypt || false,
      encryptionKey: options.encryptionKey || null,
      syncInterval: 500, // ms between syncs to disk
      ...options,
    };

    // Ensure log directory exists
    if (!fs.existsSync(this.options.path)) {
      fs.mkdirSync(this.options.path, { recursive: true });
    }

    // Internal state
    this.currentLogFile = null;
    this.currentFileSize = 0;
    this.currentFileNumber = 0;
    this.writeStream = null;
    this.recentEntries = []; // In-memory cache of recent entries
    this.syncTimer = null;
    this.pendingWrites = [];

    // Initialize the log
    this._init();
  }

  /**
   * Initialize the storage log
   * @private
   */
  _init() {
    // Find the latest log file
    this._findLatestLogFile();

    // Open the log file for writing
    this._openLogFile();

    // Start sync timer
    this._startSyncTimer();

    // Load recent entries into memory
    this._loadRecentEntries();
  }

  /**
   * Find the latest log file
   * @private
   */
  _findLatestLogFile() {
    try {
      const files = fs.readdirSync(this.options.path);
      const logFiles = files.filter(
        (file) => file.startsWith(this.options.prefix) && file.endsWith(".log")
      );

      if (logFiles.length === 0) {
        this.currentFileNumber = 1;
      } else {
        // Extract file numbers and find the highest
        const fileNumbers = logFiles.map((file) => {
          const match = file.match(/^transaction-log-(\d+)\.log$/);
          return match ? parseInt(match[1], 10) : 0;
        });

        this.currentFileNumber = Math.max(...fileNumbers);

        // Check if the current file is too large
        const currentFilePath = this._getLogFilePath(this.currentFileNumber);
        const stats = fs.statSync(currentFilePath);
        this.currentFileSize = stats.size;

        if (this.currentFileSize >= this.options.maxFileSize) {
          // Rotate to a new file
          this.currentFileNumber++;
          this.currentFileSize = 0;
        }
      }
    } catch (err) {
      console.error("Error finding latest log file:", err);
      this.currentFileNumber = 1;
      this.currentFileSize = 0;
    }

    this.currentLogFile = this._getLogFilePath(this.currentFileNumber);
    console.log(`BulletStorageLog: Using log file ${this.currentLogFile}`);
  }

  /**
   * Get the path for a log file with the given number
   * @param {number} fileNumber - Log file number
   * @return {string} - Log file path
   * @private
   */
  _getLogFilePath(fileNumber) {
    return path.join(
      this.options.path,
      `${this.options.prefix}-${fileNumber}.log`
    );
  }

  /**
   * Open the current log file for writing
   * @private
   */
  _openLogFile() {
    try {
      // Close existing stream if any
      if (this.writeStream) {
        this.writeStream.end();
      }

      // Create new write stream in append mode
      this.writeStream = fs.createWriteStream(this.currentLogFile, {
        flags: "a",
        encoding: "utf8",
      });

      this.writeStream.on("error", (err) => {
        console.error("Error writing to log file:", err);
        this.emit("error", err);
      });
    } catch (err) {
      console.error("Failed to open log file for writing:", err);
      this.emit("error", err);
    }
  }

  /**
   * Start the sync timer for flushing pending writes
   * @private
   */
  _startSyncTimer() {
    this.syncTimer = setInterval(() => {
      this._flushPendingWrites();
    }, this.options.syncInterval);
  }

  /**
   * Load the most recent entries into memory
   * @private
   */
  _loadRecentEntries() {
    const entries = [];
    let entriesNeeded = this.options.memoryCache;
    let fileNumber = this.currentFileNumber;

    // First try to read from the current file
    while (entriesNeeded > 0 && fileNumber > 0) {
      const filePath = this._getLogFilePath(fileNumber);

      if (fs.existsSync(filePath)) {
        try {
          const fileContent = fs.readFileSync(filePath, "utf8");
          const lines = fileContent
            .split("\n")
            .filter((line) => line.trim() !== "");

          // Parse entries from newest to oldest
          for (let i = lines.length - 1; i >= 0 && entriesNeeded > 0; i--) {
            try {
              const decrypted = this._decrypt(lines[i]);
              const entry = JSON.parse(decrypted);
              entries.unshift(entry);
              entriesNeeded--;
            } catch (err) {
              console.error("Error parsing log entry:", err);
            }
          }
        } catch (err) {
          console.error(`Error reading log file ${filePath}:`, err);
        }
      }

      fileNumber--;
    }

    this.recentEntries = entries.slice(-this.options.memoryCache);
    console.log(
      `BulletStorageLog: Loaded ${this.recentEntries.length} recent entries into memory`
    );
  }

  /**
   * Append a transaction to the log
   * @param {string} path - Data path
   * @param {*} data - New data
   * @param {number} timestamp - Operation timestamp
   * @return {Promise} - Promise that resolves when the entry is appended
   * @public
   */
  append(path, data, timestamp = Date.now()) {
    return new Promise((resolve, reject) => {
      const entry = {
        op: "set",
        path,
        data,
        timestamp,
        id: this._generateId(),
      };

      // Add to pending writes
      this.pendingWrites.push({
        entry,
        resolve,
        reject,
      });

      // If there are too many pending writes, flush immediately
      if (this.pendingWrites.length >= 100) {
        this._flushPendingWrites();
      }

      // Add to recent entries in memory
      this.recentEntries.push(entry);
      if (this.recentEntries.length > this.options.memoryCache) {
        this.recentEntries.shift();
      }
    });
  }

  /**
   * Flush pending writes to disk
   * @private
   */
  _flushPendingWrites() {
    if (this.pendingWrites.length === 0) return;

    const writes = [...this.pendingWrites];
    this.pendingWrites = [];

    try {
      // Check if we need to rotate log file
      let totalSize = 0;
      for (const write of writes) {
        const serialized = JSON.stringify(write.entry);
        const encrypted = this._encrypt(serialized);
        totalSize += encrypted.length + 1; // +1 for newline
      }

      if (this.currentFileSize + totalSize >= this.options.maxFileSize) {
        this._rotateLogFile();
      }

      // Write all entries to the log file
      for (const write of writes) {
        const serialized = JSON.stringify(write.entry);
        const encrypted = this._encrypt(serialized);

        // Write to file
        this.writeStream.write(encrypted + "\n", "utf8", (err) => {
          if (err) {
            console.error("Error writing to log:", err);
            write.reject(err);
          } else {
            write.resolve(write.entry);
          }
        });

        // Update file size
        this.currentFileSize += encrypted.length + 1;

        // Emit append event
        this.emit("append", write.entry);
      }
    } catch (err) {
      console.error("Error flushing writes:", err);

      // Reject all pending writes
      for (const write of writes) {
        write.reject(err);
      }
    }
  }

  /**
   * Rotate to a new log file
   * @private
   */
  _rotateLogFile() {
    // Close current file
    if (this.writeStream) {
      this.writeStream.end();
    }

    // Increment file number
    this.currentFileNumber++;
    this.currentFileSize = 0;
    this.currentLogFile = this._getLogFilePath(this.currentFileNumber);

    // Open new file
    this._openLogFile();

    // Clean up old files if needed
    this._cleanupOldFiles();

    console.log(
      `BulletStorageLog: Rotated to new log file ${this.currentLogFile}`
    );
    this.emit("rotate", {
      file: this.currentLogFile,
      number: this.currentFileNumber,
    });
  }

  /**
   * Clean up old log files
   * @private
   */
  _cleanupOldFiles() {
    if (this.currentFileNumber <= this.options.rotationCount) {
      return;
    }

    const oldestFileToKeep =
      this.currentFileNumber - this.options.rotationCount;

    for (let i = 1; i < oldestFileToKeep; i++) {
      const filePath = this._getLogFilePath(i);

      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`BulletStorageLog: Removed old log file ${filePath}`);
        } catch (err) {
          console.error(`Error removing old log file ${filePath}:`, err);
        }
      }
    }
  }

  /**
   * Create an iterator for reading the log
   * @param {Object} options - Iterator options
   * @return {Object} - Iterator object
   * @public
   */
  iterator(options = {}) {
    return new BulletStorageLogIterator(this, options);
  }

  /**
   * Get recent entries from memory
   * @param {number} limit - Maximum number of entries to return
   * @return {Array} - Recent log entries
   * @public
   */
  getRecent(limit = this.options.memoryCache) {
    return this.recentEntries.slice(-limit);
  }

  /**
   * Force flush all pending writes to disk
   * @return {Promise} - Promise that resolves when all writes are flushed
   * @public
   */
  flush() {
    return new Promise((resolve, reject) => {
      this._flushPendingWrites();

      if (!this.writeStream) {
        resolve();
        return;
      }

      this.writeStream.once("drain", () => {
        resolve();
      });

      // If there's nothing to drain, resolve immediately
      if (this.writeStream.writableLength === 0) {
        resolve();
      }
    });
  }

  /**
   * Close the log
   * @return {Promise} - Promise that resolves when the log is closed
   * @public
   */
  close() {
    return new Promise(async (resolve, reject) => {
      try {
        // Clear sync timer
        if (this.syncTimer) {
          clearInterval(this.syncTimer);
          this.syncTimer = null;
        }

        // Flush any pending writes
        await this.flush();

        // Close write stream
        if (this.writeStream) {
          this.writeStream.end(() => {
            this.writeStream = null;
            console.log("BulletStorageLog: Log closed");
            resolve();
          });
        } else {
          resolve();
        }
      } catch (err) {
        console.error("Error closing log:", err);
        reject(err);
      }
    });
  }

  /**
   * Generate a unique ID for a log entry
   * @return {string} - Unique ID
   * @private
   */
  _generateId() {
    const now = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `${now}-${random}`;
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

      // Prepend IV to the encrypted data
      return iv.toString("hex") + encrypted;
    } catch (err) {
      console.error("Encryption failed:", err);
      return data;
    }
  }

  /**
   * Decrypt data if encryption is enabled
   * @param {string} data - Data to decrypt
   * @return {string} - Decrypted data or original data
   * @private
   */
  _decrypt(data) {
    if (!this.options.encrypt) {
      return data;
    }

    try {
      const key = this._getEncryptionKey();

      // IV is the first 16 bytes (32 hex characters)
      const iv = Buffer.from(data.slice(0, 32), "hex");
      const encrypted = data.slice(32);

      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (err) {
      console.error("Decryption failed:", err);
      return data;
    }
  }

  /**
   * Get the encryption key
   * @return {Buffer} - Encryption key
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
}

/**
 * Iterator for reading the storage log
 */
class BulletStorageLogIterator {
  constructor(log, options = {}) {
    this.log = log;
    this.options = {
      startFile: 1,
      endFile: log.currentFileNumber,
      batchSize: 100,
      filter: null,
      reverse: false,
      ...options,
    };

    // State
    this.currentFile = this.options.reverse
      ? this.options.endFile
      : this.options.startFile;
    this.fileLines = null;
    this.position = 0;
    this.exhausted = false;
  }

  /**
   * Check if there are more entries
   * @return {boolean} - Whether there are more entries
   * @public
   */
  hasNext() {
    return !this.exhausted;
  }

  /**
   * Get the next batch of entries
   * @return {Promise<Array>} - Next batch of entries
   * @public
   */
  async next() {
    if (this.exhausted) {
      return [];
    }

    // If we need to load a file
    if (!this.fileLines) {
      await this._loadFile();

      // If we couldn't load any lines, we're done
      if (!this.fileLines || this.fileLines.length === 0) {
        this.exhausted = true;
        return [];
      }
    }

    const batch = [];
    const reverse = this.options.reverse;

    // Read a batch
    while (batch.length < this.options.batchSize) {
      const index = reverse
        ? this.fileLines.length - 1 - this.position
        : this.position;

      // Check if we've reached the end of this file
      if (index < 0 || index >= this.fileLines.length) {
        // Move to the next file
        this.position = 0;
        this.fileLines = null;

        // Advance or go back to the next file
        if (reverse) {
          this.currentFile--;
          if (this.currentFile < this.options.startFile) {
            this.exhausted = true;
            break;
          }
        } else {
          this.currentFile++;
          if (this.currentFile > this.options.endFile) {
            this.exhausted = true;
            break;
          }
        }

        // Try to load the next file
        await this._loadFile();
        if (!this.fileLines || this.fileLines.length === 0) {
          this.exhausted = true;
          break;
        }
        continue;
      }

      // Get the next line
      const line = this.fileLines[index];
      this.position++;

      // Skip empty lines
      if (!line || line.trim() === "") continue;

      try {
        // Decrypt and parse the entry
        const decrypted = this.log._decrypt(line);
        const entry = JSON.parse(decrypted);

        // Apply filter if provided
        if (!this.options.filter || this.options.filter(entry)) {
          batch.push(entry);
        }
      } catch (err) {
        console.error("Error parsing log entry:", err);
      }
    }

    return batch;
  }

  /**
   * Load the current file
   * @return {Promise} - Promise that resolves when the file is loaded
   * @private
   */
  async _loadFile() {
    const filePath = this.log._getLogFilePath(this.currentFile);

    try {
      if (!fs.existsSync(filePath)) {
        this.fileLines = null;
        return;
      }

      const content = await fs.promises.readFile(filePath, "utf8");
      this.fileLines = content.split("\n");
    } catch (err) {
      console.error(`Error reading log file ${filePath}:`, err);
      this.fileLines = null;
    }
  }

  /**
   * Process all entries with a callback
   * @param {Function} callback - Callback function for each entry
   * @return {Promise} - Promise that resolves when all entries have been processed
   * @public
   */
  async forEach(callback) {
    while (this.hasNext()) {
      const batch = await this.next();
      for (const entry of batch) {
        await callback(entry);
      }
    }
  }

  /**
   * Reset the iterator
   * @public
   */
  reset() {
    this.currentFile = this.options.reverse
      ? this.options.endFile
      : this.options.startFile;
    this.fileLines = null;
    this.position = 0;
    this.exhausted = false;
  }

  /**
   * Find entries that match a criteria
   * @param {Function} predicate - Function that returns true for matches
   * @param {number} limit - Maximum number of entries to return
   * @return {Promise<Array>} - Matching entries
   * @public
   */
  async find(predicate, limit = Infinity) {
    const results = [];

    await this.forEach((entry) => {
      if (results.length >= limit) return;
      if (predicate(entry)) {
        results.push(entry);
      }
    });

    return results;
  }
}

module.exports = BulletStorageLog;
