/**
 * ConflictResolver - Handles resolution of concurrent updates
 * Implements various strategies for resolving conflicts between updates
 */

class ConflictResolver {
  /**
   * Create a new ConflictResolver
   * @param {Object} options - Conflict resolution options
   * @param {string} [options.defaultStrategy="last-write-wins"] - Default resolution strategy
   * @param {Object} [options.pathStrategies={}] - Map of paths to strategies
   * @param {Object} [options.customResolvers={}] - Map of paths to custom resolver functions
   */
  constructor(options = {}) {
    // Default resolution strategy
    this.defaultStrategy = options.defaultStrategy || "last-write-wins";

    // Map of path prefixes to resolution strategies
    this.pathStrategies = options.pathStrategies || {};

    // Map of custom resolver functions
    this.customResolvers = options.customResolvers || {};
  }

  /**
   * Resolve a conflict between two versions
   * @param {string} path - The data path
   * @param {Object} localData - Local data with value, vectorClock, timestamp
   * @param {Object} remoteData - Remote data with value, vectorClock, timestamp
   * @returns {Object} Resolved data
   */
  resolve(path, localData, remoteData) {
    // If either value is null (deleted), handle specially
    if (localData.value === null || remoteData.value === null) {
      return this._resolveWithDeletion(path, localData, remoteData);
    }

    // Find the appropriate strategy for this path
    const strategy = this.getStrategyForPath(path);

    // Apply the selected strategy
    switch (strategy) {
      case "last-write-wins":
        return this._lastWriteWins(localData, remoteData);

      case "first-write-wins":
        return this._firstWriteWins(localData, remoteData);

      case "merge-fields":
        return this.mergeFields(path, localData, remoteData);

      case "custom":
        return this._applyCustomResolver(path, localData, remoteData);

      default:
        // Fallback to last-write-wins
        console.log(
          `Unknown strategy "${strategy}", falling back to last-write-wins`
        );
        return this._lastWriteWins(localData, remoteData);
    }
  }

  /**
   * Handle conflict resolution when at least one side has a deletion
   * @private
   */
  _resolveWithDeletion(path, localData, remoteData) {
    // If both are deletions, take the later one
    if (localData.value === null && remoteData.value === null) {
      return localData.timestamp > remoteData.timestamp
        ? localData
        : remoteData;
    }

    // For deletion conflicts, we need to decide if deletion wins or update wins
    // For this implementation, we'll use timestamps to decide
    // Later operations win over earlier ones
    if (localData.value === null) {
      // Local is a deletion
      if (localData.timestamp > remoteData.timestamp) {
        console.log(`Deletion wins for ${path}`);
        return localData;
      } else {
        console.log(`Remote update wins over deletion for ${path}`);
        return remoteData;
      }
    } else {
      // Remote is a deletion
      if (remoteData.timestamp > localData.timestamp) {
        console.log(`Deletion wins for ${path}`);
        return remoteData;
      } else {
        console.log(`Local update wins over deletion for ${path}`);
        return localData;
      }
    }
  }

  /**
   * Last-write-wins strategy based on timestamp
   * @private
   */
  _lastWriteWins(localData, remoteData) {
    return localData.timestamp >= remoteData.timestamp ? localData : remoteData;
  }

  /**
   * First-write-wins strategy based on timestamp
   * @private
   */
  _firstWriteWins(localData, remoteData) {
    return localData.timestamp <= remoteData.timestamp ? localData : remoteData;
  }

  /**
   * Merge fields from both objects
   * For fields present in both, use the latest timestamp
   */
  mergeFields(path, localData, remoteData) {
    console.log(`Merging fields for ${path}`);

    // Ensure we're dealing with objects
    if (
      typeof localData.value !== "object" ||
      typeof remoteData.value !== "object" ||
      localData.value === null ||
      remoteData.value === null ||
      Array.isArray(localData.value) ||
      Array.isArray(remoteData.value)
    ) {
      // If not objects, fall back to last-write-wins
      console.log(
        `Cannot merge non-object values, falling back to last-write-wins`
      );
      return this._lastWriteWins(localData, remoteData);
    }

    // Create a new result object based on the newer data's metadata
    const result = {
      ...(localData.timestamp >= remoteData.timestamp ? localData : remoteData),
      value: {}, // Start with empty value
    };

    // Copy all fields from both objects
    if (localData.value) {
      Object.assign(result.value, localData.value);
    }

    if (remoteData.value) {
      // For fields that exist in both objects, determine which to keep based on timestamp
      // For fields unique to remoteData, always include them
      Object.keys(remoteData.value).forEach((key) => {
        if (
          !(key in localData.value) ||
          remoteData.timestamp >= localData.timestamp
        ) {
          result.value[key] = remoteData.value[key];
        }
      });
    }

    // Merge vector clocks (if available)
    if (localData.vectorClock && remoteData.vectorClock) {
      // Handle both objects and real VectorClock instances
      if (typeof localData.vectorClock.merge === "function") {
        result.vectorClock = localData.vectorClock.merge(
          remoteData.vectorClock
        );
      } else if (typeof remoteData.vectorClock.merge === "function") {
        result.vectorClock = remoteData.vectorClock.merge(
          localData.vectorClock
        );
      } else {
        // Manual merge of vector clocks
        result.vectorClock = { ...localData.vectorClock };
        for (const nodeId in remoteData.vectorClock) {
          const localCount = result.vectorClock[nodeId] || 0;
          const remoteCount = remoteData.vectorClock[nodeId];
          result.vectorClock[nodeId] = Math.max(localCount, remoteCount);
        }
      }
    }

    // Use the latest timestamp
    result.timestamp = Math.max(localData.timestamp, remoteData.timestamp);

    return result;
  }

