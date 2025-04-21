/**
 * Bullet-Query.js - Query and indexing capabilities for Bullet.js
 */

class BulletQuery {
  constructor(bullet) {
    this.bullet = bullet;

    // Index store - maintains various indices for faster queries
    this.indices = {};

    // Set of indexed paths
    this.indexedPaths = new Set();

    // Initialize indexing hooks
    this._initIndexing();
  }

  /**
   * Initialize indexing by setting up data change hooks
   * @private
   */
  _initIndexing() {
    // Save original _setData method
    const originalSetData = this.bullet._setData.bind(this.bullet);

    // Override _setData to update indices on data changes
    this.bullet._setData = (
      path,
      data,
      timestamp = Date.now(),
      broadcast = true
    ) => {
      // Call original method
      originalSetData(path, data, timestamp, broadcast);

      // Update indices if the path is indexed
      this._updateIndices(path, data);
    };
  }

  /**
   * Create an index on a specific path and field
   * @param {string} path - Base path to index
   * @param {string} field - Field to index (optional for leaf nodes)
   * @return {BulletQuery} - This instance for chaining
   * @public
   */
  index(path, field = null) {
    const indexKey = field ? `${path}:${field}` : path;

    // Check if already indexed
    if (this.indices[indexKey]) {
      return this;
    }

    console.log(`Creating index on ${indexKey}`);

    // Create the index
    this.indices[indexKey] = new Map();
    this.indexedPaths.add(path);

    // Build initial index
    this._buildIndex(path, field);

    return this;
  }

  /**
   * Build an index for a path and field
   * @param {string} path - Base path to index
   * @param {string} field - Field to index
   * @private
   */
  _buildIndex(path, field) {
    const indexKey = field ? `${path}:${field}` : path;
    const index = this.indices[indexKey];

    // Get all data at the path
    const baseData = this.bullet._getData(path);

    if (typeof baseData === "object" && baseData !== null) {
      if (field) {
        // Index specific field in child objects
        for (const [key, value] of Object.entries(baseData)) {
          if (typeof value === "object" && value !== null && field in value) {
            const fieldValue = value[field];
            this._addToIndex(index, fieldValue, `${path}/${key}`);
          }
        }
      } else {
        // Index the leaf values directly
        for (const [key, value] of Object.entries(baseData)) {
          this._addToIndex(index, value, `${path}/${key}`);
        }
      }
    }
  }

  /**
   * Add a value to an index
   * @param {Map} index - Index to update
   * @param {*} value - Value to index
   * @param {string} nodePath - Path to the node
   * @private
   */
  _addToIndex(index, value, nodePath) {
    // Handle different value types
    if (value === null || value === undefined) {
      // Skip null values
      return;
    }

    // Convert value to string for indexing
    const indexValue = this._getIndexableValue(value);

    // Add to index
    if (!index.has(indexValue)) {
      index.set(indexValue, new Set());
    }

    index.get(indexValue).add(nodePath);
  }

  /**
   * Remove a value from an index
   * @param {Map} index - Index to update
   * @param {*} value - Value to remove
   * @param {string} nodePath - Path to the node
   * @private
   */
  _removeFromIndex(index, value, nodePath) {
    if (value === null || value === undefined) {
      return;
    }

    // Convert value to string for indexing
    const indexValue = this._getIndexableValue(value);

    if (index.has(indexValue)) {
      const paths = index.get(indexValue);
      paths.delete(nodePath);

      // Clean up empty sets
      if (paths.size === 0) {
        index.delete(indexValue);
      }
    }
  }

  /**
   * Get a value that can be used as an index key
   * @param {*} value - Value to convert
   * @return {string} - Indexable value
   * @private
   */
  _getIndexableValue(value) {
    if (typeof value === "object" && value !== null) {
      return JSON.stringify(value);
    }
    return String(value);
  }

