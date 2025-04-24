const BulletNetwork = require("./bullet-network");
const BulletStorage = require("./bullet-storage");
const BulletQuery = require("./bullet-query");
const BulletValidation = require("./bullet-validation");
const BulletMiddleware = require("./bullet-middleware");
const BulletSerializer = require("./bullet-serializer");
const BulletHam = require("./bullet-ham");

let BulletLevelDBStorage = null;
try {
  require.resolve("level");
  BulletLevelDBStorage = require("./bullet-leveldb-storage");
} catch (err) {
  console.log(
    "LevelDB dependency not available. LevelDB storage will be disabled."
  );
}

class Bullet {
  constructor(options = {}) {
    this.options = {
      peers: [],
      server: true,
      storage: true,
      storageType: "file",
      storagePath: "./.bullet",
      leveldbPath: "./.bullet-leveldb",
      encrypt: false,
      encryptionKey: null,
      enableIndexing: true,
      enableValidation: true,
      enableMiddleware: true,
      enableSerializer: true,
      enableStorageLog: false,
      ...options,
    };
    this.store = {};
    this.listeners = {};
    this.log = [];
    this.meta = {};
    this.BulletNode = BulletNode;
    this.id = this._generateId();

    console.log(`Bullet instance initialized with ID: ${this.id}`);

    if (BulletMiddleware && this.options.enableMiddleware) {
      this.middleware = new BulletMiddleware(this);
    }

    if (this.options.storage) {
      if (this.options.storageType === "leveldb") {
        if (BulletLevelDBStorage) {
          this.storage = new BulletLevelDBStorage(this, {
            path: this.options.leveldbPath || this.options.storagePath,
            encrypt: this.options.encrypt,
            encryptionKey: this.options.encryptionKey,
          });
        } else {
          console.warn(
            "LevelDB storage requested but module not available. Falling back to file storage."
          );
          if (BulletStorage) {
            this.storage = new BulletStorage(this, {
              path: this.options.storagePath,
              encrypt: this.options.encrypt,
              encryptionKey: this.options.encryptionKey,
              enableStorageLog: this.options.enableStorageLog,
            });
          }
        }
      } else if (BulletStorage) {
        this.storage = new BulletStorage(this, {
          path: this.options.storagePath,
          encrypt: this.options.encrypt,
          encryptionKey: this.options.encryptionKey,
          enableStorageLog: this.options.enableStorageLog,
        });
      }
    }

    if (BulletQuery && this.options.enableIndexing) {
      this.query = new BulletQuery(this);
    }

    if (BulletValidation && this.options.enableValidation) {
      this.validation = new BulletValidation(this);
    }

    if (BulletSerializer && this.options.enableSerializer) {
      this.serializer = new BulletSerializer(this);
    }

    if (BulletNetwork && !this.options.disableNetwork) {
      this.network = new BulletNetwork(this, this.options);
    }

    if (BulletHam && !this.options.disableHam) {
      this.ham = new BulletHam(this);
    }
  }

  /**
   * Create or access a node in the graph
   * @param {string} path - Path to the node
   * @return {BulletNode} - Node interface
   */
  get(path) {
    return new BulletNode(this, path);
  }