  /**
   * Apply a custom resolver for a specific path
   * @private
   */
  _applyCustomResolver(path, localData, remoteData) {
    const resolver = this._getCustomResolverForPath(path);

    if (!resolver) {
      console.warn(
        `No custom resolver found for ${path}, falling back to last-write-wins`
      );
      return this._lastWriteWins(localData, remoteData);
    }

    try {
      return resolver(path, localData, remoteData);
    } catch (error) {
      console.error(`Error in custom resolver for ${path}:`, error);
      return this._lastWriteWins(localData, remoteData);
    }
  }

  /**
   * Get the appropriate strategy for a path
   * @param {string} path - Data path
   * @returns {string} Resolution strategy
   */
  getStrategyForPath(path) {
    // Check for exact match
    if (this.pathStrategies[path]) {
      return this.pathStrategies[path];
    }

    // Check for prefix match by checking each segment
    const pathParts = path.split("/");
    let longestMatch = null;
    let longestMatchLength = 0;

    // Try increasingly specific paths and find the longest match
    for (let i = pathParts.length; i > 0; i--) {
      const partialPath = pathParts.slice(0, i).join("/");
      if (this.pathStrategies[partialPath]) {
        // Found a match, check if it's longer than our current longest match
        if (partialPath.length > longestMatchLength) {
          longestMatch = partialPath;
          longestMatchLength = partialPath.length;
        }
      }
    }

    // If we found a match, return its strategy
    if (longestMatch) {
      return this.pathStrategies[longestMatch];
    }

    // Try prefix matches (legacy method)
    let bestMatch = null;
    let bestMatchLength = 0;

    for (const prefix in this.pathStrategies) {
      if (path.startsWith(prefix + "/") || path === prefix) {
        // Found a match, check if it's longer than our current best match
        if (prefix.length > bestMatchLength) {
          bestMatch = prefix;
          bestMatchLength = prefix.length;
        }
      }
    }

    // If we found a match, return its strategy
    if (bestMatch) {
      return this.pathStrategies[bestMatch];
    }

    // Return default strategy
    return this.defaultStrategy;
  }

  /**
   * Get a custom resolver for a path
   * @private
   * @param {string} path - Data path
   * @returns {Function|null} Resolver function
   */
  _getCustomResolverForPath(path) {
    // Check for exact match
    if (this.customResolvers[path]) {
      return this.customResolvers[path];
    }

    // Check for prefix match by checking each segment
    const pathParts = path.split("/");
    let longestMatch = null;
    let longestMatchLength = 0;

    // Try increasingly specific paths and find the longest match
    for (let i = pathParts.length; i > 0; i--) {
      const partialPath = pathParts.slice(0, i).join("/");
      if (this.customResolvers[partialPath]) {
        // Found a match, check if it's longer than our current longest match
        if (partialPath.length > longestMatchLength) {
          longestMatch = partialPath;
          longestMatchLength = partialPath.length;
        }
      }
    }

    // If we found a match, return its resolver
    if (longestMatch) {
      return this.customResolvers[longestMatch];
    }

    // Try prefix matches (legacy method)
    let bestMatch = null;
    let bestMatchLength = 0;

    for (const prefix in this.customResolvers) {
      if (path.startsWith(prefix + "/") || path === prefix) {
        // Found a match, check if it's longer than our current best match
        if (prefix.length > bestMatchLength) {
          bestMatch = prefix;
          bestMatchLength = prefix.length;
        }
      }
    }

    // If we found a match, return its resolver
    if (bestMatch) {
      return this.customResolvers[bestMatch];
    }

    // No custom resolver found
    return null;
  }

  /**
   * Register a custom resolver for a path or prefix
   * @param {string} pathPrefix - Path prefix
   * @param {Function} resolverFn - Resolver function
   */
  registerCustomResolver(pathPrefix, resolverFn) {
    this.customResolvers[pathPrefix] = resolverFn;
    this.pathStrategies[pathPrefix] = "custom";
  }

  /**
   * Set a resolution strategy for a path or prefix
   * @param {string} pathPrefix - Path prefix
   * @param {string} strategy - Strategy name
   */
  setStrategy(pathPrefix, strategy) {
    this.pathStrategies[pathPrefix] = strategy;
  }
}

module.exports = ConflictResolver;
