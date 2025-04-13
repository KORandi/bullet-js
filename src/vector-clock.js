/**
 * VectorClock implementation for P2P Server
 * Enhanced to ensure proper synchronization across nodes
 */

class VectorClock {
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
   */
  clone() {
    return new VectorClock({ ...this.clock });
  }

  /**
   * Merge this vector clock with another
   * Takes the maximum value for each node ID
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
   * Returns:
   *  -1 if this clock is causally BEFORE other clock
   *   0 if this clock is CONCURRENT with other clock
   *   1 if this clock is causally AFTER other clock
   *   2 if this clock is IDENTICAL to other clock
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
   */
  isBefore(otherClock) {
    return this.compare(otherClock) === -1;
  }

  /**
   * Check if this clock is causally after another
   */
  isAfter(otherClock) {
    return this.compare(otherClock) === 1;
  }

  /**
   * Check if this clock is concurrent with another (conflict)
   */
  isConcurrent(otherClock) {
    return this.compare(otherClock) === 0;
  }

  /**
   * Check if this clock is identical to another
   */
  isIdentical(otherClock) {
    return this.compare(otherClock) === 2;
  }

  /**
   * Convert to JSON-serializable object
   */
  toJSON() {
    return { ...this.clock };
  }

  /**
   * Create from JSON object
   */
  static fromJSON(json) {
    return new VectorClock(json);
  }

  /**
   * Get a string representation of the vector clock
   * Useful for debugging
   */
  toString() {
    const entries = Object.entries(this.clock)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${key.substring(0, 8)}:${value}`)
      .join(", ");

    return `[${entries}]`;
  }
}

module.exports = VectorClock;
