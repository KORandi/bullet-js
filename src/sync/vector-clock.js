/**
 * VectorClock - Tracks causality between events in distributed systems
 * Enables tracking of "happened-before" relationships and conflict detection
 */

class VectorClock {
  /**
   * Create a new VectorClock
   * @param {Object} clockData - Initial clock values
   */
  constructor(clockData = {}) {
    this.clock = {};

    // Initialize with clean data
    if (clockData && typeof clockData === "object") {
      Object.entries(clockData).forEach(([key, value]) => {
        if (typeof value === "number" && !isNaN(value) && value >= 0) {
          this.clock[key] = value;
        } else if (value !== undefined) {
          // If value is defined but invalid, log a warning
          console.warn(
            `Invalid vector clock value for ${key}: ${value}, using 0 instead`
          );
          this.clock[key] = 0;
        }
      });
    }
  }

  /**
   * Increment the counter for a specific node
   * @param {string} nodeId - ID of the node
   * @returns {VectorClock} - This vector clock (for chaining)
   */
  increment(nodeId) {
    if (!nodeId || typeof nodeId !== "string") {
      console.warn("Invalid nodeId passed to increment:", nodeId);
      return this;
    }

    this.clock[nodeId] = (this.clock[nodeId] || 0) + 1;
    return this;
  }

  /**
   * Create a copy of this vector clock
   * @returns {VectorClock} - New vector clock with same values
   */
  clone() {
    return new VectorClock({ ...this.clock });
  }

  /**
   * Merge this vector clock with another
   * Takes the maximum value for each node ID
   * @param {VectorClock|Object} otherClock - Clock to merge with
   * @returns {VectorClock} - New merged vector clock
   */
  merge(otherClock) {
    // Handle different input types
    let otherClockObj;

    if (otherClock instanceof VectorClock) {
      otherClockObj = otherClock.clock;
    } else if (otherClock && typeof otherClock === "object") {
      otherClockObj = otherClock;
    } else {
      console.warn("Invalid vector clock passed to merge:", otherClock);
      return this.clone();
    }

    // Create a new VectorClock for the result
    const result = new VectorClock();

    // Get all unique node IDs from both clocks
    const allNodeIds = new Set([
      ...Object.keys(this.clock),
      ...Object.keys(otherClockObj),
    ]);

    // For each node ID, take the maximum value
    for (const nodeId of allNodeIds) {
      const selfValue = this.clock[nodeId] || 0;
      const otherValue =
        typeof otherClockObj[nodeId] === "number" &&
        !isNaN(otherClockObj[nodeId])
          ? otherClockObj[nodeId]
          : 0;

      result.clock[nodeId] = Math.max(selfValue, otherValue);
    }

    return result;
  }

  /**
   * Compare two vector clocks to determine their relationship
   * @param {VectorClock|Object} otherClock - Clock to compare with
   * @returns {number} Comparison result:
   *  -1: this clock is causally BEFORE other clock
   *   0: this clock is CONCURRENT with other clock
   *   1: this clock is causally AFTER other clock
   *   2: this clock is IDENTICAL to other clock
   */
  compare(otherClock) {
    // Handle different input types
    let otherClockObj;

    if (otherClock instanceof VectorClock) {
      otherClockObj = otherClock.clock;
    } else if (otherClock && typeof otherClock === "object") {
      otherClockObj = otherClock;
    } else {
      console.warn("Invalid vector clock passed to compare:", otherClock);
      return 0; // Default to concurrent for invalid input
    }

    // Get all unique node IDs from both clocks
    const allNodeIds = new Set([
      ...Object.keys(this.clock),
      ...Object.keys(otherClockObj),
    ]);

    let lessThan = false;
    let greaterThan = false;
    let identical = true;

    // Compare each node ID's counter
    for (const nodeId of allNodeIds) {
      const selfValue = this.clock[nodeId] || 0;
      const otherValue =
        typeof otherClockObj[nodeId] === "number" &&
        !isNaN(otherClockObj[nodeId])
          ? otherClockObj[nodeId]
          : 0;

      if (selfValue < otherValue) {
        lessThan = true;
        identical = false;
      } else if (selfValue > otherValue) {
        greaterThan = true;
        identical = false;
      }

      // Early exit if we've determined it's concurrent
      if (lessThan && greaterThan) {
        return 0; // CONCURRENT
      }
    }

    if (identical) {
      return 2; // IDENTICAL
    } else if (lessThan && !greaterThan) {
      return -1; // BEFORE
    } else if (greaterThan && !lessThan) {
      return 1; // AFTER
    } else {
      return 0; // CONCURRENT
    }
  }

