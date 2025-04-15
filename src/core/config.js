const { randomBytes } = require("crypto");
/**
 * Configuration module for P2P Server
 * Provides default configuration and validation
 */

/**
 * Get default configuration values
 * @returns {Object} Default configuration
 */
function getDefaultConfig() {
  return {
    // Server config
    port: 3000,
    dbPath: "./db",
    peers: [],
    serverID: randomBytes(8).toString("hex"),

    // Sync configuration
    sync: {
      antiEntropyInterval: null, // null or time in ms
      maxMessageAge: 300000, // 5 minutes
      maxVersions: 10,
    },

    // Conflict resolution configuration
    conflict: {
      defaultStrategy: "vector-dominance",
      pathStrategies: {},
      customResolvers: {},
    },
  };
}

/**
 * Validate configuration values
 * @param {Object} config - Configuration to validate
 * @throws {Error} If configuration is invalid
 */
function validateConfig(config) {
  // Validate port
  if (config.port !== undefined) {
    if (
      !Number.isInteger(config.port) ||
      config.port < 1 ||
      config.port > 65535
    ) {
      throw new Error(
        `Invalid port: ${config.port}. Must be an integer between 1 and 65535.`
      );
    }
  }

  // Validate dbPath
  if (config.dbPath !== undefined && typeof config.dbPath !== "string") {
    throw new Error(`Invalid dbPath: ${config.dbPath}. Must be a string.`);
  }

  // Validate peers
  if (config.peers !== undefined) {
    if (!Array.isArray(config.peers)) {
      throw new Error(`Invalid peers: ${config.peers}. Must be an array.`);
    }

    for (const peer of config.peers) {
      if (typeof peer !== "string") {
        throw new Error(`Invalid peer URL: ${peer}. Must be a string.`);
      }

      try {
        new URL(peer);
      } catch (error) {
        throw new Error(`Invalid peer URL format: ${peer}. ${error.message}`);
      }
    }
  }

  // Validate sync config if provided
  if (config.sync) {
    // Anti-entropy interval
    if (config.sync.antiEntropyInterval !== undefined) {
      // Allow null to disable automatic anti-entropy
      if (config.sync.antiEntropyInterval === null) {
        // Valid case - null disables automatic anti-entropy
      } else if (
        !Number.isInteger(config.sync.antiEntropyInterval) ||
        config.sync.antiEntropyInterval < 1000
      ) {
        throw new Error(
          `Invalid antiEntropyInterval: ${config.sync.antiEntropyInterval}. Must be an integer >= 1000ms or null to disable.`
        );
      }
    }

    // Max message age
    if (config.sync.maxMessageAge !== undefined) {
      if (
        !Number.isInteger(config.sync.maxMessageAge) ||
        config.sync.maxMessageAge < 1000
      ) {
        throw new Error(
          `Invalid maxMessageAge: ${config.sync.maxMessageAge}. Must be an integer >= 1000ms.`
        );
      }
    }

    // Max versions
    if (config.sync.maxVersions !== undefined) {
      if (
        !Number.isInteger(config.sync.maxVersions) ||
        config.sync.maxVersions < 1
      ) {
        throw new Error(
          `Invalid maxVersions: ${config.sync.maxVersions}. Must be an integer >= 1.`
        );
      }
    }
  }

  // Validate conflict resolution config if provided
  if (config.conflict) {
    // Default strategy
    if (config.conflict.defaultStrategy !== undefined) {
      const validStrategies = [
        "vector-dominance", // New strategy name
        "last-write-wins", // Keep for backward compatibility
        "first-write-wins",
        "merge-fields",
        "custom",
      ];
      if (!validStrategies.includes(config.conflict.defaultStrategy)) {
        throw new Error(
          `Invalid defaultStrategy: ${config.conflict.defaultStrategy}. Must be one of: ${validStrategies.join(", ")}`
        );
      }
    }

    // Path strategies
    if (config.conflict.pathStrategies !== undefined) {
      if (
        typeof config.conflict.pathStrategies !== "object" ||
        config.conflict.pathStrategies === null
      ) {
        throw new Error("pathStrategies must be an object.");
      }

      const validStrategies = [
        "vector-dominance", // New strategy name
        "last-write-wins", // Keep for backward compatibility
        "first-write-wins",
        "merge-fields",
        "custom",
      ];

      for (const [path, strategy] of Object.entries(
        config.conflict.pathStrategies
      )) {
        if (!validStrategies.includes(strategy)) {
          throw new Error(
            `Invalid strategy for path ${path}: ${strategy}. Must be one of: ${validStrategies.join(
              ", "
            )}`
          );
        }
      }
    }

    // Custom resolvers
    if (config.conflict.customResolvers !== undefined) {
      if (
        typeof config.conflict.customResolvers !== "object" ||
        config.conflict.customResolvers === null
      ) {
        throw new Error("customResolvers must be an object.");
      }

      for (const [path, resolver] of Object.entries(
        config.conflict.customResolvers
      )) {
        if (typeof resolver !== "function") {
          throw new Error(
            `Custom resolver for path ${path} must be a function.`
          );
        }
      }
    }
  }
}

module.exports = {
  getDefaultConfig,
  validateConfig,
};
