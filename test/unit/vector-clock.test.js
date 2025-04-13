/**
 * Vector Clock unit tests
 */

const { expect } = require("chai");
const VectorClock = require("../../src/sync/vector-clock");

describe("VectorClock", () => {
  describe("Constructor", () => {
    it("should create an empty vector clock when no data is provided", () => {
      const clock = new VectorClock();
      expect(clock.clock).to.deep.equal({});
    });

    it("should initialize with provided data", () => {
      const data = { node1: 1, node2: 2 };
      const clock = new VectorClock(data);
      expect(clock.clock).to.deep.equal(data);
    });

    it("should filter out invalid values", () => {
      const data = { node1: 1, node2: -1, node3: "invalid", node4: undefined };
      const clock = new VectorClock(data);
      expect(clock.clock).to.deep.equal({ node1: 1, node2: 0, node3: 0 });
    });
  });

  describe("increment()", () => {
    it("should increment the counter for a node", () => {
      const clock = new VectorClock();
      clock.increment("node1");
      expect(clock.clock.node1).to.equal(1);
    });

    it("should increment an existing counter", () => {
      const clock = new VectorClock({ node1: 5 });
      clock.increment("node1");
      expect(clock.clock.node1).to.equal(6);
    });

    it("should return the clock for chaining", () => {
      const clock = new VectorClock();
      const result = clock.increment("node1");
      expect(result).to.equal(clock);
    });

    it("should handle invalid node IDs gracefully", () => {
      const clock = new VectorClock();
      clock.increment(null);
      clock.increment(123);
      expect(clock.clock).to.deep.equal({});
    });
  });

  describe("clone()", () => {
    it("should create a new clock with the same values", () => {
      const original = new VectorClock({ node1: 1, node2: 2 });
      const clone = original.clone();

      expect(clone).to.not.equal(original);
      expect(clone.clock).to.deep.equal(original.clock);
      expect(clone.clock).to.deep.equal({ node1: 1, node2: 2 });
    });

    it("should create a completely independent copy", () => {
      const original = new VectorClock({ node1: 1 });
      const clone = original.clone();

      original.increment("node1");
      original.increment("node2");

      expect(clone.clock).to.deep.equal({ node1: 1 });
      expect(original.clock).to.deep.equal({ node1: 2, node2: 1 });
    });
  });

  describe("merge()", () => {
    it("should take the maximum value for each node ID", () => {
      const clock1 = new VectorClock({ node1: 1, node2: 5, node3: 3 });
      const clock2 = new VectorClock({ node1: 2, node2: 3, node4: 4 });

      const merged = clock1.merge(clock2);

      expect(merged.clock).to.deep.equal({
        node1: 2,
        node2: 5,
        node3: 3,
        node4: 4,
      });
    });

    it("should handle merging with plain objects", () => {
      const clock = new VectorClock({ node1: 1, node2: 2 });
      const obj = { node1: 3, node3: 4 };

      const merged = clock.merge(obj);

      expect(merged.clock).to.deep.equal({
        node1: 3,
        node2: 2,
        node3: 4,
      });
    });

    it("should handle invalid input gracefully", () => {
      const clock = new VectorClock({ node1: 1 });
      const result1 = clock.merge(null);
      const result2 = clock.merge("invalid");

      expect(result1.clock).to.deep.equal({ node1: 1 });
      expect(result2.clock).to.deep.equal({ node1: 1 });
    });
  });

  describe("compare()", () => {
    it("should return 2 for identical clocks", () => {
      const clock1 = new VectorClock({ node1: 1, node2: 2 });
      const clock2 = new VectorClock({ node1: 1, node2: 2 });

      expect(clock1.compare(clock2)).to.equal(2);
    });

    it("should return -1 when this clock is causally before other", () => {
      const clock1 = new VectorClock({ node1: 1, node2: 2 });
      const clock2 = new VectorClock({ node1: 2, node2: 2 });

      expect(clock1.compare(clock2)).to.equal(-1);
    });

    it("should return 1 when this clock is causally after other", () => {
      const clock1 = new VectorClock({ node1: 2, node2: 3 });
      const clock2 = new VectorClock({ node1: 1, node2: 3 });

      expect(clock1.compare(clock2)).to.equal(1);
    });

    it("should return 0 for concurrent clocks", () => {
      const clock1 = new VectorClock({ node1: 3, node2: 1 });
      const clock2 = new VectorClock({ node1: 2, node2: 2 });

      expect(clock1.compare(clock2)).to.equal(0);
    });

    it("should handle missing node IDs correctly", () => {
      const clock1 = new VectorClock({ node1: 1 });
      const clock2 = new VectorClock({ node2: 1 });

      expect(clock1.compare(clock2)).to.equal(0); // Concurrent
    });

    it("should compare with plain objects", () => {
      const clock = new VectorClock({ node1: 2, node2: 2 });
      const obj = { node1: 1, node2: 2 };

      expect(clock.compare(obj)).to.equal(1);
    });
  });

  describe("helper methods", () => {
    it("should determine if clock is before another", () => {
      const clock1 = new VectorClock({ node1: 1, node2: 2 });
      const clock2 = new VectorClock({ node1: 2, node2: 2 });

      expect(clock1.isBefore(clock2)).to.be.true;
      expect(clock2.isBefore(clock1)).to.be.false;
    });

    it("should determine if clock is after another", () => {
      const clock1 = new VectorClock({ node1: 2, node2: 2 });
      const clock2 = new VectorClock({ node1: 1, node2: 2 });

      expect(clock1.isAfter(clock2)).to.be.true;
      expect(clock2.isAfter(clock1)).to.be.false;
    });

    it("should determine if clock is concurrent with another", () => {
      const clock1 = new VectorClock({ node1: 3, node2: 1 });
      const clock2 = new VectorClock({ node1: 2, node2: 2 });

      expect(clock1.isConcurrent(clock2)).to.be.true;
      expect(clock2.isConcurrent(clock1)).to.be.true;
    });

    it("should determine if clock is identical to another", () => {
      const clock1 = new VectorClock({ node1: 1, node2: 2 });
      const clock2 = new VectorClock({ node1: 1, node2: 2 });

      expect(clock1.isIdentical(clock2)).to.be.true;
      expect(clock2.isIdentical(clock1)).to.be.true;
    });
  });

  describe("serialization", () => {
    it("should convert to JSON-serializable object", () => {
      const clock = new VectorClock({ node1: 1, node2: 2 });
      const json = clock.toJSON();

      expect(json).to.deep.equal({ node1: 1, node2: 2 });
    });

    it("should create from JSON object", () => {
      const json = { node1: 1, node2: 2 };
      const clock = VectorClock.fromJSON(json);

      expect(clock).to.be.instanceof(VectorClock);
      expect(clock.clock).to.deep.equal(json);
    });

    it("should provide a meaningful string representation", () => {
      const clock = new VectorClock({ node1: 1, node2: 2 });
      const str = clock.toString();

      expect(str).to.include("node1:1");
      expect(str).to.include("node2:2");
    });
  });
});
