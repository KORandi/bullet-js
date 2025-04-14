/**
 * Additional Unit Tests for P2P Server Components
 */

const { expect } = require("chai");
const VectorClock = require("../../src/sync/vector-clock");
const ConflictResolver = require("../../src/sync/conflict-resolver");
const DatabaseManager = require("../../src/core/database-manager");
const {
  isValidPath,
  normalizePath,
  isValidValue,
  isValidPeerUrl,
} = require("../../src/utils/validation");
const path = require("path");
const fs = require("fs");
const rimraf = require("rimraf");

// Test directory for database tests
const TEST_DB_DIR = "./test/temp/unit-test-db";

describe("VectorClock - Additional Tests", () => {
  describe("Edge Cases", () => {
    it("should handle empty clocks correctly during comparison", () => {
      const emptyClockA = new VectorClock();
      const emptyClockB = new VectorClock();
      const nonEmptyClock = new VectorClock({ node1: 1 });

      // Two empty clocks should be identical
      expect(emptyClockA.compare(emptyClockB)).to.equal(2);
      expect(emptyClockA.isIdentical(emptyClockB)).to.be.true;

      // Empty clock should be before non-empty clock
      expect(emptyClockA.compare(nonEmptyClock)).to.equal(-1);
      expect(emptyClockA.isBefore(nonEmptyClock)).to.be.true;

      // Non-empty clock should be after empty clock
      expect(nonEmptyClock.compare(emptyClockA)).to.equal(1);
      expect(nonEmptyClock.isAfter(emptyClockA)).to.be.true;
    });

    it("should merge clocks with overlapping and non-overlapping entries", () => {
      const clockA = new VectorClock({ node1: 3, node2: 1, node3: 5 });
      const clockB = new VectorClock({ node2: 2, node3: 3, node4: 7 });

      const merged = clockA.merge(clockB);

      // Should take max value for each entry
      expect(merged.clock).to.deep.equal({
        node1: 3,
        node2: 2,
        node3: 5,
        node4: 7,
      });
    });

    it("should increment counter values correctly after multiple increments", () => {
      const clock = new VectorClock();

      // Multiple increments to same node
      clock.increment("node1").increment("node1").increment("node1");
      expect(clock.clock["node1"]).to.equal(3);

      // Multiple increments to different nodes
      clock.increment("node2").increment("node3").increment("node2");

      expect(clock.clock["node2"]).to.equal(2);
      expect(clock.clock["node3"]).to.equal(1);
    });

    it("should correctly identify non-trivial causality and concurrency examples", () => {
      // Test more complex distributed scenarios

      // Scenario: A → B → C (linear chain of events)
      const clockA = new VectorClock({ node1: 1 });
      const clockB = new VectorClock({ node1: 1, node2: 1 });
      const clockC = new VectorClock({ node1: 1, node2: 1, node3: 1 });

      expect(clockA.isBefore(clockB)).to.be.true;
      expect(clockB.isBefore(clockC)).to.be.true;
      expect(clockA.isBefore(clockC)).to.be.true;

      // Scenario: Concurrent events X and Y, both causally after A
      const clockX = new VectorClock({ node1: 1, node2: 1 });
      const clockY = new VectorClock({ node1: 1, node3: 1 });

      expect(clockA.isBefore(clockX)).to.be.true;
      expect(clockA.isBefore(clockY)).to.be.true;
      expect(clockX.isConcurrent(clockY)).to.be.true;

      // Complex scenario: Merge concurrent events
      const mergedXY = clockX.merge(clockY);
      expect(mergedXY.clock).to.deep.equal({ node1: 1, node2: 1, node3: 1 });
      expect(clockX.isBefore(mergedXY)).to.be.true;
      expect(clockY.isBefore(mergedXY)).to.be.true;
    });
  });

  describe("Serialization and Deserialization", () => {
    it("should correctly serialize and deserialize complex clocks", () => {
      const original = new VectorClock({
        node1: 5,
        node2: 3,
        node3: 0,
        node4: 10,
      });

      const json = original.toJSON();
      const deserialized = VectorClock.fromJSON(json);

      expect(deserialized).to.be.instanceof(VectorClock);
      expect(deserialized.clock).to.deep.equal(original.clock);
      expect(deserialized.isIdentical(original)).to.be.true;
    });

    it("should handle circular structure scenarios safely", () => {
      const clock = new VectorClock({ node1: 1 });

      // Create an object with circular reference
      const circular = { name: "test" };
      circular.self = circular;

      try {
        // This should not throw despite circular reference
        const str = clock.toString();
        expect(str).to.include("node1:1");
      } catch (e) {
        // We should not get here
        expect.fail(
          "Should not throw on toString() with nearby circular references"
        );
      }
    });
  });
});