  /**
   * Internal method to get data at path
   * @param {string} path - Path to get data from
   * @return {*} - Data at path
   */
  _getData(path) {
    if (!path) return this.store;

    const parts = path.split("/").filter(Boolean);
    let current = this.store;

    for (const part of parts) {
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Internal method to set data at a given path with HAM conflict resolution
   *
   * @param {string} path - Path to set data at
   * @param {*} rawData - Data to set (may include __fromNetwork flag)
   * @param {boolean} [broadcast=true] - Whether to broadcast the change
   * @returns {*} - The resolved value after HAM
   */
  setData(path, rawData, broadcast = true) {
    const { data, fromNetwork } = this._stripNetworkFlag(rawData);
    const { doUpdate, value, vectorClock, broadcastData } =
      this.ham.handleUpdate(path, data, fromNetwork);

    if (!doUpdate) {
      return value;
    }

    this._applyUpdate(path, value, vectorClock, fromNetwork);

    if (broadcast && this.network) {
      this.network.broadcast(path, broadcastData);
    }

    return value;
  }

  /**
   * Remove __fromNetwork flag and detect origin
   * @private
   */
  _stripNetworkFlag(input) {
    let fromNetwork = false;
    let data = input;

    if (input && typeof input === "object" && input.__fromNetwork) {
      fromNetwork = true;
      if (Array.isArray(input)) {
        // clone array without flag
        data = input.filter((_, idx) => idx !== "__fromNetwork");
      } else {
        // shallow clone minus __fromNetwork
        const { __fromNetwork, ...rest } = input;
        data = rest;
      }
    }

    return { data, fromNetwork };
  }

  /**
   * Ensure nested path exists, update store, meta, log, and notify
   * @private
   */
  _applyUpdate(path, value, vectorClock, fromNetwork) {
    const parts = path.split("/").filter(Boolean);
    let node = this.store;

    parts.slice(0, -1).forEach((part) => {
      if (!node[part]) node[part] = {};
      node = node[part];
    });

    const key = parts[parts.length - 1];
    if (key) {
      node[key] = value;

      // metadata
      this.meta[path] = {
        ...(this.meta[path] || {}),
        source: fromNetwork ? "network" : "local",
        vectorClock,
      };

      // log
      this.log.push({
        op: "set",
        path,
        data: value,
        vectorClock,
      });
      if (this.log.length > 1000) {
        this.log.splice(0, this.log.length - 1000);
      }

      // notify subscribers
      this._notify(path, value);
    }
  }

  /**
   * Notify subscribers of data changes
   * @param {string} path - Path that changed
   * @param {*} data - New data
   */
  _notify(path, data) {
    if (this.listeners[path]) {
      this.listeners[path].forEach((callback) => {
        try {
          callback(data);
        } catch (err) {
          console.error(`Error in listener callback for ${path}:`, err);
        }
      });
    }

    const parts = path.split("/").filter(Boolean);
    while (parts.length > 0) {
      parts.pop();
      const parentPath = parts.join("/");

      if (this.listeners[parentPath]) {
        const parentData = this._getData(parentPath);
        this.listeners[parentPath].forEach((callback) => {
          try {
            callback(parentData);
          } catch (err) {
            console.error(
              `Error in parent listener callback for ${parentPath}:`,
              err
            );
          }
        });
      }
    }

    if (this.storage) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = setTimeout(() => {
        this.storage.save();
      }, 1000);
    }
  }

  /**
   * Generate a unique ID
   * @return {string} - Unique ID
   * @private
   */
  _generateId() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
  }

