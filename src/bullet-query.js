class BulletQuery {
  constructor(bullet) {
    this.bullet = bullet;

    this.indices = {};

    this.indexedPaths = new Set();

    this._initIndexing();
  }

  /**
   * Initialize indexing by setting up data change hooks
   * @private
   */
  _initIndexing() {
    const originalSetData = this.bullet.setData.bind(this.bullet);

    this.bullet.setData = (path, data, broadcast = true) => {
      originalSetData(path, data, broadcast);

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

    if (this.indices[indexKey]) {
      return this;
    }

    console.log(`Creating index on ${indexKey}`);

    this.indices[indexKey] = new Map();
    this.indexedPaths.add(path);

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

    const baseData = this.bullet._getData(path);

    if (typeof baseData === "object" && baseData !== null) {
      if (field) {
        for (const [key, value] of Object.entries(baseData)) {
          if (typeof value === "object" && value !== null && field in value) {
            const fieldValue = value[field];
            this._addToIndex(index, fieldValue, `${path}/${key}`);
          }
        }
      } else {
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
    if (value === null || value === undefined) {
      return;
    }

    const indexValue = this._getIndexableValue(value);

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

    const indexValue = this._getIndexableValue(value);

    if (index.has(indexValue)) {
      const paths = index.get(indexValue);
      paths.delete(nodePath);

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
    for (const indexedPath of this.indexedPaths) {
      if (path.startsWith(indexedPath + "/")) {
        const relativePath = path.slice(indexedPath.length + 1);
        const parts = relativePath.split("/");

        for (const [indexKey, index] of Object.entries(this.indices)) {
          const [basePath, field] = indexKey.split(":");

          if (basePath !== indexedPath) continue;

          if (field && parts.length === 1) {
            const oldData = this.bullet._getData(`${indexedPath}/${parts[0]}`);

            if (oldData && oldData[field]) {
              this._removeFromIndex(
                index,
                oldData[field],
                `${indexedPath}/${parts[0]}`
              );
            }

            if (newData && newData[field]) {
              this._addToIndex(
                index,
                newData[field],
                `${indexedPath}/${parts[0]}`
              );
            }
          } else if (!field && parts.length === 1) {
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
    if (arguments.length === 2) {
      value = field;
      field = null;
    }

    const indexKey = field ? `${path}:${field}` : path;

    if (!this.indices[indexKey]) {
      this.index(path, field);
    }

    const index = this.indices[indexKey];
    const indexValue = this._getIndexableValue(value);
    const results = [];

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
    if (arguments.length === 3) {
      max = min;
      min = field;
      field = null;
    }

    const indexKey = field ? `${path}:${field}` : path;

    if (!this.indices[indexKey]) {
      this.index(path, field);
    }

    const index = this.indices[indexKey];
    const results = [];

    for (const [indexValue, paths] of index.entries()) {
      let value;
      try {
        value = Number(indexValue);
        if (isNaN(value)) {
          value = indexValue;
        }
      } catch (e) {
        value = indexValue;
      }

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
    if (arguments.length === 2) {
      value = field;
      field = null;
    }

    const indexKey = field ? `${path}:${field}` : path;

    if (!this.indices[indexKey]) {
      this.index(path, field);
    }

    const index = this.indices[indexKey];
    const indexValue = this._getIndexableValue(value);

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
