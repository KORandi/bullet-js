class BulletMiddleware {
  constructor(bullet) {
    this.bullet = bullet;

    this.middleware = {
      get: [],
      put: [],
      afterGet: [],
      afterPut: [],
      delete: [],
      afterDelete: [],
    };

    this.eventListeners = {};

    this._setupHooks();
  }

  /**
   * Setup hooks into bullet methods
   * @private
   */
  _setupHooks() {
    const originalGetData = this.bullet._getData.bind(this.bullet);
    const originalSetData = this.bullet.setData.bind(this.bullet);

    this.bullet._getData = (path) => {
      let modifiedPath = path;

      for (const middleware of this.middleware.get) {
        try {
          const result = middleware(modifiedPath);
          if (typeof result === "string") {
            modifiedPath = result;
          }
        } catch (error) {
          console.error(`Error in 'get' middleware:`, error);
          this._emitEvent("error", {
            operation: "get",
            path: modifiedPath,
            error,
          });
        }
      }

      let data = originalGetData(modifiedPath);

      for (const middleware of this.middleware.afterGet) {
        try {
          const result = middleware(modifiedPath, data);
          if (result !== undefined) {
            data = result;
          }
        } catch (error) {
          console.error(`Error in 'afterGet' middleware:`, error);
          this._emitEvent("error", {
            operation: "afterGet",
            path: modifiedPath,
            data,
            error,
          });
        }
      }

      this._emitEvent("read", { path: modifiedPath, data });

      return data;
    };

    this.bullet.setData = (path, data, broadcast = true) => {
      let modifiedPath = path;
      let modifiedData = data;
      let shouldContinue = true;

      for (const middleware of this.middleware.put) {
        try {
          const result = middleware(modifiedPath, modifiedData, timestamp);

          if (result === false) {
            shouldContinue = false;
            break;
          } else if (result !== undefined && result !== null) {
            if (
              typeof result === "object" &&
              "path" in result &&
              "data" in result
            ) {
              modifiedPath = result.path;
              modifiedData = result.data;
            } else {
              modifiedData = result;
            }
          }
        } catch (error) {
          console.error(`Error in 'put' middleware:`, error);
          this._emitEvent("error", {
            operation: "put",
            path: modifiedPath,
            data: modifiedData,
            error,
          });
          shouldContinue = false;
          break;
        }
      }

      if (shouldContinue) {
        const oldData = originalGetData(modifiedPath);

        originalSetData(modifiedPath, modifiedData, timestamp, broadcast);

        for (const middleware of this.middleware.afterPut) {
          try {
            middleware(modifiedPath, modifiedData, oldData, timestamp);
          } catch (error) {
            console.error(`Error in 'afterPut' middleware:`, error);
            this._emitEvent("error", {
              operation: "afterPut",
              path: modifiedPath,
              data: modifiedData,
              oldData,
              error,
            });
          }
        }

        this._emitEvent("write", {
          path: modifiedPath,
          data: modifiedData,
          oldData,
          timestamp,
        });
      }

      return shouldContinue;
    };

    if (!this.bullet.BulletNode.prototype.delete) {
      this.bullet.BulletNode.prototype.delete = function () {
        let shouldContinue = true;
        const path = this.path;

        for (const middleware of this.bullet.middleware.middleware.delete) {
          try {
            const result = middleware(path);
            if (result === false) {
              shouldContinue = false;
              break;
            }
          } catch (error) {
            console.error(`Error in 'delete' middleware:`, error);
            this.bullet.middleware._emitEvent("error", {
              operation: "delete",
              path,
              error,
            });
            shouldContinue = false;
            break;
          }
        }

        if (shouldContinue) {
          const oldData = this.bullet._getData(path);

          this.bullet.setData(path, null);

          for (const middleware of this.bullet.middleware.middleware
            .afterDelete) {
            try {
              middleware(path, oldData);
            } catch (error) {
              console.error(`Error in 'afterDelete' middleware:`, error);
              this.bullet.middleware._emitEvent("error", {
                operation: "afterDelete",
                path,
                oldData,
                error,
              });
            }
          }

          this.bullet.middleware._emitEvent("delete", { path, oldData });
        }

        return this;
      };
    }

    this.bullet.middleware = this;
  }

  /**
   * Add middleware to a specific operation
   * @param {string} operation - Operation to hook into ('get', 'put', 'afterGet', 'afterPut', 'delete', 'afterDelete')
   * @param {Function} middleware - Middleware function
   * @return {BulletMiddleware} - This instance for chaining
   * @public
   */
  use(operation, middleware) {
    if (!this.middleware[operation]) {
      throw new Error(`Unknown operation: ${operation}`);
    }

    if (typeof middleware !== "function") {
      throw new Error("Middleware must be a function");
    }

    this.middleware[operation].push(middleware);
    return this;
  }

  /**
   * Add middleware for get operations
   * @param {Function} middleware - Middleware function(path)
   * @return {BulletMiddleware} - This instance for chaining
   * @public
   */
  onGet(middleware) {
    return this.use("get", middleware);
  }

  /**
   * Add middleware for after get operations
   * @param {Function} middleware - Middleware function(path, data)
   * @return {BulletMiddleware} - This instance for chaining
   * @public
   */
  afterGet(middleware) {
    return this.use("afterGet", middleware);
  }

  /**
   * Add middleware for put operations
   * @param {Function} middleware - Middleware function(path, data, timestamp)
   * @return {BulletMiddleware} - This instance for chaining
   * @public
   */
  beforePut(middleware) {
    return this.use("put", middleware);
  }

  /**
   * Add middleware for after put operations
   * @param {Function} middleware - Middleware function(path, newData, oldData, timestamp)
   * @return {BulletMiddleware} - This instance for chaining
   * @public
   */
  afterPut(middleware) {
    return this.use("afterPut", middleware);
  }

  /**
   * Add middleware for delete operations
   * @param {Function} middleware - Middleware function(path)
   * @return {BulletMiddleware} - This instance for chaining
   * @public
   */
  beforeDelete(middleware) {
    return this.use("delete", middleware);
  }

  /**
   * Add middleware for after delete operations
   * @param {Function} middleware - Middleware function(path, oldData)
   * @return {BulletMiddleware} - This instance for chaining
   * @public
   */
  afterDelete(middleware) {
    return this.use("afterDelete", middleware);
  }

  /**
   * Register an event listener
   * @param {string} event - Event name
   * @param {Function} listener - Event listener function
   * @return {BulletMiddleware} - This instance for chaining
   * @public
   */
  on(event, listener) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }

    this.eventListeners[event].push(listener);
    return this;
  }

  /**
   * Emit an event
   * @param {string} event - Event name
   * @param {Object} data - Event data
   * @private
   */
  _emitEvent(event, data) {
    if (this.eventListeners[event]) {
      for (const listener of this.eventListeners[event]) {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in event listener for '${event}':`, error);
        }
      }
    }

    if (this.eventListeners["all"]) {
      for (const listener of this.eventListeners["all"]) {
        try {
          listener(event, data);
        } catch (error) {
          console.error(`Error in 'all' event listener:`, error);
        }
      }
    }
  }

  /**
   * Create and register a path rewrite rule
   * @param {RegExp|string} pattern - Pattern to match
   * @param {string|Function} replacement - Replacement string or function
   * @return {BulletMiddleware} - This instance for chaining
   * @public
   */
  rewritePath(pattern, replacement) {
    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;

    this.onGet((path) => {
      if (typeof path === "string") {
        if (typeof replacement === "function") {
          return path.replace(regex, (...args) => replacement(...args));
        } else {
          return path.replace(regex, replacement);
        }
      }
      return path;
    });

    return this;
  }

  /**
   * Create and register a data transformation
   * @param {string|RegExp} pathPattern - Path pattern to match
   * @param {Function} transformFn - Transformation function
   * @param {string} direction - 'read', 'write', or 'both'
   * @return {BulletMiddleware} - This instance for chaining
   * @public
   */
  transform(pathPattern, transformFn, direction = "both") {
    const matcher =
      typeof pathPattern === "string"
        ? (path) => path === pathPattern || path.startsWith(pathPattern + "/")
        : (path) => pathPattern.test(path);

    if (direction === "read" || direction === "both") {
      this.afterGet((path, data) => {
        if (matcher(path)) {
          return transformFn(data, path, "read");
        }
        return data;
      });
    }

    if (direction === "write" || direction === "both") {
      this.beforePut((path, data) => {
        if (matcher(path)) {
          return transformFn(data, path, "write");
        }
        return data;
      });
    }

    return this;
  }

  /**
   * Create and register a field encryption handler
   * @param {string|RegExp} pathPattern - Path pattern to match
   * @param {Array<string>} fields - Fields to encrypt
   * @param {Function} encryptFn - Encryption function
   * @param {Function} decryptFn - Decryption function
   * @return {BulletMiddleware} - This instance for chaining
   * @public
   */
  encryptFields(pathPattern, fields, encryptFn, decryptFn) {
    const matcher =
      typeof pathPattern === "string"
        ? (path) => path === pathPattern || path.startsWith(pathPattern + "/")
        : (path) => pathPattern.test(path);

    this.beforePut((path, data) => {
      if (!matcher(path) || typeof data !== "object" || data === null) {
        return data;
      }

      const result = { ...data };

      for (const field of fields) {
        if (
          field in result &&
          result[field] !== undefined &&
          result[field] !== null
        ) {
          result[field] = encryptFn(result[field]);
        }
      }

      return result;
    });

    this.afterGet((path, data) => {
      if (!matcher(path) || typeof data !== "object" || data === null) {
        return data;
      }

      const result = { ...data };

      for (const field of fields) {
        if (
          field in result &&
          result[field] !== undefined &&
          result[field] !== null
        ) {
          try {
            result[field] = decryptFn(result[field]);
          } catch (error) {
            console.error(`Error decrypting field ${field}:`, error);
          }
        }
      }

      return result;
    });

    return this;
  }

  /**
   * Create and register an access control handler
   * @param {string|RegExp} pathPattern - Path pattern to match
   * @param {Function} checkFn - Access check function
   * @param {Array<string>} operations - Operations to check ('read', 'write', 'delete')
   * @return {BulletMiddleware} - This instance for chaining
   * @public
   */
  accessControl(
    pathPattern,
    checkFn,
    operations = ["read", "write", "delete"]
  ) {
    const matcher =
      typeof pathPattern === "string"
        ? (path) => path === pathPattern || path.startsWith(pathPattern + "/")
        : (path) => pathPattern.test(path);

    if (operations.includes("read")) {
      this.onGet((path) => {
        if (matcher(path)) {
          const allowed = checkFn(path, "read");
          if (!allowed) {
            throw new Error(`Access denied for reading path: ${path}`);
          }
        }
        return path;
      });
    }

    if (operations.includes("write")) {
      this.beforePut((path, data) => {
        if (matcher(path)) {
          const allowed = checkFn(path, "write", data);
          if (!allowed) {
            throw new Error(`Access denied for writing to path: ${path}`);
          }
        }
        return data;
      });
    }

    if (operations.includes("delete")) {
      this.beforeDelete((path) => {
        if (matcher(path)) {
          const allowed = checkFn(path, "delete");
          if (!allowed) {
            throw new Error(`Access denied for deleting path: ${path}`);
          }
        }
        return true;
      });
    }

    return this;
  }

  /**
   * Create and register a logging middleware
   * @param {Array<string>} operations - Operations to log
   * @param {Function} logFn - Logging function (defaults to console.log)
   * @return {BulletMiddleware} - This instance for chaining
   * @public
   */
  log(operations = ["read", "write", "delete"], logFn = console.log) {
    if (operations.includes("read")) {
      this.afterGet((path, data) => {
        logFn(`READ: ${path}`, data);
        return data;
      });
    }

    if (operations.includes("write")) {
      this.afterPut((path, data, oldData) => {
        logFn(`WRITE: ${path}`, {
          old: oldData,
          new: data,
        });
      });
    }

    if (operations.includes("delete")) {
      this.afterDelete((path, oldData) => {
        logFn(`DELETE: ${path}`, oldData);
      });
    }

    return this;
  }
}

module.exports = BulletMiddleware;
