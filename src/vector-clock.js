/**
 * VectorClock implementation for P2P Server
 * Used for tracking causal relationships between updates
 * This enhanced version ensures proper clock synchronization
 */

class VectorClock {
  constructor(clockData = {}) {
    this.clock = { ...clockData };
  }

  /**
   * Increment the counter for a specific node
   */
  increment(nodeId) {
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
    const mergedClock = this.clone();

    // For each entry in the other clock
    for (const [nodeId, count] of Object.entries(otherClock.clock)) {
      mergedClock.clock[nodeId] = Math.max(
        mergedClock.clock[nodeId] || 0,
        count
      );
    }

    return mergedClock;
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
    let lessThan = false;
    let greaterThan = false;
    let totalEntries = 0;
    let equalEntries = 0;

    // Check all entries in this clock
    for (const [nodeId, count] of Object.entries(this.clock)) {
      const otherCount = otherClock.clock[nodeId] || 0;
      totalEntries++;

      if (count < otherCount) {
        lessThan = true;
      } else if (count > otherCount) {
        greaterThan = true;
      } else {
        equalEntries++;
      }
    }

    // Check for entries in other clock that aren't in this one
    for (const [nodeId, count] of Object.entries(otherClock.clock)) {
      if (!(nodeId in this.clock)) {
        totalEntries++;
        if (count > 0) {
          lessThan = true;
        } else {
          equalEntries++;
        }
      }
    }

    // If all entries are equal, the clocks are identical
    if (equalEntries === totalEntries) {
      return 2; // IDENTICAL
    }

    // Determine the relationship
    if (lessThan && !greaterThan) {
      return -1; // This clock is causally BEFORE other clock
    } else if (greaterThan && !lessThan) {
      return 1; // This clock is causally AFTER other clock
    } else {
      return 0; // Clocks are CONCURRENT (conflict)
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
}

module.exports = VectorClock;