describe("ConflictResolver - Additional Tests", () => {
  describe("Advanced Conflict Resolution", () => {
    it("should handle array values correctly in merge-fields strategy", () => {
      const resolver = new ConflictResolver({
        defaultStrategy: "merge-fields",
      });

      const localData = {
        value: { name: "Product", tags: ["red", "large"] },
        timestamp: 1000,
        vectorClock: new VectorClock({ node1: 1 }),
      };

      const remoteData = {
        value: { name: "Product", tags: ["blue", "small"], price: 99 },
        timestamp: 2000,
        vectorClock: new VectorClock({ node2: 1 }),
      };

      // Since arrays are not objects in typeof check, they should be handled as scalar fields
      const resolved = resolver.resolve("products/item", localData, remoteData);

      // Remote is newer, so its tags array should win
      expect(resolved.value.tags).to.deep.equal(["blue", "small"]);
      // Fields from both should be present
      expect(resolved.value.name).to.equal("Product");
      expect(resolved.value.price).to.equal(99);
    });

    it("should properly handle nested objects in merge-fields strategy", () => {
      const resolver = new ConflictResolver({
        defaultStrategy: "merge-fields",
      });

      const localData = {
        value: {
          name: "User",
          address: {
            street: "123 Main St",
            city: "Oldtown",
          },
        },
        timestamp: 1000,
        vectorClock: new VectorClock({ node1: 1 }),
      };

      const remoteData = {
        value: {
          name: "User",
          address: {
            city: "Newtown",
            zip: "12345",
          },
          email: "user@example.com",
        },
        timestamp: 2000,
        vectorClock: new VectorClock({ node2: 1 }),
      };

      const resolved = resolver.resolve("users/user1", localData, remoteData);

      // Since the address object is treated as a scalar field (not merged recursively)
      // and remote is newer, it should use the remote address object
      expect(resolved.value.address).to.deep.equal({
        city: "Newtown",
        zip: "12345",
      });

      // Other fields should be merged
      expect(resolved.value.name).to.equal("User");
      expect(resolved.value.email).to.equal("user@example.com");
    });

    it("should handle null and undefined fields correctly", () => {
      const resolver = new ConflictResolver({
        defaultStrategy: "merge-fields",
      });

      const localData = {
        value: { name: "Item", quantity: 0, owner: null, tags: undefined },
        timestamp: 1000,
        vectorClock: new VectorClock({ node1: 1 }),
      };

      const remoteData = {
        value: {
          name: "Updated Item",
          quantity: null,
          owner: "User",
          price: 99,
        },
        timestamp: 2000,
        vectorClock: new VectorClock({ node2: 1 }),
      };

      const resolved = resolver.resolve("items/item1", localData, remoteData);

      // Check merged result
      expect(resolved.value.name).to.equal("Updated Item"); // Remote is newer
      expect(resolved.value.quantity).to.be.null; // Remote null should win since it's newer
      expect(resolved.value.owner).to.equal("User"); // Remote non-null should win
      expect(resolved.value.price).to.equal(99); // New field from remote
      expect(resolved.value.tags).to.be.undefined; // undefined field from local should exist
    });
  });

  describe("Custom Resolvers", () => {
    it("should apply numeric reduction custom resolver", () => {
      const resolver = new ConflictResolver({
        defaultStrategy: "last-write-wins",
      });

      // Register a custom resolver that takes the sum of numeric values
      resolver.registerCustomResolver(
        "stats",
        (path, localData, remoteData) => {
          if (
            typeof localData.value === "number" &&
            typeof remoteData.value === "number"
          ) {
            return {
              value: localData.value + remoteData.value,
              timestamp: Math.max(localData.timestamp, remoteData.timestamp),
              vectorClock: localData.vectorClock.merge(remoteData.vectorClock),
            };
          }

          // Default to last-write-wins for non-numeric values
          return localData.timestamp >= remoteData.timestamp
            ? localData
            : remoteData;
        }
      );

      const localData = {
        value: 5,
        timestamp: 1000,
        vectorClock: new VectorClock({ node1: 1 }),
      };

      const remoteData = {
        value: 7,
        timestamp: 2000,
        vectorClock: new VectorClock({ node2: 1 }),
      };

      const resolved = resolver.resolve("stats/counter", localData, remoteData);

      expect(resolved.value).to.equal(12); // Sum of values
    });

    it("should handle errors in custom resolvers gracefully", () => {
      const resolver = new ConflictResolver({
        defaultStrategy: "last-write-wins",
      });

      // Register a custom resolver that throws an error
      resolver.registerCustomResolver("buggy", () => {
        throw new Error("Custom resolver error");
      });

      const localData = {
        value: { name: "Local" },
        timestamp: 1000,
        vectorClock: new VectorClock({ node1: 1 }),
      };

      const remoteData = {
        value: { name: "Remote" },
        timestamp: 2000,
        vectorClock: new VectorClock({ node2: 1 }),
      };

      // Should fallback to last-write-wins
      const resolved = resolver.resolve("buggy/item", localData, remoteData);

      expect(resolved.value.name).to.equal("Remote"); // Last-write-wins fallback
    });
  });

  describe("getStrategyForPath() Path Matching", () => {
    it("should match the most specific path prefix", () => {
      const resolver = new ConflictResolver({
        defaultStrategy: "last-write-wins",
        pathStrategies: {
          users: "merge-fields",
          "users/admin": "first-write-wins",
          "users/admin/settings": "custom",
        },
      });

      // Test various path patterns
      expect(resolver.getStrategyForPath("users/user1")).to.equal(
        "merge-fields"
      );
      expect(resolver.getStrategyForPath("users/admin")).to.equal(
        "first-write-wins"
      );
      expect(resolver.getStrategyForPath("users/admin/profile")).to.equal(
        "first-write-wins"
      );
      expect(resolver.getStrategyForPath("users/admin/settings")).to.equal(
        "custom"
      );
      expect(
        resolver.getStrategyForPath("users/admin/settings/theme")
      ).to.equal("custom");
      expect(resolver.getStrategyForPath("products/item1")).to.equal(
        "last-write-wins"
      );
    });

    it("should handle complex path patterns and exact matches", () => {
      const resolver = new ConflictResolver({
        defaultStrategy: "last-write-wins",
        pathStrategies: {
          "data/nested/specific": "first-write-wins",
          "data/nested": "merge-fields",
          data: "custom",
        },
      });

      // Exact match should win
      expect(resolver.getStrategyForPath("data/nested/specific")).to.equal(
        "first-write-wins"
      );
      // Next specific match
      expect(resolver.getStrategyForPath("data/nested/other")).to.equal(
        "merge-fields"
      );
      // General match
      expect(resolver.getStrategyForPath("data/other")).to.equal("custom");
      // Default
      expect(resolver.getStrategyForPath("other")).to.equal("last-write-wins");
    });
  });
});

