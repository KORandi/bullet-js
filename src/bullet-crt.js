class BulletCRT {
  /**
   * Create a new conflict resolver with vector clock support
   * @param {Object} bullet - The Bullet instance
   */
  constructor(bullet) {
    this.bullet = bullet;
    this.vectorClocks = new Map();

    // Default comparison function
    this.compare = (incoming, existing) => {
      if (incoming === existing) return 0;
      if (incoming < existing) return -1;
      return 1;
    };
  }

  /**
   * Set a custom comparison function for values
   * @param {Function} compareFunction - Custom comparison function
   * @returns {BulletCRT} This instance for chaining
   */
  setCompare(compareFunction) {
    this.compare = compareFunction;
    return this;
  }

  /**
   * Create a new vector clock for a key
   * @param {string} key - Key to identify the data
   * @returns {Object} New vector clock
   */
  createVectorClock(key) {
    const clock = { [this.bullet.id]: 1 };
    this.vectorClocks.set(key, clock);
    return clock;
  }

  /**
   * Get the current vector clock for a key
   * @param {string} key - Key to identify the data
   * @returns {Object} Current vector clock (or a new one if none exists)
   */
  getVectorClock(key) {
    if (!this.vectorClocks.has(key)) {
      return this.createVectorClock(key);
    }
    return this.vectorClocks.get(key);
  }

  /**
   * Increment the vector clock for the current node
   * @param {string} key - Key to identify the data
   * @returns {Object} Updated vector clock
   */
  incrementVectorClock(key) {
    const clock = this.getVectorClock(key);
    clock[this.bullet.id] = (clock[this.bullet.id] || 0) + 1;
    return clock;
  }

  /**
   * Compare two vector clocks to determine their relationship
   * @param {Object} clock1 - First vector clock
   * @param {Object} clock2 - Second vector clock
   * @returns {number} -1 if clock1 < clock2, 0 if concurrent, 1 if clock1 > clock2
   */
  compareVectorClocks(clock1, clock2) {
    if (!clock1) return -1;
    if (!clock2) return 1;

    let clock1DominatesAny = false;
    let clock2DominatesAny = false;

    const allNodes = new Set([...Object.keys(clock1), ...Object.keys(clock2)]);

    for (const node of allNodes) {
      const value1 = clock1[node] || 0;
      const value2 = clock2[node] || 0;

      if (value1 > value2) {
        clock1DominatesAny = true;
      } else if (value2 > value1) {
        clock2DominatesAny = true;
      }

      if (clock1DominatesAny && clock2DominatesAny) {
        return 0;
      }
    }

    if (clock1DominatesAny) return 1;
    if (clock2DominatesAny) return -1;
    return 0;
  }

  /**
   * Merge two vector clocks, taking the highest version from each node
   * @param {Object} clock1 - First vector clock
   * @param {Object} clock2 - Second vector clock
   * @returns {Object} Merged vector clock
   */
  mergeVectorClocks(clock1, clock2) {
    if (!clock1) return { ...clock2 };
    if (!clock2) return { ...clock1 };

    const result = { ...clock1 };

    for (const [nodeId, value] of Object.entries(clock2)) {
      result[nodeId] = Math.max(result[nodeId] || 0, value);
    }

    return result;
  }

  /**
   * Deep merge two objects, resolving conflicts with the latest value
   * @param {*} incomingValue - Incoming data value
   * @param {*} currentValue - Current data value
   * @returns {*} Merged value
   */
  mergeValues(incomingValue, currentValue) {
    // If values aren't both objects, or one is null, or they're arrays - use incoming
    if (
      typeof incomingValue !== "object" ||
      typeof currentValue !== "object" ||
      incomingValue === null ||
      currentValue === null ||
      Array.isArray(incomingValue) ||
      Array.isArray(currentValue)
    ) {
      // Use the compare function to determine which value wins
      return this.compare(incomingValue, currentValue) >= 0
        ? incomingValue
        : currentValue;
    }

    // Deep merge objects
    const result = { ...currentValue };

    // Add or update properties from incoming object
    for (const [key, value] of Object.entries(incomingValue)) {
      if (key in result) {
        // Recursively merge nested objects
        result[key] = this.mergeValues(value, result[key]);
      } else {
        // Add new properties
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Resolve conflicts for a key using vector clocks
   * @param {string} key - Key that identifies the data
   * @param {Object} incomingVectorClock - Vector clock of incoming data
   * @param {Object} currentVectorClock - Vector clock of current data
   * @param {*} incomingValue - Incoming data value
   * @param {*} currentValue - Current data value
   * @returns {Object} Resolution decision with merged vector clock
   */
  resolve(
    key,
    incomingVectorClock,
    currentVectorClock,
    incomingValue,
    currentValue
  ) {
    // No current state, accept incoming
    if (!currentVectorClock) {
      const clock = this.incrementVectorClock(key);
      return {
        defer: false,
        historical: false,
        converge: true,
        incoming: true,
        current: false,
        concurrent: false,
        vectorClock: clock,
        reason: "no current state",
        value: incomingValue,
      };
    }

    const comparison = this.compareVectorClocks(
      incomingVectorClock,
      currentVectorClock
    );

    const mergedClock = this.mergeVectorClocks(
      incomingVectorClock,
      currentVectorClock
    );

    this.vectorClocks.set(key, mergedClock);

    // Identical clocks, compare values
    if (
      comparison === 0 &&
      JSON.stringify(incomingVectorClock) === JSON.stringify(currentVectorClock)
    ) {
      const valueComparison = this.compare(incomingValue, currentValue);

      // Identical values
      if (valueComparison === 0) {
        return {
          defer: false,
          historical: false,
          converge: true,
          incoming: false,
          current: false,
          concurrent: false,
          vectorClock: mergedClock,
          reason: "identical clocks and values",
          value: currentValue,
        };
      }

      // Different values but identical clocks, use value comparison
      return {
        defer: false,
        historical: false,
        converge: true,
        incoming: valueComparison > 0,
        current: valueComparison < 0,
        concurrent: false,
        vectorClock: mergedClock,
        reason: "identical clocks, decided by value comparison",
        value: valueComparison > 0 ? incomingValue : currentValue,
      };
    }

    // Incoming clock dominates
    if (comparison > 0) {
      return {
        defer: false,
        historical: false,
        converge: true,
        incoming: true,
        current: false,
        concurrent: false,
        vectorClock: mergedClock,
        reason: "incoming vector clock dominates",
        value: incomingValue,
      };
    }

    // Current clock dominates
    if (comparison < 0) {
      return {
        defer: false,
        historical: true,
        converge: true,
        incoming: false,
        current: true,
        concurrent: false,
        vectorClock: mergedClock,
        reason: "current vector clock dominates (incoming is historical)",
        value: currentValue,
      };
    }

    // Concurrent modifications - merge the objects
    const mergedValue = this.mergeValues(incomingValue, currentValue);

    return {
      defer: false,
      historical: false,
      converge: true,
      incoming: false,
      current: false,
      concurrent: true,
      vectorClock: mergedClock,
      reason: "concurrent modifications, merged objects",
      value: mergedValue,
    };
  }

  /**
   * Create a simple update with the vector clock for the specified key
   * @param {string} key - Key for the data being updated
   * @param {*} value - New value
   * @returns {Object} Update object with value and vector clock
   */
  createUpdate(key, value) {
    const clock = this.incrementVectorClock(key);
    return {
      value,
      vectorClock: { ...clock },
    };
  }

  /**
   * Process an update for a key, resolving any conflicts
   * @param {string} key - Key for the data being updated
   * @param {*} incomingValue - Incoming value
   * @param {Object} incomingClock - Incoming vector clock
   * @param {*} currentValue - Current value (if any)
   * @param {Object} currentClock - Current vector clock (if any)
   * @returns {Object} Result with decision and final state
   */
  processUpdate(key, incomingValue, incomingClock, currentValue, currentClock) {
    const decision = this.resolve(
      key,
      incomingClock,
      currentClock,
      incomingValue,
      currentValue
    );

    return {
      value: decision.value,
      vectorClock: decision.vectorClock,
      decision,
    };
  }

  /**
   * Process an update for a given path
   * This method is designed to be called directly from Bullet setData
   *
   * @param {string} path - Data path
   * @param {*} incomingData - Incoming data
   * @param {boolean} isFromNetwork - Whether the update is from network
   * @returns {Object} Result with value, vector clock, and metadata
   */
  handleUpdate(path, incomingData, isFromNetwork = false) {
    // Get current data and its vector clock (if it exists)
    const currentData = this.bullet._getData(path);
    const currentMeta = this.bullet.meta[path] || {};
    const currentClock = currentMeta.vectorClock;

    // Extract or create incoming vector clock
    let incomingClock;
    let dataToStore = incomingData;

    if (
      isFromNetwork &&
      incomingData &&
      typeof incomingData === "object" &&
      incomingData.__vectorClock
    ) {
      // Data from network contains vector clock information
      incomingClock = incomingData.__vectorClock;

      // Remove vector clock from the data before storing
      if (Array.isArray(incomingData)) {
        dataToStore = [...incomingData];
        delete dataToStore.__vectorClock;
      } else {
        const { __vectorClock, ...cleanData } = incomingData;
        dataToStore = cleanData;
      }
    } else {
      // Local update, create new vector clock or increment existing
      incomingClock = this.incrementVectorClock(path);
    }

    // Resolve any conflicts
    const result = this.resolve(
      path,
      incomingClock,
      currentClock,
      dataToStore,
      currentData
    );

    // For network broadcasting, prepare data with vector clock
    let broadcastData = result.value;
    if (typeof broadcastData === "object" && broadcastData !== null) {
      broadcastData = Array.isArray(broadcastData)
        ? [...broadcastData, { __vectorClock: result.vectorClock }]
        : { ...broadcastData, __vectorClock: result.vectorClock };
    }

    return {
      value: result.value, // The value to store
      vectorClock: result.vectorClock, // Vector clock to store in metadata
      broadcastData: broadcastData, // Data to broadcast (with vector clock)
      decision: result, // Full decision for logging/debugging
      doUpdate: result.incoming || !currentClock || result.concurrent, // Whether to update or not
    };
  }

  /**
   * Convert vector clocks to a human-readable format for debugging
   * @param {Object} clock - Vector clock to format
   * @returns {string} Formatted clock string
   */
  formatClock(clock) {
    if (!clock) return "null";
    return Object.entries(clock)
      .map(([node, value]) => `${node}:${value}`)
      .join(", ");
  }
}

module.exports = BulletCRT;
