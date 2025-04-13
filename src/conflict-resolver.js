/**
 * ConflictResolver for P2P Server
 * Handles resolution of concurrent updates
 */

class ConflictResolver {
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
   * @param {String} path - The data path
   * @param {Object} localData - Local data with value, vectorClock, timestamp
   * @param {Object} remoteData - Remote data with value, vectorClock, timestamp
   * @returns {Object} Resolved data
   */
  resolve(path, localData, remoteData) {
    // If either value is null (deleted), handle specially
    if (localData.value === null || remoteData.value === null) {
      return this.resolveWithDeletion(path, localData, remoteData);
    }

    // Find the appropriate strategy for this path
    const strategy = this.getStrategyForPath(path);

    console.log(`Resolving conflict for ${path} using ${strategy} strategy`);

    // Apply the selected strategy
    switch (strategy) {
      case "last-write-wins":
        return this.lastWriteWins(localData, remoteData);

      case "first-write-wins":
        return this.firstWriteWins(localData, remoteData);

      case "merge-fields":
        return this.mergeFields(path, localData, remoteData);

      case "custom":
        return this.applyCustomResolver(path, localData, remoteData);

      default:
        // Fallback to last-write-wins
        return this.lastWriteWins(localData, remoteData);
    }
  }

  /**
   * Handle conflict resolution when at least one side has a deletion
   */
  resolveWithDeletion(path, localData, remoteData) {
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
   */
  lastWriteWins(localData, remoteData) {
    return localData.timestamp >= remoteData.timestamp ? localData : remoteData;
  }

  /**
   * First-write-wins strategy based on timestamp
   */
  firstWriteWins(localData, remoteData) {
    return localData.timestamp <= remoteData.timestamp ? localData : remoteData;
  }

  /**
   * Merge fields from both objects
   * For fields present in both, use the latest timestamp
   */
  mergeFields(path, localData, remoteData) {
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
      return this.lastWriteWins(localData, remoteData);
    }

    // Start with a copy of the local data
    const result = {
      ...localData,
      value: { ...localData.value },
    };

    // Create an object to track field-level timestamps
    const fieldTimestamps = {};

    // Initialize with timestamps from local data
    for (const key in localData.value) {
      fieldTimestamps[key] = localData.timestamp;
    }

    // Process fields from remote data
    for (const key in remoteData.value) {
      // If the field doesn't exist locally, or remote timestamp is newer
      if (
        !(key in result.value) ||
        remoteData.timestamp > fieldTimestamps[key]
      ) {
        result.value[key] = remoteData.value[key];
        fieldTimestamps[key] = remoteData.timestamp;
      }
    }

    // Merge vector clocks
    result.vectorClock = localData.vectorClock.merge(remoteData.vectorClock);

    // Use the latest timestamp
    result.timestamp = Math.max(localData.timestamp, remoteData.timestamp);

    return result;
  }

  /**
   * Apply a custom resolver for a specific path
   */
  applyCustomResolver(path, localData, remoteData) {
    const resolver = this.getCustomResolverForPath(path);

    if (!resolver) {
      console.warn(
        `No custom resolver found for ${path}, falling back to last-write-wins`
      );
      return this.lastWriteWins(localData, remoteData);
    }

    try {
      return resolver(path, localData, remoteData);
    } catch (error) {
      console.error(`Error in custom resolver for ${path}:`, error);
      return this.lastWriteWins(localData, remoteData);
    }
  }

  /**
   * Get the appropriate strategy for a path
   */
  getStrategyForPath(path) {
    // Check for exact match
    if (this.pathStrategies[path]) {
      return this.pathStrategies[path];
    }

    // Check for prefix match
    for (const prefix in this.pathStrategies) {
      if (path.startsWith(prefix + "/")) {
        return this.pathStrategies[prefix];
      }
    }

    // Return default strategy
    return this.defaultStrategy;
  }

  /**
   * Get a custom resolver for a path
   */
  getCustomResolverForPath(path) {
    // Check for exact match
    if (this.customResolvers[path]) {
      return this.customResolvers[path];
    }

    // Check for prefix match
    for (const prefix in this.customResolvers) {
      if (path.startsWith(prefix + "/")) {
        return this.customResolvers[prefix];
      }
    }

    // No custom resolver found
    return null;
  }

  /**
   * Register a custom resolver for a path or prefix
   */
  registerCustomResolver(pathPrefix, resolverFn) {
    this.customResolvers[pathPrefix] = resolverFn;
    this.pathStrategies[pathPrefix] = "custom";
  }

  /**
   * Set a resolution strategy for a path or prefix
   */
  setStrategy(pathPrefix, strategy) {
    this.pathStrategies[pathPrefix] = strategy;
  }
}

module.exports = ConflictResolver;
