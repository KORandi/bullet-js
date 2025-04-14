/**
 * Conflict Resolver unit tests for vector clock-based implementation
 */

const { expect } = require("chai");
const ConflictResolver = require("../../src/sync/conflict-resolver");
const VectorClock = require("../../src/sync/vector-clock");

describe("ConflictResolver", () => {
  describe("Constructor", () => {
    it("should use default strategy when no options provided", () => {
      const resolver = new ConflictResolver();
      expect(resolver.defaultStrategy).to.equal("vector-dominance");
      expect(resolver.pathStrategies).to.deep.equal({});
      expect(resolver.customResolvers).to.deep.equal({});
    });

    it("should initialize with provided options", () => {
      const options = {
        defaultStrategy: "merge-fields",
        pathStrategies: { users: "merge-fields", settings: "first-write-wins" },
        customResolvers: { inventory: () => {} },
      };

      const resolver = new ConflictResolver(options);

      expect(resolver.defaultStrategy).to.equal("merge-fields");
      expect(resolver.pathStrategies).to.deep.equal(options.pathStrategies);
      expect(resolver.customResolvers).to.have.property("inventory");
    });
  });

  describe("getStrategyForPath()", () => {
    it("should return strategy for exact path match", () => {
      const resolver = new ConflictResolver({
        defaultStrategy: "vector-dominance",
        pathStrategies: { "users/user1": "merge-fields" },
      });

      expect(resolver.getStrategyForPath("users/user1")).to.equal(
        "merge-fields"
      );
    });

    it("should return strategy for parent path", () => {
      const resolver = new ConflictResolver({
        defaultStrategy: "vector-dominance",
        pathStrategies: { users: "merge-fields" },
      });

      expect(resolver.getStrategyForPath("users/user1")).to.equal(
        "merge-fields"
      );
    });

    it("should return default strategy when no match found", () => {
      const resolver = new ConflictResolver({
        defaultStrategy: "vector-dominance",
        pathStrategies: { users: "merge-fields" },
      });

      expect(resolver.getStrategyForPath("products/laptop")).to.equal(
        "vector-dominance"
      );
    });

    it("should match most specific path when multiple matches exist", () => {
      const resolver = new ConflictResolver({
        defaultStrategy: "vector-dominance",
        pathStrategies: {
          users: "merge-fields",
          "users/admin": "first-write-wins",
        },
      });

      expect(resolver.getStrategyForPath("users/admin/profile")).to.equal(
        "first-write-wins"
      );
    });
  });

  describe("resolve()", () => {
    // Helper to create test data with vector clocks
    const createTestData = (value, originId, vectorClock = {}) => {
      const vclock =
        vectorClock instanceof VectorClock
          ? vectorClock
          : new VectorClock(vectorClock);

      return {
        value,
        origin: originId || "node1",
        vectorClock: vclock.toJSON(),
      };
    };

    describe("vector-dominance strategy", () => {
      it("should select data with dominating vector clock", () => {
        const resolver = new ConflictResolver({
          defaultStrategy: "vector-dominance",
        });

        const localData = createTestData(
          { name: "Product A", price: 100 },
          "node1",
          { node1: 2, node2: 1 } // Local dominates
        );

        const remoteData = createTestData(
          { name: "Product A", price: 120 },
          "node2",
          { node1: 1, node2: 1 } // Remote is dominated
        );

        const result = resolver.resolve("products/item", localData, remoteData);
        expect(result.value).to.deep.equal({ name: "Product A", price: 100 });
      });

      it("should select remotely dominating data", () => {
        const resolver = new ConflictResolver({
          defaultStrategy: "vector-dominance",
        });

        const localData = createTestData(
          { name: "Product A", price: 100 },
          "node1",
          { node1: 1, node2: 0 } // Local is dominated
        );

        const remoteData = createTestData(
          { name: "Product A", price: 120 },
          "node2",
          { node1: 1, node2: 1 } // Remote dominates
        );

        const result = resolver.resolve("products/item", localData, remoteData);
        expect(result.value).to.deep.equal({ name: "Product A", price: 120 });
      });

      it("should choose deterministically with concurrent updates", () => {
        const resolver = new ConflictResolver({
          defaultStrategy: "vector-dominance",
        });

        const localData = createTestData(
          { name: "Product A", price: 100 },
          "node1",
          { node1: 2, node2: 0 } // Concurrent with remote
        );

        const remoteData = createTestData(
          { name: "Product A", price: 120 },
          "node2",
          { node1: 1, node2: 1 } // Concurrent with local
        );

        const result = resolver.resolve("products/item", localData, remoteData);

        // The result depends on the node ID comparison, so let's check both possible outcomes
        const nodeIdComparison = localData.origin.localeCompare(
          remoteData.origin
        );
        if (nodeIdComparison > 0) {
          // node1 comes after node2 alphabetically, so node1 wins
          expect(result.value).to.deep.equal({ name: "Product A", price: 100 });
        } else {
          // node2 comes after node1 alphabetically, so node2 wins
          expect(result.value).to.deep.equal({ name: "Product A", price: 120 });
        }
      });

      it("should select local data when vector clocks are identical", () => {
        const resolver = new ConflictResolver({
          defaultStrategy: "vector-dominance",
        });

        const localData = createTestData(
          { name: "Product A", price: 100 },
          "node1",
          { node1: 1, node2: 1 } // Identical clocks
        );

        const remoteData = createTestData(
          { name: "Product A", price: 120 },
          "node2",
          { node1: 1, node2: 1 } // Identical clocks
        );

        const result = resolver.resolve("products/item", localData, remoteData);
        expect(result.value).to.deep.equal({ name: "Product A", price: 100 });
      });
    });

    describe("first-write-wins strategy", () => {
      it("should select data with dominated vector clock", () => {
        const resolver = new ConflictResolver({
          defaultStrategy: "first-write-wins",
        });

        const localData = createTestData(
          { apiKey: "new-key" },
          "node1",
          { node1: 2, node2: 0 } // Newer update
        );

        const remoteData = createTestData(
          { apiKey: "original-key" },
          "node2",
          { node1: 1, node2: 0 } // Earlier update
        );

        const result = resolver.resolve(
          "settings/global",
          localData,
          remoteData
        );
        expect(result.value).to.deep.equal({ apiKey: "original-key" });
      });

      it("should handle concurrent updates in first-write-wins mode", () => {
        const resolver = new ConflictResolver({
          defaultStrategy: "first-write-wins",
        });

        const localData = createTestData(
          { apiKey: "local-key" },
          "node1",
          { node1: 1, node2: 0 } // Concurrent with remote
        );

        const remoteData = createTestData(
          { apiKey: "remote-key" },
          "node2",
          { node1: 0, node2: 1 } // Concurrent with local
        );

        const result = resolver.resolve(
          "settings/global",
          localData,
          remoteData
        );

        // For first-write-wins with concurrent updates, the tiebreaker should be reversed
        // So the result should be the opposite of the node ID comparison
        const nodeIdComparison = localData.origin.localeCompare(
          remoteData.origin
        );
        if (nodeIdComparison > 0) {
          // node1 comes after node2 alphabetically, so for first-write-wins, node2 wins
          expect(result.value).to.deep.equal({ apiKey: "remote-key" });
        } else {
          // node2 comes after node1 alphabetically, so for first-write-wins, node1 wins
          expect(result.value).to.deep.equal({ apiKey: "local-key" });
        }
      });
    });

    describe("merge-fields strategy", () => {
      it("should merge fields from both objects", () => {
        const resolver = new ConflictResolver({
          defaultStrategy: "merge-fields",
        });

        const localData = createTestData(
          { name: "Alice", email: "alice@example.com" },
          "node1",
          { node1: 1, node2: 0 }
        );

        const remoteData = createTestData(
          { name: "Alice", phone: "555-1234" },
          "node2",
          { node1: 0, node2: 1 }
        );

        const result = resolver.resolve("users/alice", localData, remoteData);

        expect(result.value).to.deep.equal({
          name: "Alice",
          email: "alice@example.com",
          phone: "555-1234",
        });
      });

      it("should use vector clock to decide overlapping fields", () => {
        const resolver = new ConflictResolver({
          defaultStrategy: "merge-fields",
        });

        // Create test data with vector clocks where local truly dominates
        const localData = createTestData(
          { name: "Alice (local)", role: "admin" },
          "node1",
          { node1: 2, node2: 1 } // Local dominates (node1 higher, node2 equal)
        );

        const remoteData = createTestData(
          { name: "Alice (remote)", department: "Engineering" },
          "node2",
          { node1: 1, node2: 1 } // Remote is dominated
        );

        const result = resolver.resolve("users/alice", localData, remoteData);

        // Name should come from local (dominant), other fields should be merged
        expect(result.value).to.deep.equal({
          name: "Alice (local)", // From local data (dominant)
          role: "admin", // From local data
          department: "Engineering", // From remote data
        });
      });

      // Another useful test to add - testing concurrent updates to the same field
      it("should handle concurrent updates to the same field consistently", () => {
        const resolver = new ConflictResolver({
          defaultStrategy: "merge-fields",
        });

        // Create test data with concurrent vector clocks
        const localData = createTestData(
          { name: "Alice (local)", role: "admin" },
          "node1",
          { node1: 2, node2: 0 } // Concurrent with remote
        );

        const remoteData = createTestData(
          { name: "Alice (remote)", department: "Engineering" },
          "node2",
          { node1: 1, node2: 1 } // Concurrent with local
        );

        const result = resolver.resolve("users/alice", localData, remoteData);

        // For name, the winner should be chosen deterministically
        // In this case, it depends on comparing node1 vs node2
        const expectedName =
          "node1".localeCompare("node2") > 0
            ? "Alice (local)"
            : "Alice (remote)";

        expect(result.value).to.deep.equal({
          name: expectedName, // Based on deterministic comparison
          role: "admin", // From local data
          department: "Engineering", // From remote data
        });
      });

      it("should fall back to vector-dominance for non-object values", () => {
        const resolver = new ConflictResolver({
          defaultStrategy: "merge-fields",
        });

        const localData = createTestData("Local value", "node1", {
          node1: 1,
          node2: 0,
        });

        const remoteData = createTestData(
          "Remote value",
          "node2",
          { node1: 0, node2: 2 } // Remote dominates
        );

        const result = resolver.resolve("simple/value", localData, remoteData);
        expect(result.value).to.equal("Remote value");
      });
    });

    describe("custom strategy", () => {
      it("should apply custom resolver function", () => {
        // Custom resolver that takes minimum stock value
        const customResolver = (path, localData, remoteData) => {
          // Convert to VectorClock instances
          const localClock =
            localData.vectorClock instanceof VectorClock
              ? localData.vectorClock
              : new VectorClock(localData.vectorClock);

          const remoteClock =
            remoteData.vectorClock instanceof VectorClock
              ? remoteData.vectorClock
              : new VectorClock(remoteData.vectorClock);

          if (
            localData.value &&
            remoteData.value &&
            typeof localData.value.stock === "number" &&
            typeof remoteData.value.stock === "number"
          ) {
            const relation = localClock.dominanceRelation(remoteClock);
            let result;

            // Determine the base object
            if (relation === "dominates" || relation === "identical") {
              result = { ...localData };
            } else if (relation === "dominated") {
              result = { ...remoteData };
            } else {
              // Concurrent, use deterministic tiebreaker
              const winner = localClock.deterministicWinner(
                remoteClock,
                localData.origin || "",
                remoteData.origin || ""
              );
              result = winner === "this" ? { ...localData } : { ...remoteData };
            }

            const minStock = Math.min(
              localData.value.stock,
              remoteData.value.stock
            );
            result.value = { ...result.value, stock: minStock };

            // Merge vector clocks
            result.vectorClock = localClock.merge(remoteClock).toJSON();

            return result;
          }

          // Fall back to vector dominance if not inventory items with stock
          return localClock.dominanceRelation(remoteClock) === "dominated"
            ? remoteData
            : localData;
        };

        const resolver = new ConflictResolver({
          defaultStrategy: "vector-dominance",
        });

        resolver.registerCustomResolver("inventory", customResolver);

        const localData = createTestData(
          { name: "Widget", stock: 100 },
          "node1",
          { node1: 1, node2: 0 }
        );

        const remoteData = createTestData(
          { name: "Widget", stock: 75, onSale: true },
          "node2",
          { node1: 0, node2: 2 } // Remote dominates
        );

        const result = resolver.resolve(
          "inventory/widget",
          localData,
          remoteData
        );

        // Should take most data from remote (dominant) but use minimum stock
        expect(result.value).to.deep.equal({
          name: "Widget",
          stock: 75, // Minimum of 75 and 100
          onSale: true,
        });
      });

      it("should fall back to vector-dominance if no custom resolver found", () => {
        const resolver = new ConflictResolver({
          defaultStrategy: "vector-dominance",
          pathStrategies: { products: "custom" },
        });

        const localData = createTestData({ name: "Product A" }, "node1", {
          node1: 1,
          node2: 0,
        });

        const remoteData = createTestData(
          { name: "Product B" },
          "node2",
          { node1: 0, node2: 2 } // Remote dominates
        );

        const result = resolver.resolve("products/item", localData, remoteData);
        expect(result.value).to.deep.equal({ name: "Product B" });
      });
    });

    describe("deletion handling", () => {
      it("should handle local deletion with dominating vector clock", () => {
        const resolver = new ConflictResolver();

        const localData = createTestData(
          null, // Local deletion
          "node1",
          { node1: 2, node2: 1 } // Local dominates
        );

        const remoteData = createTestData(
          { name: "Product" },
          "node2",
          { node1: 1, node2: 1 } // Remote is dominated
        );

        const result = resolver.resolve("products/item", localData, remoteData);
        expect(result.value).to.be.null;
      });

      it("should handle remote deletion with dominating vector clock", () => {
        const resolver = new ConflictResolver();

        const localData = createTestData(
          { name: "Product" },
          "node1",
          { node1: 1, node2: 0 } // Local is dominated
        );

        const remoteData = createTestData(
          null, // Remote deletion
          "node2",
          { node1: 1, node2: 1 } // Remote dominates
        );

        const result = resolver.resolve("products/item", localData, remoteData);
        expect(result.value).to.be.null;
      });

      it("should handle concurrent deletion vs update scenario", () => {
        const resolver = new ConflictResolver();

        const localData = createTestData(
          { name: "Product", updated: true },
          "node1",
          { node1: 2, node2: 0 } // Concurrent with remote
        );

        const remoteData = createTestData(
          null, // Remote deletion
          "node2",
          { node1: 1, node2: 1 } // Concurrent with local
        );

        // In concurrent deletion vs update scenarios, deletion should win
        const result = resolver.resolve("products/item", localData, remoteData);
        expect(result.value).to.be.null;
      });

      it("should handle both sides deleted", () => {
        const resolver = new ConflictResolver();

        const localData = createTestData(null, "node1", { node1: 1, node2: 0 });

        const remoteData = createTestData(null, "node2", {
          node1: 0,
          node2: 1,
        });

        const result = resolver.resolve("products/item", localData, remoteData);
        expect(result.value).to.be.null;
      });
    });
  });

  describe("setStrategy() and registerCustomResolver()", () => {
    it("should set strategy for a path", () => {
      const resolver = new ConflictResolver();

      resolver.setStrategy("users", "merge-fields");
      resolver.setStrategy("settings", "first-write-wins");

      expect(resolver.getStrategyForPath("users/user1")).to.equal(
        "merge-fields"
      );
      expect(resolver.getStrategyForPath("settings/theme")).to.equal(
        "first-write-wins"
      );
    });

    it("should register a custom resolver for a path", () => {
      const resolver = new ConflictResolver();
      const customFn = () => {};

      resolver.registerCustomResolver("inventory", customFn);

      expect(resolver.customResolvers.inventory).to.equal(customFn);
      expect(resolver.pathStrategies.inventory).to.equal("custom");
    });
  });
});
