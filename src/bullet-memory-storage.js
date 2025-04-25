/**
 * BulletMemoryStorage - In-memory storage implementation
 * A simple in-memory storage provider for Bullet.js with no persistence
 */
const BulletStorage = require("./bullet-storage");

class BulletMemoryStorage extends BulletStorage {
  /**
   * Create a new in-memory storage instance
   * @param {Object} bullet - The Bullet instance
   * @param {Object} options - Storage options
   */
  constructor(bullet, options = {}) {
    super(bullet, {
      snapshotInterval: 0, // No snapshots by default for memory storage
      enableStorageLog: false,
      ...options,
    });
  }

  /**
   * Initialize the memory storage
   * @protected
   * @override
   */
  _initStorage() {
    // Call parent initialization
    super._initStorage();

    // Take initial snapshot
    this._saveSnapshot();

    // Set up optional snapshot intervals if specified
    if (this.options.snapshotInterval > 0) {
      this.snapshotInterval = setInterval(() => {
        this._saveSnapshot();
      }, this.options.snapshotInterval);
    }
  }

  /**
   * Load data from storage - memory storage has nothing to load
   * @protected
   * @override
   */
  _loadData() {
    // Memory storage doesn't persist data between sessions
    // Just initialize empty in-memory structures
    this.persisted.store = {};
    this.persisted.meta = {};
    this.persisted.log = [];

    if (this.options.enableStorageLog) {
      console.log("Bullet: Memory storage initialized");
    }
  }

  /**
   * Save data to memory
   * @protected
   * @override
   */
  _saveData() {
    return this._saveSnapshot();
  }

  /**
   * Save a snapshot of the current state
   * @private
   */
  _saveSnapshot() {
    // Store the current state in memory
    if (this._hasChanges()) {
      try {
        // Create deep copies of the data to avoid reference issues
        this.persisted.store = JSON.parse(JSON.stringify(this.bullet.store));
        this.persisted.meta = JSON.parse(JSON.stringify(this.bullet.meta));
        this.persisted.log = [...this.bullet.log];

        if (this.options.enableStorageLog) {
          console.log("Bullet: Memory snapshot saved");
        }
      } catch (err) {
        console.error("Error creating memory snapshot:", err);
      }
    }
    return Promise.resolve();
  }

  /**
   * Clean up resources when closing
   * @public
   * @override
   */
  async close() {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }

    // Take one final snapshot when closing
    await super.close();

    if (this.options.enableStorageLog) {
      console.log("Bullet: Memory storage closed");
    }
  }
}

module.exports = BulletMemoryStorage;
