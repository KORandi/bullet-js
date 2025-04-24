class BulletSerializer {
  constructor(bullet) {
    this.bullet = bullet;

    this.options = {
      prettyPrint: false,
      includeMetadata: true,
      maxDepth: Infinity,
    };

    this.typeSerializers = new Map();

    this.typeDeserializers = new Map();

    this._registerDefaultSerializers();
  }

  /**
   * Register default serializers for common types
   * @private
   */
  _registerDefaultSerializers() {
    this.registerType(
      "Date",
      (value) => ({ __type: "Date", value: value.toISOString() }),
      (data) => new Date(data.value)
    );

    this.registerType(
      "RegExp",
      (value) => {
        const flags = value.toString().match(/\/([gimuy]*)$/)[1];
        const source = value.source;
        return { __type: "RegExp", source, flags };
      },
      (data) => new RegExp(data.source, data.flags)
    );

    this.registerType(
      "Set",
      (value) => ({ __type: "Set", value: Array.from(value) }),
      (data) => new Set(data.value)
    );

    this.registerType(
      "Map",
      (value) => ({ __type: "Map", value: Array.from(value.entries()) }),
      (data) => new Map(data.value)
    );

    if (typeof Buffer !== "undefined") {
      this.registerType(
        "Buffer",
        (value) => ({ __type: "Buffer", value: value.toString("base64") }),
        (data) => Buffer.from(data.value, "base64")
      );
    }

    this.registerType(
      "ArrayBuffer",
      (value) => {
        const view = new Uint8Array(value);
        let string = "";
        for (let i = 0; i < view.length; i++) {
          string += String.fromCharCode(view[i]);
        }
        return { __type: "ArrayBuffer", value: btoa(string) };
      },
      (data) => {
        const binary = atob(data.value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
      }
    );
  }

  /**
   * Register a custom type serializer
   * @param {string} typeName - Name of the type
   * @param {Function} serializer - Function to convert type to JSON
   * @param {Function} deserializer - Function to convert JSON back to type
   * @return {BulletSerializer} - This instance for chaining
   * @public
   */
  registerType(typeName, serializer, deserializer) {
    this.typeSerializers.set(typeName, serializer);
    this.typeDeserializers.set(typeName, deserializer);
    return this;
  }

  /**
   * Configure serialization options
   * @param {Object} options - Options object
   * @return {BulletSerializer} - This instance for chaining
   * @public
   */
  configure(options) {
    Object.assign(this.options, options);
    return this;
  }

  /**
   * Export a path to JSON string
   * @param {string} path - Path to export
   * @param {Object} options - Export options
   * @return {string} - JSON string
   * @public
   */
  exportToJSON(path = "", options = {}) {
    const exportOptions = {
      ...this.options,
      ...options,
    };

    const data = this.bullet._getData(path);
    const metadata = exportOptions.includeMetadata
      ? this._getMetadataForPath(path)
      : null;

    const exportObj = {
      data,
      metadata,
      path,
      format: "bullet-json",
      version: "1.0",
    };

    const jsonStr = JSON.stringify(
      exportObj,
      this._replacer.bind(this, exportOptions),
      exportOptions.prettyPrint ? 2 : undefined
    );

    return jsonStr;
  }

  /**
   * Import JSON data to a path
   * @param {string} json - JSON string
   * @param {string} targetPath - Target path (optional, uses path from JSON if not provided)
   * @param {Object} options - Import options
   * @return {Object} - Result with imported data
   * @public
   */
  importFromJSON(json, targetPath = null, options = {}) {
    const importOptions = {
      ...this.options,
      ...options,
    };

    try {
      const parsed = JSON.parse(json, this._reviver.bind(this));

      if (!parsed.format || parsed.format !== "bullet-json") {
        throw new Error("Invalid Bullet JSON format");
      }

      const path = targetPath || parsed.path;

      if (!path) {
        throw new Error("No target path specified");
      }

      this.bullet.setData(path, parsed.data);

      if (
        parsed.metadata &&
        importOptions.includeMetadata &&
        this.bullet.meta
      ) {
        this._importMetadata(path, parsed.metadata);
      }

      return {
        success: true,
        path,
        data: parsed.data,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Export to CSV format
   * @param {string} path - Path to export
   * @param {Object} options - CSV export options
   * @return {string} - CSV string
   * @public
   */
  exportToCSV(path, options = {}) {
    const exportOptions = {
      delimiter: ",",
      includeHeaders: true,
      ...options,
    };

    const data = this.bullet._getData(path);

    if (typeof data !== "object" || data === null) {
      throw new Error("Data must be an object to export as CSV");
    }

    if (Array.isArray(data)) {
      return this._arrayToCSV(data, exportOptions);
    }

    const rows = [];
    for (const key in data) {
      if (typeof data[key] === "object" && data[key] !== null) {
        rows.push({
          id: key,
          ...data[key],
        });
      }
    }

    return this._arrayToCSV(rows, exportOptions);
  }

  /**
   * Convert array of objects to CSV
   * @param {Array} arr - Array of objects
   * @param {Object} options - CSV options
   * @return {string} - CSV string
   * @private
   */
  _arrayToCSV(arr, options) {
    if (!arr.length) return "";

    const headers = new Set();
    arr.forEach((obj) => {
      if (typeof obj === "object" && obj !== null) {
        Object.keys(obj).forEach((key) => headers.add(key));
      }
    });

    const headerRow = Array.from(headers);
    const rows = arr.map((obj) => {
      return headerRow.map((header) => {
        if (obj[header] === undefined || obj[header] === null) return "";

        if (typeof obj[header] === "string") {
          const escaped = obj[header].replace(/"/g, '""');
          if (
            escaped.includes(options.delimiter) ||
            escaped.includes("\n") ||
            escaped.includes('"')
          ) {
            return `"${escaped}"`;
          }
          return escaped;
        }

        return String(obj[header]);
      });
    });

    const csvRows = [];
    if (options.includeHeaders) {
      csvRows.push(headerRow.join(options.delimiter));
    }

    csvRows.push(...rows.map((row) => row.join(options.delimiter)));

    return csvRows.join("\n");
  }

  /**
   * Import from CSV format
   * @param {string} csv - CSV string
   * @param {string} targetPath - Target path
   * @param {Object} options - CSV import options
   * @return {Object} - Result with imported data
   * @public
   */
  importFromCSV(csv, targetPath, options = {}) {
    const importOptions = {
      delimiter: ",",
      firstRowHeaders: true,
      ...options,
    };

    try {
      const rows = this._parseCSVRows(csv);

      if (!rows.length) {
        throw new Error("Empty CSV data");
      }

      let headers;
      let startRow = 0;

      if (importOptions.firstRowHeaders) {
        headers = this._parseCSVRow(rows[0], importOptions.delimiter);
        startRow = 1;
      } else {
        headers = Array.from(
          { length: rows[0].split(importOptions.delimiter).length },
          (_, i) => `field${i}`
        );
      }

      const result = {};

      for (let i = startRow; i < rows.length; i++) {
        const row = this._parseCSVRow(rows[i], importOptions.delimiter);

        if (row.length === 0 || (row.length === 1 && row[0] === "")) continue;

        const obj = {};
        const id = row[0] || `row${i}`;

        for (let j = 0; j < Math.min(headers.length, row.length); j++) {
          obj[headers[j]] = this._convertCSVValue(row[j]);
        }

        result[id] = obj;
      }

      this.bullet.setData(targetPath, result);

      return {
        success: true,
        path: targetPath,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Parse CSV rows properly handling quotes
   * @param {string} csv - CSV string
   * @return {Array} - Array of row strings
   * @private
   */
  _parseCSVRows(csv) {
    const rows = [];
    let inQuote = false;
    let currentRow = "";

    for (let i = 0; i < csv.length; i++) {
      const char = csv[i];
      const nextChar = csv[i + 1];

      if (char === '"') {
        if (nextChar === '"') {
          currentRow += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (char === "\n" && !inQuote) {
        rows.push(currentRow);
        currentRow = "";
      } else {
        currentRow += char;
      }
    }

    if (currentRow.trim()) {
      rows.push(currentRow);
    }

    return rows;
  }

  /**
   * Parse a CSV row into fields
   * @param {string} row - CSV row
   * @param {string} delimiter - Delimiter character
   * @return {Array} - Array of field values
   * @private
   */
  _parseCSVRow(row, delimiter) {
    const fields = [];
    let inQuote = false;
    let currentField = "";

    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      const nextChar = row[i + 1];

      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (char === delimiter && !inQuote) {
        fields.push(currentField);
        currentField = "";
      } else {
        currentField += char;
      }
    }

    fields.push(currentField);

    return fields;
  }

  /**
   * Convert CSV string value to appropriate type
   * @param {string} value - CSV value
   * @return {*} - Converted value
   * @private
   */
  _convertCSVValue(value) {
    if (value === "") return null;

    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;

    if (!isNaN(value) && value.trim() !== "") {
      if (value.includes(".")) {
        return parseFloat(value);
      }
      return parseInt(value, 10);
    }

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    return value;
  }

  /**
   * Export to XML format
   * @param {string} path - Path to export
   * @param {Object} options - XML export options
   * @return {string} - XML string
   * @public
   */
  exportToXML(path, options = {}) {
    const exportOptions = {
      rootName: "bullet",
      indent: "  ",
      ...options,
    };

    const data = this.bullet._getData(path);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<${exportOptions.rootName} path="${path || ""}">\n`;

    xml += this._objectToXML(data, 1, exportOptions);

    xml += `</${exportOptions.rootName}>`;

    return xml;
  }

  /**
   * Convert object to XML
   * @param {*} obj - Object to convert
   * @param {number} level - Indentation level
   * @param {Object} options - XML options
   * @return {string} - XML string
   * @private
   */
  _objectToXML(obj, level, options) {
    const indent = options.indent.repeat(level);
    let xml = "";

    if (obj === null || obj === undefined) {
      return `${indent}<null/>\n`;
    }

    if (typeof obj !== "object") {
      return `${indent}<value type="${typeof obj}">${this._escapeXML(
        String(obj)
      )}</value>\n`;
    }

    if (Array.isArray(obj)) {
      xml += `${indent}<array>\n`;

      for (let i = 0; i < obj.length; i++) {
        xml += `${indent}${options.indent}<item index="${i}">\n`;
        xml += this._objectToXML(obj[i], level + 2, options);
        xml += `${indent}${options.indent}</item>\n`;
      }

      xml += `${indent}</array>\n`;
      return xml;
    }

    for (const key in obj) {
      if (obj[key] === undefined || obj[key] === null) {
        xml += `${indent}<${this._escapeXML(key)} null="true"/>\n`;
      } else if (typeof obj[key] !== "object") {
        xml += `${indent}<${this._escapeXML(key)} type="${typeof obj[
          key
        ]}">${this._escapeXML(String(obj[key]))}</${this._escapeXML(key)}>\n`;
      } else {
        xml += `${indent}<${this._escapeXML(key)}>\n`;
        xml += this._objectToXML(obj[key], level + 1, options);
        xml += `${indent}</${this._escapeXML(key)}>\n`;
      }
    }

    return xml;
  }

  /**
   * Escape XML special characters
   * @param {string} str - String to escape
   * @return {string} - Escaped string
   * @private
   */
  _escapeXML(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * Import XML data
   * @param {string} xml - XML string
   * @param {string} targetPath - Target path
   * @param {Object} options - Import options
   * @return {Object} - Import result
   * @public
   */
  importFromXML(xml, targetPath, options = {}) {
    try {
      let parsed;

      if (typeof DOMParser !== "undefined") {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, "application/xml");
        parsed = this._xmlNodeToObject(doc.documentElement);
      } else {
        throw new Error(
          "XML parsing requires DOMParser (browser) or xml2js (Node.js)"
        );
      }

      this.bullet.setData(targetPath, parsed);

      return {
        success: true,
        path: targetPath,
        data: parsed,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Convert XML DOM node to JavaScript object
   * @param {Node} node - XML DOM node
   * @return {*} - JavaScript value
   * @private
   */
  _xmlNodeToObject(node) {
    if (node.getAttribute("null") === "true") {
      return null;
    }

    if (node.tagName === "value") {
      const type = node.getAttribute("type");
      const value = node.textContent;

      switch (type) {
        case "number":
          return Number(value);
        case "boolean":
          return value === "true";
        default:
          return value;
      }
    }

    if (node.tagName === "array") {
      const result = [];
      for (const child of node.children) {
        if (child.tagName === "item") {
          const index = parseInt(child.getAttribute("index"), 10);
          const value = this._xmlNodeToObject(child.children[0]);
          result[index] = value;
        }
      }
      return result;
    }

    const result = {};
    for (const child of node.children) {
      const key = child.tagName;

      if (key === "bullet") continue;

      const type = child.getAttribute("type");

      if (child.getAttribute("null") === "true") {
        result[key] = null;
      } else if (type) {
        switch (type) {
          case "number":
            result[key] = Number(child.textContent);
            break;
          case "boolean":
            result[key] = child.textContent === "true";
            break;
          default:
            result[key] = child.textContent;
        }
      } else if (child.children.length) {
        result[key] = this._xmlNodeToObject(child);
      } else {
        result[key] = child.textContent || null;
      }
    }

    return result;
  }

  /**
   * Get metadata for a path
   * @param {string} path - Path to get metadata for
   * @return {Object} - Metadata
   * @private
   */
  _getMetadataForPath(path) {
    const metadata = {};

    if (this.bullet.meta) {
      metadata.meta = this.bullet.meta[path] || {};
    }

    if (this.bullet.query && this.bullet.query.indices) {
      const indices = {};

      for (const [indexKey, indexData] of Object.entries(
        this.bullet.query.indices
      )) {
        if (indexKey.startsWith(path)) {
          indices[indexKey] = true;
        }
      }

      if (Object.keys(indices).length > 0) {
        metadata.indices = indices;
      }
    }

    return metadata;
  }

  /**
   * Import metadata
   * @param {string} path - Path
   * @param {Object} metadata - Metadata
   * @private
   */
  _importMetadata(path, metadata) {
    if (metadata.meta && this.bullet.meta) {
      this.bullet.meta[path] = metadata.meta;
    }

    if (metadata.indices && this.bullet.query) {
      for (const indexKey of Object.keys(metadata.indices)) {
        const [basePath, field] = indexKey.split(":");
        if (field) {
          this.bullet.query.index(basePath, field);
        } else {
          this.bullet.query.index(basePath);
        }
      }
    }
  }

  /**
   * Custom JSON replacer for serialization
   * @param {Object} options - Serialization options
   * @param {string} key - Object key
   * @param {*} value - Object value
   * @return {*} - Serialized value
   * @private
   */
  _replacer(options, key, value) {
    if (!this._depth) this._depth = 0;

    if (typeof value === "object" && value !== null) {
      this._depth++;

      if (this._depth > options.maxDepth) {
        this._depth--;
        return "[max depth reached]";
      }
    }

    if (value !== null && typeof value === "object") {
      const constructorName = value.constructor.name;

      if (this.typeSerializers.has(constructorName)) {
        const result = this.typeSerializers.get(constructorName)(value);
        this._depth--;
        return result;
      }
    }

    if (typeof value === "object" && value !== null) {
      this._depth--;
    }

    return value;
  }

  /**
   * Custom JSON reviver for deserialization
   * @param {string} key - Object key
   * @param {*} value - Object value
   * @return {*} - Deserialized value
   * @private
   */
  _reviver(key, value) {
    if (value !== null && typeof value === "object" && value.__type) {
      if (this.typeDeserializers.has(value.__type)) {
        return this.typeDeserializers.get(value.__type)(value);
      }
    }

    return value;
  }
}

module.exports = BulletSerializer;
