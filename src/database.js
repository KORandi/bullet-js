/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Database Manager for P2P Server
 * Compatible with level@9.0.0
 */

const { Level } = require("level");
const path = require("path");

class DatabaseManager {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new Level(path.resolve(dbPath), {
      valueEncoding: "json",
    });
    console.log(`Database initialized at: ${path.resolve(dbPath)}`);
  }

  /**
   * Store data at the specified path
   */
  async put(path, data) {
    try {
      await this.db.put(path, data);
      return true;
    } catch (error) {
      console.error(`Database error writing to ${path}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve data from the specified path
   */
  async get(path) {
    try {
      const data = await this.db.get(path);
      return data;
    } catch (error) {
      if (error.code === "LEVEL_NOT_FOUND" || error.type === "NotFoundError") {
        return null;
      }
      console.error(`Database error reading from ${path}:`, error);
      throw error;
    }
  }

  /**
   * Delete data at the specified path
   */
  async del(path) {
    try {
      await this.db.del(path);
      return true;
    } catch (error) {
      if (error.code === "LEVEL_NOT_FOUND" || error.type === "NotFoundError") {
        return false;
      }
      console.error(`Database error deleting from ${path}:`, error);
      throw error;
    }
  }

  /**
   * Scan database entries by prefix
   */
  async scan(prefix, options = {}) {
    const limit = options.limit || -1;
    const results = [];

    // In Level 9, we use the iterator() method
    try {
      // Use range to filter by prefix
      const iterator = this.db.iterator({
        gt: prefix,
        lt: prefix + "\uffff",
        limit: limit > 0 ? limit : undefined,
      });

      // Iterate through all matching entries
      for await (const [key, value] of iterator) {
        results.push({
          path: key,
          ...value,
        });
      }

      return results;
    } catch (error) {
      console.error(`Database error scanning prefix ${prefix}:`, error);
      throw error;
    }
  }

  /**
   * Close the database
   */
  async close() {
    try {
      await this.db.close();
      return true;
    } catch (error) {
      console.error("Database error while closing:", error);
      throw error;
    }
  }
}

module.exports = DatabaseManager;