describe("DatabaseManager - Unit Tests", () => {
  // Setup test directory
  beforeEach(() => {
    if (fs.existsSync(TEST_DB_DIR)) {
      rimraf.sync(TEST_DB_DIR);
    }
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  // Clean up after tests
  afterEach(() => {
    if (fs.existsSync(TEST_DB_DIR)) {
      rimraf.sync(TEST_DB_DIR);
    }
  });

  describe("Basic Operations", () => {
    it("should put and get data correctly", async () => {
      const db = new DatabaseManager(TEST_DB_DIR);

      const testValue = { test: "value", number: 42 };
      await db.put("test/key", testValue);

      const retrievedValue = await db.get("test/key");
      expect(retrievedValue).to.deep.equal(testValue);

      await db.close();
    });

    it("should return undefined for non-existent keys", async () => {
      const db = new DatabaseManager(TEST_DB_DIR);

      const value = await db.get("does/not/exist");
      expect(value).to.be.undefined;

      await db.close();
    });

    it("should correctly delete existing keys", async () => {
      const db = new DatabaseManager(TEST_DB_DIR);

      // Add some data
      await db.put("test/delete", "delete me");

      // Verify it exists
      const beforeDelete = await db.get("test/delete");
      expect(beforeDelete).to.equal("delete me");

      // Delete it
      await db.del("test/delete");

      // Verify it's gone
      const afterDelete = await db.get("test/delete");
      expect(afterDelete).to.be.undefined;

      await db.close();
    });

    it("should handle deleting non-existent keys", async () => {
      const db = new DatabaseManager(TEST_DB_DIR);

      // Attempt to delete non-existent key should not throw
      try {
        const result = await db.del("does/not/exist");
        expect(result).to.be.false; // Should indicate nothing was deleted
      } catch (err) {
        console.error(err);
        expect.fail("Should not throw on deleting non-existent key");
      }

      await db.close();
    });
  });

  describe("Scanning Operations", () => {
    it("should scan by prefix and return matching entries", async () => {
      const db = new DatabaseManager(TEST_DB_DIR);

      // Add data with different prefixes
      await db.put("category1/item1", { name: "Item 1", category: 1 });
      await db.put("category1/item2", { name: "Item 2", category: 1 });
      await db.put("category2/item1", { name: "Item A", category: 2 });
      await db.put("other/something", { name: "Other thing" });

      // Scan for category1
      const category1Items = await db.scan("category1");

      // Should have 2 items
      expect(category1Items).to.have.lengthOf(2);

      // Each item should have path and value
      expect(category1Items[0].path).to.equal("category1/item1");
      expect(category1Items[0].name).to.equal("Item 1");
      expect(category1Items[1].path).to.equal("category1/item2");

      // Scan for category2
      const category2Items = await db.scan("category2");
      expect(category2Items).to.have.lengthOf(1);
      expect(category2Items[0].name).to.equal("Item A");

      await db.close();
    });

    it("should respect scan limit option", async () => {
      const db = new DatabaseManager(TEST_DB_DIR);

      // Add many items
      for (let i = 0; i < 10; i++) {
        await db.put(`many/item${i}`, { index: i });
      }

      // Scan with limit
      const limitedItems = await db.scan("many", { limit: 5 });

      // Should respect the limit
      expect(limitedItems).to.have.lengthOf(5);

      // Full scan should get all items
      const allItems = await db.scan("many");
      expect(allItems).to.have.lengthOf(10);

      await db.close();
    });

    it("should handle scanning non-existent prefixes gracefully", async () => {
      const db = new DatabaseManager(TEST_DB_DIR);

      // Add some data first
      await db.put("exists/key", "value");

      // Scan for non-existent prefix
      const results = await db.scan("does-not-exist");

      // Should return empty array, not throw
      expect(results).to.be.an("array");
      expect(results).to.have.lengthOf(0);

      await db.close();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle special characters in keys", async () => {
      const db = new DatabaseManager(TEST_DB_DIR);

      // Keys with special characters
      const specialKeys = [
        "path/with space",
        "path/with-dash",
        "path/with.dot",
        "path/with_underscore",
        "path/with+plus",
        "path/with@at",
      ];

      // Store value for each special key
      for (const key of specialKeys) {
        await db.put(key, { special: true, key });
      }

      // Verify each key can be retrieved
      for (const key of specialKeys) {
        const value = await db.get(key);
        expect(value).to.not.be.null;
        expect(value.key).to.equal(key);
      }

      // Scan should find all keys
      const results = await db.scan("path");
      expect(results).to.have.lengthOf(specialKeys.length);

      await db.close();
    });

    it("should handle closing the database multiple times", async () => {
      const db = new DatabaseManager(TEST_DB_DIR);

      // Close once
      await db.close();

      // Second close should not throw
      try {
        await db.close();
      } catch (err) {
        expect.fail("Second close should not throw");
      }
    });

    it("should throw appropriate errors for operations after close", async () => {
      const db = new DatabaseManager(TEST_DB_DIR);

      // First, add some data
      await db.put("test/key", "value");

      // Close the database
      await db.close();

      // Operations after close should throw
      try {
        await db.get("test/key");
        expect.fail("Operation after close should throw");
      } catch (err) {
        // This is expected
        expect(err).to.exist;
      }

      try {
        await db.put("test/new", "new value");
        expect.fail("Operation after close should throw");
      } catch (err) {
        // This is expected
        expect(err).to.exist;
      }
    });
  });
});

describe("Validation Utilities - Unit Tests", () => {
  describe("Path Validation", () => {
    it("should correctly validate valid paths", () => {
      const validPaths = [
        "simple",
        "simple/path",
        "nested/deeper/path",
        "with-dash",
        "with_underscore",
        "with.dot",
        "123numeric",
        "mixed/123/path",
        "very/very/very/very/very/very/deep/path",
      ];

      for (const path of validPaths) {
        expect(isValidPath(path)).to.be.true;
      }
    });

    it("should correctly invalidate invalid paths", () => {
      const invalidPaths = [
        " ", // Just whitespace
        "path/with//slash", // Double slash
        "path/with/", // Trailing slash
        "path with space", // Spaces
        "path#with#hash", // Invalid character
        "path?with?question", // Invalid character
        "path*withasterisk", // Invalid character
        "path<withbracket", // Invalid character
        null, // Null
        undefined, // Undefined
      ];

      for (const path of invalidPaths) {
        expect(isValidPath(path)).to.be.false;
      }
    });

    it("should correctly normalize paths", () => {
      const normalizationCases = [
        { input: "simple", expected: "simple" },
        { input: "with/slash", expected: "with/slash" },
        { input: "/leading/slash", expected: "leading/slash" },
        { input: "trailing/slash/", expected: "trailing/slash" },
        { input: "  whitespace  ", expected: "whitespace" },
        { input: "/both/slashes/", expected: "both/slashes" },
        { input: "///multiple/slashes///", expected: "multiple/slashes" },
      ];

      for (const { input, expected } of normalizationCases) {
        expect(normalizePath(input)).to.equal(expected);
      }
    });
  });

  describe("Value Validation", () => {
    it("should correctly validate serializable values", () => {
      const validValues = [
        null, // Null is allowed
        "string", // Strings
        123, // Numbers
        true, // Booleans
        { object: true }, // Objects
        ["array", "items"], // Arrays
        { nested: { object: true } }, // Nested objects
        [{ complex: "array" }], // Complex arrays
      ];

      for (const value of validValues) {
        expect(isValidValue(value)).to.be.true;
      }
    });

    it("should correctly invalidate non-serializable values", () => {
      // Create an object with circular reference
      const circular = { name: "circular" };
      circular.self = circular;

      const invalidValues = [
        circular, // Circular reference
        undefined, // Undefined itself
        Symbol("symbol"), // Symbols
      ];

      for (const value of invalidValues) {
        console.log(value);
        expect(isValidValue(value)).to.be.false;
      }
    });
  });

  describe("URL Validation", () => {
    it("should correctly validate valid peer URLs", () => {
      const validUrls = [
        "http://localhost",
        "http://localhost:3000",
        "http://127.0.0.1:8080",
        "https://example.com",
        "https://subdomain.example.com/path",
        "http://localhost:3000/api",
      ];

      for (const url of validUrls) {
        expect(isValidPeerUrl(url)).to.be.true;
      }
    });

    it("should correctly invalidate invalid peer URLs", () => {
      const invalidUrls = [
        "", // Empty string
        "localhost", // Missing protocol
        "localhost:3000", // Missing protocol
        "ftp://example.com", // Wrong protocol
        "ws://example.com", // Wrong protocol
        "not a url", // Not a URL
        null, // Null
        undefined, // Undefined
      ];

      for (const url of invalidUrls) {
        expect(isValidPeerUrl(url)).to.be.false;
      }
    });
  });
});