  /**
   * Check if this clock is causally before another
   * @param {VectorClock|Object} otherClock - Clock to compare with
   * @returns {boolean} True if this clock is before the other
   */
  isBefore(otherClock) {
    return this.compare(otherClock) === -1;
  }

  /**
   * Check if this clock is causally after another
   * @param {VectorClock|Object} otherClock - Clock to compare with
   * @returns {boolean} True if this clock is after the other
   */
  isAfter(otherClock) {
    return this.compare(otherClock) === 1;
  }

  /**
   * Check if this clock is concurrent with another (conflict)
   * @param {VectorClock|Object} otherClock - Clock to compare with
   * @returns {boolean} True if this clock is concurrent with the other
   */
  isConcurrent(otherClock) {
    return this.compare(otherClock) === 0;
  }

  /**
   * Check if this clock is identical to another
   * @param {VectorClock|Object} otherClock - Clock to compare with
   * @returns {boolean} True if this clock is identical to the other
   */
  isIdentical(otherClock) {
    return this.compare(otherClock) === 2;
  }

  /**
   * Convert to JSON-serializable object
   * @returns {Object} Clock as plain object
   */
  toJSON() {
    return { ...this.clock };
  }

  /**
   * Create from JSON object
   * @param {Object} json - Clock data as plain object
   * @returns {VectorClock} New vector clock instance
   */
  static fromJSON(json) {
    return new VectorClock(json);
  }

  /**
   * Get a string representation of the vector clock
   * Useful for debugging
   * @returns {string} String representation
   */
  toString() {
    const entries = Object.entries(this.clock)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${key.substring(0, 8)}:${value}`)
      .join(", ");

    return `[${entries}]`;
  }

  /**
   * Compare vector clocks to see if one dominates the other
   * @param {VectorClock|Object} otherClock - Clock to compare with
   * @returns {string} Relationship: 'dominates', 'dominated', 'concurrent', or 'identical'
   */
  dominanceRelation(otherClock) {
    const comparison = this.compare(otherClock);

    switch (comparison) {
      case 1:
        return "dominates"; // this > other
      case -1:
        return "dominated"; // this < other
      case 0:
        return "concurrent"; // this || other (concurrent)
      case 2:
        return "identical"; // this == other
      default:
        return "unknown";
    }
  }

  /**
   * Get a deterministic winner between concurrent vector clocks
   * @param {VectorClock|Object} otherClock - Clock to compare with
   * @param {string} thisId - This node's identifier
   * @param {string} otherId - Other node's identifier
   * @returns {string} Winner: 'this', 'other', or 'identical'
   */
  deterministicWinner(otherClock, thisId, otherId) {
    const relation = this.dominanceRelation(otherClock);

    if (relation === "dominates") return "this";
    if (relation === "dominated") return "other";
    if (relation === "identical") return "identical";

    // If concurrent, use a deterministic tiebreaker (e.g., comparing node IDs)
    return thisId.localeCompare(otherId) > 0 ? "this" : "other";
  }

  /**
   * Compute a hash-based value that is consistent across the network
   * (Alternative tiebreaker method for concurrent updates)
   */
  hashCode() {
    // Sort entries for deterministic ordering
    const entries = Object.entries(this.clock).sort(([keyA], [keyB]) =>
      keyA.localeCompare(keyB)
    );

    // Create a string representation
    const str = entries.map(([key, value]) => `${key}:${value}`).join(",");

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }
}

module.exports = VectorClock;