  /**
   * Update indices for a changed path
   * @param {string} path - Path that changed
   * @param {*} newData - New data value
   * @private
   */
  _updateIndices(path, newData) {
    // Find relevant indices for this path
    for (const indexedPath of this.indexedPaths) {
      if (path.startsWith(indexedPath + "/")) {
        const relativePath = path.slice(indexedPath.length + 1);
        const parts = relativePath.split("/");

        // Handle different index types
        for (const [indexKey, index] of Object.entries(this.indices)) {
          const [basePath, field] = indexKey.split(":");

          if (basePath !== indexedPath) continue;

          if (field && parts.length === 1) {
            // This is a field-specific index and we changed a direct child
            // We need to update the index for this path
            const oldData = this.bullet._getData(`${indexedPath}/${parts[0]}`);

            if (oldData && oldData[field]) {
              // Remove old value from index
              this._removeFromIndex(
                index,
                oldData[field],
                `${indexedPath}/${parts[0]}`
              );
            }

            if (newData && newData[field]) {
              // Add new value to index
              this._addToIndex(
                index,
                newData[field],
                `${indexedPath}/${parts[0]}`
              );
            }
          } else if (!field && parts.length === 1) {
            // This is a direct child index
            // Remove old value and add new one
            const oldData = this.bullet._getData(path);
            this._removeFromIndex(index, oldData, path);
            this._addToIndex(index, newData, path);
          }
        }
      }
    }
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
    // Handle case where field is actually the value (for leaf nodes)
    if (arguments.length === 2) {
      value = field;
      field = null;
    }

    const indexKey = field ? `${path}:${field}` : path;

    // Create index if it doesn't exist
    if (!this.indices[indexKey]) {
      this.index(path, field);
    }

    const index = this.indices[indexKey];
    const indexValue = this._getIndexableValue(value);
    const results = [];

    // Find all matching nodes
    if (index.has(indexValue)) {
      const paths = index.get(indexValue);
      for (const nodePath of paths) {
        results.push(this.bullet.get(nodePath));
      }
    }

    return results;
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
    // Handle case where field is actually min (for leaf nodes)
    if (arguments.length === 3) {
      max = min;
      min = field;
      field = null;
    }

    const indexKey = field ? `${path}:${field}` : path;

    // Create index if it doesn't exist
    if (!this.indices[indexKey]) {
      this.index(path, field);
    }

    const index = this.indices[indexKey];
    const results = [];

    // Find all values in range
    for (const [indexValue, paths] of index.entries()) {
      // Convert to appropriate type for comparison
      let value;
      try {
        // Try to parse as number first
        value = Number(indexValue);
        if (isNaN(value)) {
          // If not a number, use string comparison
          value = indexValue;
        }
      } catch (e) {
        // Fallback to string
        value = indexValue;
      }

      // Compare in appropriate range
      if (
        typeof min !== "undefined" &&
        value >= min &&
        typeof max !== "undefined" &&
        value <= max
      ) {
        for (const nodePath of paths) {
          results.push(this.bullet.get(nodePath));
        }
      }
    }

    return results;
  }

  /**
   * Find nodes matching a custom filter function
   * @param {string} path - Base path to query
   * @param {Function} filterFn - Filter function that takes a value and returns boolean
   * @return {Array} - Array of BulletNode instances that match
   * @public
   */
  filter(path, filterFn) {
    const baseData = this.bullet._getData(path);
    const results = [];

    if (typeof baseData === "object" && baseData !== null) {
      for (const [key, value] of Object.entries(baseData)) {
        if (filterFn(value, key)) {
          results.push(this.bullet.get(`${path}/${key}`));
        }
      }
    }

    return results;
  }

  /**
   * Count the number of nodes that match a query
   * @param {string} path - Base path to query
   * @param {string} field - Field to compare (optional for leaf nodes)
   * @param {*} value - Value to match
   * @return {number} - Count of matching nodes
   * @public
   */
  count(path, field, value) {
    // Handle case where field is actually the value (for leaf nodes)
    if (arguments.length === 2) {
      value = field;
      field = null;
    }

    const indexKey = field ? `${path}:${field}` : path;

    // Create index if it doesn't exist
    if (!this.indices[indexKey]) {
      this.index(path, field);
    }

    const index = this.indices[indexKey];
    const indexValue = this._getIndexableValue(value);

    // Return count of matching nodes
    if (index.has(indexValue)) {
      return index.get(indexValue).size;
    }

    return 0;
  }

  /**
   * Map values of nodes to a new array
   * @param {string} path - Base path to query
   * @param {Function} mapFn - Mapping function
   * @return {Array} - Mapped values
   * @public
   */
  map(path, mapFn) {
    const baseData = this.bullet._getData(path);
    const results = [];

    if (typeof baseData === "object" && baseData !== null) {
      for (const [key, value] of Object.entries(baseData)) {
        results.push(mapFn(value, key));
      }
    }

    return results;
  }

  /**
   * Find the first node that matches a condition
   * @param {string} path - Base path to query
   * @param {Function} predicateFn - Function that returns true for a match
   * @return {BulletNode|null} - Matching node or null
   * @public
   */
  find(path, predicateFn) {
    const baseData = this.bullet._getData(path);

    if (typeof baseData === "object" && baseData !== null) {
      for (const [key, value] of Object.entries(baseData)) {
        if (predicateFn(value, key)) {
          return this.bullet.get(`${path}/${key}`);
        }
      }
    }

    return null;
  }
}

module.exports = BulletQuery;