  /**
   * Close the Bullet instance and clean up resources
   * @public
   */
  close() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
    }

    if (this.storage) {
      this.storage.close();
    }

    if (this.network) {
      this.network.close();
    }

    this.listeners = {};

    console.log(`Bullet instance ${this.id} closed`);
  }

  /**
   * Create an index on a specific path and field
   * @param {string} path - Base path to index
   * @param {string} field - Field to index (optional for leaf nodes)
   * @return {Bullet} - This instance for chaining
   * @public
   */
  index(path, field = null) {
    if (this.query) {
      this.query.index(path, field);
    } else {
      console.warn(
        "Indexing not enabled. Enable with { enableIndexing: true }"
      );
    }
    return this;
  }

  /**
   * Query for nodes where field equals value
   * @param {string} path - Base path to query
   * @param {string} field - Field to compare (optional for leaf nodes)
   * @param {*} value - Value to match
   * @return {Array} - Array of BulletNode instances that match
   * @public
   */
  equals(path, field, value) {
    if (this.query) {
      return this.query.equals(path, field, value);
    } else {
      console.warn("Query not enabled. Enable with { enableIndexing: true }");
      return [];
    }
  }

  /**
   * Find nodes with field values in a range
   * @param {string} path - Base path to query
   * @param {string} field - Field to compare (optional for leaf nodes)
   * @param {*} min - Minimum value (inclusive)
   * @param {*} max - Maximum value (inclusive)
   * @return {Array} - Array of BulletNode instances that match
   * @public
   */
  range(path, field, min, max) {
    if (this.query) {
      return this.query.range(path, field, min, max);
    } else {
      console.warn("Query not enabled. Enable with { enableIndexing: true }");
      return [];
    }
  }

  /**
   * Find nodes matching a custom filter function
   * @param {string} path - Base path to query
   * @param {Function} filterFn - Filter function that takes a value and returns boolean
   * @return {Array} - Array of BulletNode instances that match
   * @public
   */
  filter(path, filterFn) {
    if (this.query) {
      return this.query.filter(path, filterFn);
    } else {
      console.warn("Query not enabled. Enable with { enableIndexing: true }");
      return [];
    }
  }

  /**
   * Find the first node that matches a condition
   * @param {string} path - Base path to query
   * @param {Function} predicateFn - Function that returns true for a match
   * @return {BulletNode|null} - Matching node or null
   * @public
   */
  find(path, predicateFn) {
    if (this.query) {
      return this.query.find(path, predicateFn);
    } else {
      console.warn("Query not enabled. Enable with { enableIndexing: true }");
      return null;
    }
  }

  /**
   * Define a data schema
   * @param {string} name - Schema name
   * @param {Object} schema - Schema definition
   * @return {Bullet} - This instance for chaining
   * @public
   */
  defineSchema(name, schema) {
    if (this.validation) {
      this.validation.defineSchema(name, schema);
    } else {
      console.warn(
        "Validation not enabled. Enable with { enableValidation: true }"
      );
    }
    return this;
  }

  /**
   * Apply a schema to a path
   * @param {string} path - Path to apply schema to
   * @param {string} schemaName - Name of schema to apply
   * @return {Bullet} - This instance for chaining
   * @public
   */
  applySchema(path, schemaName) {
    if (this.validation) {
      this.validation.applySchema(path, schemaName);
    } else {
      console.warn(
        "Validation not enabled. Enable with { enableValidation: true }"
      );
    }
    return this;
  }

  /**
   * Validate data against a schema
   * @param {string} schemaName - Name of schema to validate against
   * @param {*} data - Data to validate
   * @return {boolean} - Whether data is valid
   * @public
   */
  validate(schemaName, data) {
    if (this.validation) {
      return this.validation.validate(schemaName, data);
    } else {
      console.warn(
        "Validation not enabled. Enable with { enableValidation: true }"
      );
      return true;
    }
  }

  /**
   * Register an error handler for validation errors
   * @param {string} type - Error type to handle
   * @param {Function} handler - Handler function
   * @return {Bullet} - This instance for chaining
   * @public
   */
  onValidationError(type, handler) {
    if (this.validation) {
      this.validation.onError(type, handler);
    } else {
      console.warn(
        "Validation not enabled. Enable with { enableValidation: true }"
      );
    }
    return this;
  }

  /**
   * Register middleware for an operation
   * @param {string} operation - Operation type
   * @param {Function} middleware - Middleware function
   * @return {Bullet} - This instance for chaining
   * @public
   */
  use(operation, middleware) {
    if (this.middleware) {
      this.middleware.use(operation, middleware);
    } else {
      console.warn(
        "Middleware not enabled. Enable with { enableMiddleware: true }"
      );
    }
    return this;
  }

  /**
   * Add middleware for get operations
   * @param {Function} middleware - Middleware function
   * @return {Bullet} - This instance for chaining
   * @public
   */
  onGet(middleware) {
    return this.use("get", middleware);
  }

  /**
   * Add middleware for after get operations
   * @param {Function} middleware - Middleware function
   * @return {Bullet} - This instance for chaining
   * @public
   */
  afterGet(middleware) {
    return this.use("afterGet", middleware);
  }

  /**
   * Add middleware for put operations
   * @param {Function} middleware - Middleware function
   * @return {Bullet} - This instance for chaining
   * @public
   */
  beforePut(middleware) {
    return this.use("put", middleware);
  }

  /**
   * Add middleware for after put operations
   * @param {Function} middleware - Middleware function
   * @return {Bullet} - This instance for chaining
   * @public
   */
  afterPut(middleware) {
    return this.use("afterPut", middleware);
  }

  /**
   * Register a database event listener
   * @param {string} event - Event name
   * @param {Function} listener - Event listener
   * @return {Bullet} - This instance for chaining
   * @public
   */
  on(event, listener) {
    if (this.middleware) {
      this.middleware.on(event, listener);
    } else if (event === "change" || event === "value") {
      console.warn("For change listeners, use node.on() instead");
    } else {
      console.warn(
        "Event system requires middleware. Enable with { enableMiddleware: true }"
      );
    }
    return this;
  }

  /**
   * Export data at a path to JSON
   * @param {string} path - Path to export
   * @param {Object} options - Export options
   * @return {string} - JSON string
   * @public
   */
  exportToJSON(path = "", options = {}) {
    if (this.serializer) {
      return this.serializer.exportToJSON(path, options);
    } else {
      console.warn(
        "Serializer not enabled. Enable with { enableSerializer: true }"
      );
      return JSON.stringify(this._getData(path));
    }
  }

  /**
   * Import JSON data
   * @param {string} json - JSON string
   * @param {string} targetPath - Target path
   * @param {Object} options - Import options
   * @return {Object} - Import result
   * @public
   */
  importFromJSON(json, targetPath = null, options = {}) {
    if (this.serializer) {
      return this.serializer.importFromJSON(json, targetPath, options);
    } else {
      console.warn(
        "Serializer not enabled. Enable with { enableSerializer: true }"
      );
      try {
        const data = JSON.parse(json);
        this.setData(targetPath, data);
        return { success: true, path: targetPath, data };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }

  /**
   * Export data at a path to CSV
   * @param {string} path - Path to export
   * @param {Object} options - Export options
   * @return {string} - CSV string
   * @public
   */
  exportToCSV(path, options = {}) {
    if (this.serializer) {
      return this.serializer.exportToCSV(path, options);
    } else {
      console.warn(
        "Serializer not enabled. Enable with { enableSerializer: true }"
      );
      return "";
    }
  }

  /**
   * Import CSV data
   * @param {string} csv - CSV string
   * @param {string} targetPath - Target path
   * @param {Object} options - Import options
   * @return {Object} - Import result
   * @public
   */
  importFromCSV(csv, targetPath, options = {}) {
    if (this.serializer) {
      return this.serializer.importFromCSV(csv, targetPath, options);
    } else {
      console.warn(
        "Serializer not enabled. Enable with { enableSerializer: true }"
      );
      return { success: false, error: "Serializer not enabled" };
    }
  }

  /**
   * Export data at a path to XML
   * @param {string} path - Path to export
   * @param {Object} options - Export options
   * @return {string} - XML string
   * @public
   */
  exportToXML(path, options = {}) {
    if (this.serializer) {
      return this.serializer.exportToXML(path, options);
    } else {
      console.warn(
        "Serializer not enabled. Enable with { enableSerializer: true }"
      );
      return "";
    }
  }

  /**
   * Import XML data
   * @param {string} xml - XML string
   * @param {string} targetPath - Target path
   * @param {Object} options - Import options
   * @return {Object} - Import result
   * @public
   */
  importFromXML(xml, targetPath, options = {}) {
    if (this.serializer) {
      return this.serializer.importFromXML(xml, targetPath, options);
    } else {
      console.warn(
        "Serializer not enabled. Enable with { enableSerializer: true }"
      );
      return { success: false, error: "Serializer not enabled" };
    }
  }

  /**
   * Register a custom type serializer
   * @param {string} typeName - Type name
   * @param {Function} serializer - Serializer function
   * @param {Function} deserializer - Deserializer function
   * @return {Bullet} - This instance for chaining
   * @public
   */
  registerSerializerType(typeName, serializer, deserializer) {
    if (this.serializer) {
      this.serializer.registerType(typeName, serializer, deserializer);
    } else {
      console.warn(
        "Serializer not enabled. Enable with { enableSerializer: true }"
      );
    }
    return this;
  }
}

/**
 * Node class representing a node in the Bullet graph
 */
class BulletNode {
  constructor(bullet, path) {
    this.bullet = bullet;
    this.path = path;
  }

  /**
   * Get the value at this node
   * @return {*} - Node value
   */
  value() {
    return this.bullet._getData(this.path);
  }

  /**
   * Set data at this node
   * @param {*} data - Data to set
   * @return {BulletNode} - This node for chaining
   */
  put(data) {
    this.bullet.setData(this.path, data);
    return this;
  }

  /**
   * Subscribe to changes at this node
   * @param {Function} callback - Function to call when data changes
   * @return {BulletNode} - This node for chaining
   */
  on(callback) {
    if (!this.bullet.listeners[this.path]) {
      this.bullet.listeners[this.path] = [];
    }

    this.bullet.listeners[this.path].push(callback);

    callback(this.value());

    return this;
  }

  /**
   * Create or access a child node
   * @param {string} childPath - Path to the child
   * @return {BulletNode} - Child node
   */
  get(childPath) {
    const fullPath = this.path ? `${this.path}/${childPath}` : childPath;
    return new BulletNode(this.bullet, fullPath);
  }

  /**
   * Remove a subscription
   * @param {Function} callback - Function to remove
   * @return {BulletNode} - This node for chaining
   */
  off(callback) {
    if (this.bullet.listeners[this.path]) {
      if (callback) {
        const index = this.bullet.listeners[this.path].indexOf(callback);
        if (index >= 0) {
          this.bullet.listeners[this.path].splice(index, 1);
        }
      } else {
        this.bullet.listeners[this.path] = [];
      }
    }
    return this;
  }

  /**
   * Remove this node and its data
   * @return {BulletNode} - This node for chaining
   */
  remove() {
    this.bullet.setData(this.path, null);
    return this;
  }
}

module.exports = Bullet;
