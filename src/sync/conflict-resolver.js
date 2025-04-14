const VectorClock = require("./vector-clock");

/**
 * ConflictResolver - Handles resolution of concurrent updates
 * Implements various strategies for resolving conflicts between updates
 */

class ConflictResolver {
  /**
   * Create a new ConflictResolver
   * @param {Object} options - Conflict resolution options
   * @param {string} [options.defaultStrategy="vector-dominance"] - Default resolution strategy
   * @param {Object} [options.pathStrategies={}] - Map of paths to strategies
   * @param {Object} [options.customResolvers={}] - Map of paths to custom resolver functions
   */
  constructor(options = {}) {
    // Default resolution strategy
    this.defaultStrategy = options.defaultStrategy || "vector-dominance";

    // Map of path prefixes to resolution strategies
    this.pathStrategies = options.pathStrategies || {};

    // Map of custom resolver functions
    this.customResolvers = options.customResolvers || {};
  }

  /**
   * Resolve a conflict between two versions
   * @param {string} path - The data path
   * @param {Object} localData - Local data with value, vectorClock
   * @param {Object} remoteData - Remote data with value, vectorClock
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
      case "vector-dominance":
      case "last-write-wins": // Map legacy strategy to vector-dominance
        return this._vectorDominance(localData, remoteData);

      case "first-write-wins":
        return this._firstWriteWins(localData, remoteData);

      case "merge-fields":
        return this._mergeFields(path, localData, remoteData);

      case "custom":
        return this._applyCustomResolver(path, localData, remoteData);

      default:
        // Fallback to vector dominance
        console.log(
          `Unknown strategy "${strategy}", falling back to vector-dominance`
        );
        return this._vectorDominance(localData, remoteData);
    }
  }

  /**
   * Handle conflict resolution when at least one side has a deletion
   * @private
   */
  _resolveWithDeletion(path, localData, remoteData) {
    // If both are deletions, use vector clock to decide
    if (localData.value === null && remoteData.value === null) {
      return this._vectorDominance(localData, remoteData);
    }

    // Convert to VectorClock instances
    const localClock = this._toVectorClock(localData.vectorClock);
    const remoteClock = this._toVectorClock(remoteData.vectorClock);

    // Get the relationship between the clocks
    const relation = localClock.dominanceRelation(remoteClock);

    // For deletion conflicts, we'll use vector clock dominance
    if (localData.value === null) {
      // Local is a deletion
      if (relation === "dominates" || relation === "concurrent") {
        console.log(
          `Deletion wins for ${path} (local deletion dominates or concurrent)`
        );
        return localData;
      } else {
        console.log(
          `Remote update wins over deletion for ${path} (remote dominates)`
        );
        return remoteData;
      }
    } else {
      // Remote is a deletion
      if (relation === "dominated" || relation === "concurrent") {
        console.log(
          `Deletion wins for ${path} (remote deletion dominates or concurrent)`
        );
        return remoteData;
      } else {
        console.log(
          `Local update wins over deletion for ${path} (local dominates)`
        );
        return localData;
      }
    }
  }

  /**
   * Vector dominance strategy - uses vector clocks to determine the winner
   * @private
   */
  _vectorDominance(localData, remoteData) {
    // Convert to VectorClock instances
    const localClock = this._toVectorClock(localData.vectorClock);
    const remoteClock = this._toVectorClock(remoteData.vectorClock);

    // Get the relationship between the clocks
    const relation = localClock.dominanceRelation(remoteClock);

    if (relation === "dominates" || relation === "identical") {
      return localData;
    } else if (relation === "dominated") {
      return remoteData;
    } else {
      // Concurrent changes, use deterministic tiebreaker
      const winner = localClock.deterministicWinner(
        remoteClock,
        localData.origin || "",
        remoteData.origin || ""
      );

      return winner === "this" ? localData : remoteData;
    }
  }

  /**
   * First-write-wins strategy - uses the same logic but prefers "dominated" vector clocks
   * @private
   */
  _firstWriteWins(localData, remoteData) {
    // Convert to VectorClock instances
    const localClock = this._toVectorClock(localData.vectorClock);
    const remoteClock = this._toVectorClock(remoteData.vectorClock);

    // Get the relationship between the clocks
    const relation = localClock.dominanceRelation(remoteClock);

    // For first-write-wins, we prefer the "dominated" vector clock
    // which represents the earlier write in causal history
    if (relation === "dominated" || relation === "identical") {
      return localData;
    } else if (relation === "dominates") {
      return remoteData;
    } else {
      // Concurrent changes, use deterministic tiebreaker
      // For first-write, we'll reverse the winner to prefer "smaller" clocks
      const winner = localClock.deterministicWinner(
        remoteClock,
        localData.origin || "",
        remoteData.origin || ""
      );

      return winner === "this" ? remoteData : localData;
    }
  }

  /**
   * Merge fields from both objects - improved implementation
   * For fields present in both, use vector clock dominance
   * @private
   */
  _mergeFields(path, localData, remoteData) {
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
      // If not objects, fall back to vector dominance
      console.log(
        `Cannot merge non-object values, falling back to vector-dominance`
      );
      return this._vectorDominance(localData, remoteData);
    }

    // Convert to VectorClock instances
    const localClock = this._toVectorClock(localData.vectorClock);
    const remoteClock = this._toVectorClock(remoteData.vectorClock);

    // Get the relationship between the clocks
    const relation = localClock.dominanceRelation(remoteClock);
    console.log(`Vector clock relation for ${path}: ${relation}`);

    // Merge the vector clocks
    const mergedClock = localClock.merge(remoteClock);

    // Create a new result object with merged vector clock
    const result = {
      value: {},
      vectorClock: mergedClock.toJSON(),
      origin: localData.origin, // Keep local origin for consistency
    };

    // Get all fields from both objects
    const allFields = new Set([
      ...Object.keys(localData.value),
      ...Object.keys(remoteData.value),
    ]);

    // For each field, decide which value to use
    for (const field of allFields) {
      const inLocal = field in localData.value;
      const inRemote = field in remoteData.value;

      if (inLocal && !inRemote) {
        // Field only in local, use it
        result.value[field] = localData.value[field];
      } else if (!inLocal && inRemote) {
        // Field only in remote, use it
        result.value[field] = remoteData.value[field];
      } else {
        // Field is in both, use the vector clock relationship to decide
        if (relation === "dominates" || relation === "identical") {
          // Local dominates or identical
          result.value[field] = localData.value[field];
        } else if (relation === "dominated") {
          // Remote dominates
          result.value[field] = remoteData.value[field];
        } else {
          // Concurrent updates
          // Use a deterministic approach based on the node IDs
          if (
            (localData.origin || "").localeCompare(remoteData.origin || "") > 0
          ) {
            result.value[field] = localData.value[field];
          } else {
            result.value[field] = remoteData.value[field];
          }
        }
      }
    }

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
        `No custom resolver found for ${path}, falling back to vector-dominance`
      );
      return this._vectorDominance(localData, remoteData);
    }

    try {
      return resolver(path, localData, remoteData);
    } catch (error) {
      console.error(`Error in custom resolver for ${path}:`, error);
      return this._vectorDominance(localData, remoteData);
    }
  }

  /**
   * Helper to convert any vector clock representation to a VectorClock instance
   * @private
   */
  _toVectorClock(clockData) {
    if (clockData instanceof VectorClock) {
      return clockData;
    }
    return new VectorClock(clockData || {});
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
