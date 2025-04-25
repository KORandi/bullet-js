/**
 * BulletStorage - Abstract base storage class
 * Defines the interface for storage providers in Bullet.js
 */
class BulletStorage {
  /**
   * Create a new storage instance
   * @param {Object} bullet - The Bullet instance
   * @param {Object} options - Storage options
   */
  constructor(bullet, options = {}) {
    this.bullet = bullet;
    this.options = {
      enableStorageLog: false,
      ...options,
    };

    // Track persisted state for change detection
    this.persisted = {
      store: {},
      meta: {},
      log: [],
    };

    // Initialize the storage provider
    this._initStorage();
  }

  /**
   * Initialize the storage provider
   * Must be implemented by subclasses
   * @protected
   */
  _initStorage() {
    this._loadData();
  }

  /**
   * Load data from storage
   * Must be implemented by subclasses
   * @protected
   */
  _loadData() {
    // Base implementation does nothing
    // Subclasses should override this method
    if (this.options.enableStorageLog) {
      console.log("Bullet: Base storage initialized (no data loaded)");
    }
  }

  /**
   * Save data to storage
   * Must be implemented by subclasses
   * @protected
   */
  _saveData() {
    // Base implementation does nothing
    // Subclasses should override this method
    return Promise.resolve();
  }

  /**
   * Check if there are changes to persist
   * @return {boolean} - Whether there are changes
   * @protected
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

    return this._hasStoreChanges(this.bullet.store, this.persisted.store);
  }

  /**
   * Recursively check for changes in store objects
   * @param {Object} current - Current state
   * @param {Object} persisted - Persisted state
   * @return {boolean} - Whether there are changes
   * @protected
   */
  _hasStoreChanges(current, persisted) {
    // Quick reference equality check
    if (current === persisted) {
      return false;
    }

    // Check for type differences or null/undefined
    if (
      typeof current !== typeof persisted ||
      current === null ||
      persisted === null
    ) {
      return true;
    }

    // Handle arrays
    if (Array.isArray(current)) {
      if (!Array.isArray(persisted) || current.length !== persisted.length) {
        return true;
      }

      // Check each element
      for (let i = 0; i < current.length; i++) {
        if (this._hasStoreChanges(current[i], persisted[i])) {
          return true;
        }
      }
      return false;
    }

    // Handle objects
    if (typeof current === "object") {
      const currentKeys = Object.keys(current);
      const persistedKeys = Object.keys(persisted);

      if (currentKeys.length !== persistedKeys.length) {
        return true;
      }

      for (const key of currentKeys) {
        if (
          !persisted.hasOwnProperty(key) ||
          this._hasStoreChanges(current[key], persisted[key])
        ) {
          return true;
        }
      }
      return false;
    }

    // Simple value comparison for other types
    return current !== persisted;
  }

  /**
   * Deep merge objects
   * @param {Object} target - Target object
   * @param {Object} source - Source object
   * @return {Object} - Merged object
   * @protected
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
   * Manual trigger to save state
   * @return {Promise} - Promise that resolves when save is complete
   * @public
   */
  async save() {
    return this._saveData();
  }

  /**
   * Close storage and clean up
   * @public
   */
  async close() {
    await this._saveData();
  }
}

module.exports = BulletStorage;
