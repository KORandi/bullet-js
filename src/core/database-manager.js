/**
 * Database Manager for P2P Server
 * Provides persistent storage using LevelDB
 */

const { Level } = require("level");
const path = require("path");

class DatabaseManager {
  /**
   * Create a new DatabaseManager
   * @param {string} dbPath - Path to the database
   */
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new Level(path.resolve(dbPath), {
      valueEncoding: "json",
    });
    console.log(`Database initialized at: ${path.resolve(dbPath)}`);
  }

  /**
   * Store data at the specified path
   * @param {string} path - The data path
   * @param {any} data - The data to store
   * @returns {Promise<boolean>} - Success indicator
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
   * @param {string} path - The data path
   * @returns {Promise<any>} - The stored data or null if not found
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
   * @param {string} path - The data path
   * @returns {Promise<boolean>} - Success indicator
   */
  async del(path) {
    try {
      if (await this.db.get(path)) {
        await this.db.del(path);
        return true;
      } else {
        const err = new Error("NotFoundError");
        err.type = "NotFoundError";
        throw err;
      }
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
   * @param {string} prefix - The path prefix to scan
   * @param {Object} options - Scan options
   * @param {number} [options.limit] - Maximum number of results
   * @returns {Promise<Array>} - Matching entries
   */
  async scan(prefix, options = {}) {
    const limit = options.limit || -1;
    const results = [];

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
   * @returns {Promise<boolean>} - Success indicator
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
