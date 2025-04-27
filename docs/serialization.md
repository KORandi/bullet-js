# Serialization

Bullet.js provides powerful serialization capabilities that allow you to import and export data in various formats. This guide explains how to use these features to move data in and out of your database.

## You will learn

- How to export data to JSON, CSV, and XML formats
- How to import data from different formats
- How to handle custom data types during serialization
- How to configure serialization options
- Best practices for data import and export

## Enabling Serialization

Serialization is enabled by default but can be explicitly configured:

```javascript
const bullet = new Bullet({
  enableSerializer: true, // default is true
});
```

## Exporting Data

### JSON Export

JSON is the most common format for exporting data:

```javascript
// Export all data to JSON
const allDataJson = bullet.exportToJSON("", { prettyPrint: true });
fs.writeFileSync("all_data.json", allDataJson);

// Export just a specific path
const usersJson = bullet.exportToJSON("users", { prettyPrint: true });
fs.writeFileSync("users.json", usersJson);

// Export a single object
const userJson = bullet.exportToJSON("users/alice");
fs.writeFileSync("alice.json", userJson);
```

The exported JSON includes metadata like path information and vector clocks, which helps during imports:

```javascript
// Example of exported JSON structure
{
  "format": "bullet-json",
  "version": "1.0",
  "path": "users",
  "data": {
    "alice": {
      "name": "Alice Johnson",
      "email": "alice@example.com"
    },
    "bob": {
      "name": "Bob Smith",
      "email": "bob@example.com"
    }
  },
  "metadata": {
    "meta": {
      "users/alice": {
        "lastModified": 1650123456789,
        "vectorClock": { "peer1": 2 }
      },
      "users/bob": {
        "lastModified": 1650123789012,
        "vectorClock": { "peer1": 1, "peer2": 1 }
      }
    },
    "indices": {
      "users:role": true,
      "users:active": true
    }
  }
}
```

### CSV Export

CSV is useful for tabular data:

```javascript
// Export users to CSV
const usersCSV = bullet.exportToCSV("users", {
  delimiter: ",",
  includeHeaders: true,
});
fs.writeFileSync("users.csv", usersCSV);

// Export products to CSV
const productsCSV = bullet.exportToCSV("products", {
  delimiter: ";", // Use semicolon delimiter
  includeHeaders: true,
});
fs.writeFileSync("products.csv", productsCSV);
```

The CSV export converts objects to rows and their properties to columns:

```csv
id,name,email,role
alice,Alice Johnson,alice@example.com,admin
bob,Bob Smith,bob@example.com,user
charlie,Charlie Davis,charlie@example.com,editor
```

### XML Export

XML export provides a structured format with additional metadata:

```javascript
// Export all data to XML
const allDataXML = bullet.exportToXML("", {
  rootName: "bulletData",
  indent: "  ",
});
fs.writeFileSync("all_data.xml", allDataXML);

// Export just products to XML
const productsXML = bullet.exportToXML("products", {
  rootName: "products",
  indent: "  ",
});
fs.writeFileSync("products.xml", productsXML);
```

Example of exported XML:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<products path="products">
  <product1>
    <name type="string">Laptop</name>
    <price type="number">1200</price>
    <stock type="number">15</stock>
    <category type="string">electronics</category>
  </product1>
  <product2>
    <name type="string">Smartphone</name>
    <price type="number">800</price>
    <stock type="number">25</stock>
    <category type="string">electronics</category>
  </product2>
</products>
```

## Importing Data

### JSON Import

Import data from JSON files:

```javascript
// Import JSON data
const jsonData = fs.readFileSync("users.json", "utf8");
const importResult = bullet.importFromJSON(jsonData, "imported_users");

if (importResult.success) {
  console.log(`Imported ${Object.keys(importResult.data).length} users`);
} else {
  console.error("Import failed:", importResult.error);
}

// Import to the original path (using path from JSON)
const autoPathResult = bullet.importFromJSON(jsonData);
console.log("Import result:", autoPathResult);
```

### CSV Import

Import data from CSV files:

```javascript
// Import CSV data
const csvData = fs.readFileSync("users.csv", "utf8");
const csvImportResult = bullet.importFromCSV(csvData, "csv_users", {
  delimiter: ",",
  firstRowHeaders: true,
});

if (csvImportResult.success) {
  console.log(
    `Imported ${Object.keys(csvImportResult.data).length} users from CSV`
  );
} else {
  console.error("CSV import failed:", csvImportResult.error);
}
```

### XML Import

Import data from XML files:

```javascript
// Import XML data
const xmlData = fs.readFileSync("products.xml", "utf8");
const xmlImportResult = bullet.importFromXML(xmlData, "imported_products");

if (xmlImportResult.success) {
  console.log(
    `Imported ${Object.keys(xmlImportResult.data).length} products from XML`
  );
} else {
  console.error("XML import failed:", xmlImportResult.error);
}
```

## Handling Custom Types

Bullet.js automatically handles basic JavaScript types, but you can also register custom type handlers:

```javascript
// Define a custom data type
class CustomPoint {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  distance() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
}

// Register serializer for the custom type
bullet.registerSerializerType(
  "CustomPoint",
  // Serializer function - converts instance to plain object
  (point) => ({ __type: "CustomPoint", x: point.x, y: point.y }),
  // Deserializer function - converts plain object back to instance
  (data) => new CustomPoint(data.x, data.y)
);

// Add data with custom type
bullet.get("locations/loc1").put({
  name: "Office",
  position: new CustomPoint(10, 20),
  active: true,
});

// Export with custom types
const locationsJson = bullet.exportToJSON("locations", { prettyPrint: true });
fs.writeFileSync("locations.json", locationsJson);

// Import with custom types (remember to register the type first)
const importedData = fs.readFileSync("locations.json", "utf8");
const importResult = bullet.importFromJSON(importedData, "imported_locations");

// Verify the custom type was properly deserialized
const location = bullet.get("imported_locations/loc1").value();
console.log("Location name:", location.name);
console.log(
  "Position is a CustomPoint:",
  location.position instanceof CustomPoint
);
console.log("Distance from origin:", location.position.distance());
```

### Built-in Type Serializers

Bullet.js provides built-in serializers for several JavaScript types:

- `Date`: Serialized as ISO strings
- `RegExp`: Preserves pattern and flags
- `Set`: Converted to arrays
- `Map`: Converted to array of entries
- `Buffer`: Encoded as base64
- `ArrayBuffer`: Encoded as base64

```javascript
// These types are handled automatically
bullet.get("examples/types").put({
  timestamp: new Date(),
  pattern: /^\d{3}-\d{2}-\d{4}$/,
  uniqueItems: new Set([1, 2, 3]),
  keyValues: new Map([
    ["key1", "value1"],
    ["key2", "value2"],
  ]),
  binaryData: Buffer.from("Hello, world!"),
});

// Export and import preserves these types
const typesJson = bullet.exportToJSON("examples/types");
const importResult = bullet.importFromJSON(typesJson, "imported/types");

// Check the imported data
const importedTypes = bullet.get("imported/types").value();
console.log("Timestamp is a Date:", importedTypes.timestamp instanceof Date);
console.log("Pattern is a RegExp:", importedTypes.pattern instanceof RegExp);
console.log("uniqueItems is a Set:", importedTypes.uniqueItems instanceof Set);
console.log("keyValues is a Map:", importedTypes.keyValues instanceof Map);
console.log(
  "binaryData is a Buffer:",
  Buffer.isBuffer(importedTypes.binaryData)
);
```

## Serialization Configuration

You can configure default serialization behaviors:

```javascript
// Configure serializer options
bullet.serializer.configure({
  prettyPrint: true, // Format JSON with indentation
  includeMetadata: true, // Include metadata in exports
  maxDepth: 10, // Maximum depth for nested objects
  dateFormat: "ISO", // How to format dates
});
```

## Incremental Exports

For large datasets, you might want to export incrementally:

```javascript
// Export only data that has changed since a timestamp
const changedSince = Date.now() - 24 * 60 * 60 * 1000; // Last 24 hours
const recentChanges = {};

// Find recently changed paths
for (const [path, meta] of Object.entries(bullet.meta)) {
  if (meta.lastModified > changedSince) {
    const data = bullet.get(path).value();
    const pathParts = path.split("/");

    // Organize by top-level path
    const topLevel = pathParts[0];
    if (!recentChanges[topLevel]) {
      recentChanges[topLevel] = {};
    }

    // Add to changes
    let current = recentChanges[topLevel];
    for (let i = 1; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!current[part]) current[part] = {};
      current = current[part];
    }

    // Set the value
    current[pathParts[pathParts.length - 1]] = data;
  }
}

// Export each top-level path
for (const [path, data] of Object.entries(recentChanges)) {
  const json = bullet.exportToJSON(path, { includeMetadata: true });
  fs.writeFileSync(`${path}_recent.json`, json);
}
```

## Data Migration

Use serialization for data migrations:

```javascript
// Load data from old format
const oldData = fs.readFileSync("old_data.json", "utf8");
const oldDataObj = JSON.parse(oldData);

// Transform to new format
const newDataObj = transformData(oldDataObj);

// Import into Bullet
bullet.importFromJSON(
  JSON.stringify({
    format: "bullet-json",
    version: "1.0",
    path: "migrated",
    data: newDataObj,
  })
);

// Helper function to transform data
function transformData(oldData) {
  // Implement your migration logic here
  const newData = {};

  // Example transformation
  for (const [key, user] of Object.entries(oldData.users)) {
    newData[key] = {
      displayName: `${user.firstName} ${user.lastName}`,
      email: user.email,
      accountDetails: {
        created: user.created,
        type: user.accountType,
      },
    };
  }

  return newData;
}
```

## CSV Processing Options

For CSV import/export, you have several configuration options:

```javascript
// CSV export options
const csvOptions = {
  delimiter: ",", // Column separator
  includeHeaders: true, // Include column headers
  rowDelimiter: "\n", // Row separator
  quote: '"', // Character to quote strings
  escape: '"', // Character to escape quotes
  columns: ["id", "name", "email"], // Specific columns to include
};

const customCSV = bullet.exportToCSV("users", csvOptions);

// CSV import options
const csvImportOptions = {
  delimiter: ",", // Column separator
  firstRowHeaders: true, // Use first row as headers
  skipEmptyLines: true, // Skip empty lines
  dynamicTyping: true, // Automatically convert string values to appropriate types
};

bullet.importFromCSV(csvData, "imported_data", csvImportOptions);
```

## Serialization Events

Monitor serialization activities with events:

```javascript
// Listen for serialization events
bullet.on("serialize:export", (data) => {
  console.log(`Exporting data from path: ${data.path}`);
  console.log(`Format: ${data.format}`);
  console.log(`Size: ${data.size} bytes`);
});

bullet.on("serialize:import", (data) => {
  console.log(`Importing data to path: ${data.path}`);
  console.log(`Format: ${data.format}`);
  console.log(`Records: ${data.recordCount}`);
});

bullet.on("serialize:error", (error) => {
  console.error("Serialization error:", error.message);
});
```

## Complete Serialization Example

Here's a complete example showing various serialization techniques:

```javascript
const Bullet = require("bullet-js");
const fs = require("fs");
const path = require("path");

// Initialize Bullet with serializer enabled
const bullet = new Bullet({
  enableSerializer: true,
});

// Create a directory for exported files
const exportDir = "./exports";
if (!fs.existsSync(exportDir)) {
  fs.mkdirSync(exportDir);
}

// Helper function to write file
function writeFile(filename, content) {
  fs.writeFileSync(path.join(exportDir, filename), content);
  console.log(`File written: ${filename}`);
}

// Populate with sample data
console.log("Populating database with sample data...");

// Users
bullet.get("users/user1").put({
  name: "Alice Johnson",
  email: "alice@example.com",
  createdAt: new Date("2023-01-15T08:30:00Z"),
  role: "admin",
  settings: {
    notifications: true,
    theme: "dark",
  },
  tags: ["staff", "developer"],
});

bullet.get("users/user2").put({
  name: "Bob Smith",
  email: "bob@example.com",
  createdAt: new Date("2023-02-20T14:45:00Z"),
  role: "user",
  settings: {
    notifications: false,
    theme: "light",
  },
  tags: ["customer"],
});

// Products
bullet.get("products/prod1").put({
  name: "Smartphone",
  price: 699.99,
  stock: 42,
  features: ["5G", "Dual camera", "Fast charging"],
  category: "electronics",
});

bullet.get("products/prod2").put({
  name: "Laptop",
  price: 1299.99,
  stock: 15,
  features: ["SSD", "16GB RAM", "Dedicated GPU"],
  category: "electronics",
});

// Example 1: JSON Export & Import
console.log("\n1. JSON Export & Import:");

// Export all data
const allDataJson = bullet.exportToJSON("", { prettyPrint: true });
writeFile("all_data.json", allDataJson);

// Export just users
const usersJson = bullet.exportToJSON("users", { prettyPrint: true });
writeFile("users.json", usersJson);

// Create a new Bullet instance for import testing
const importBullet = new Bullet({
  enableSerializer: true,
});

// Import the users data
const importResult = importBullet.importFromJSON(usersJson, "imported_users");
console.log("Import result:", importResult);
console.log("Imported data:", importBullet.get("imported_users").value());

// Example 2: CSV Export & Import
console.log("\n2. CSV Export & Import:");

// Export users to CSV
const usersCSV = bullet.exportToCSV("users", {
  delimiter: ",",
  includeHeaders: true,
});
writeFile("users.csv", usersCSV);

// Export products to CSV
const productsCSV = bullet.exportToCSV("products", {
  delimiter: ",",
  includeHeaders: true,
});
writeFile("products.csv", productsCSV);

// Import CSV data
const csvImportBullet = new Bullet({
  enableSerializer: true,
});

// Import from CSV
const csvContent = `id,name,email,role
user3,Charlie Brown,charlie@example.com,editor
user4,Diana Prince,diana@example.com,admin`;

const csvImportResult = csvImportBullet.importFromCSV(csvContent, "csv_users");
console.log("CSV Import result:", csvImportResult);
console.log("Imported CSV data:", csvImportBullet.get("csv_users").value());

// Example 3: XML Export & Import
console.log("\n3. XML Export & Import:");

// Export all data to XML
const allDataXML = bullet.exportToXML("", {
  rootName: "bulletData",
  indent: "  ",
});
writeFile("all_data.xml", allDataXML);

// Export just products to XML
const productsXML = bullet.exportToXML("products", {
  rootName: "products",
  indent: "  ",
});
writeFile("products.xml", productsXML);

// Example 4: Custom Type Serialization
console.log("\n4. Custom Type Serialization:");

// Define a custom type
class CustomPoint {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  distance() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }
}

// Register serializer for the custom type
bullet.registerSerializerType(
  "CustomPoint",
  (point) => ({ __type: "CustomPoint", x: point.x, y: point.y }),
  (data) => new CustomPoint(data.x, data.y)
);

// Add data with custom type
bullet.get("locations/loc1").put({
  name: "Office",
  position: new CustomPoint(10, 20),
  active: true,
});

bullet.get("locations/loc2").put({
  name: "Warehouse",
  position: new CustomPoint(30, 40),
  active: false,
});

// Export with custom types
const locationsJson = bullet.exportToJSON("locations", { prettyPrint: true });
writeFile("locations.json", locationsJson);

// Import with custom types
const customTypeBullet = new Bullet({
  enableSerializer: true,
});

// Register the same custom type
customTypeBullet.registerSerializerType(
  "CustomPoint",
  (point) => ({ __type: "CustomPoint", x: point.x, y: point.y }),
  (data) => new CustomPoint(data.x, data.y)
);

// Import the data
const customImportResult = customTypeBullet.importFromJSON(
  locationsJson,
  "imported_locations"
);
console.log("Custom type import result:", customImportResult);

// Verify the custom type was properly deserialized
const location = customTypeBullet.get("imported_locations/loc1").value();
console.log("Imported location:", location);
console.log(
  "Position is a CustomPoint:",
  location.position instanceof CustomPoint
);
console.log("Distance calculation:", location.position.distance());

console.log("\nAll serialization examples completed.");
```

## Best Practices

1. **Validate before importing**: Validate imported data before integrating into your application

   ```javascript
   // Validate data after import
   if (importResult.success) {
     const isValid = validateImportedData(importResult.data);
     if (isValid) {
       // Proceed with using the data
     } else {
       // Handle invalid data
     }
   }
   ```

2. **Use metadata for resilient imports**

   ```javascript
   const exportOptions = {
     includeMetadata: true, // Preserve indices, vector clocks, etc.
   };
   ```

3. **Handle large datasets incrementally**

   ```javascript
   // Export large datasets in chunks
   for (const batch of chunkData(largeDataset, 1000)) {
     const json = JSON.stringify(batch);
     // Process each chunk
   }
   ```

4. **Create backups before imports**

   ```javascript
   // Backup before import
   const backupJson = bullet.exportToJSON("");
   fs.writeFileSync("backup.json", backupJson);
   ```

5. **Prefer JSON for full database exports**

   ```javascript
   // JSON preserves the most metadata and structure
   const fullBackup = bullet.exportToJSON("", {
     prettyPrint: false, // More compact for backups
     includeMetadata: true,
   });
   ```

6. **Use CSV for interoperability**
   ```javascript
   // CSV is best for sharing data with other applications
   const exportForSpreadsheet = bullet.exportToCSV("users", {
     delimiter: ",",
     includeHeaders: true,
   });
   ```

## Next Steps

Now that you've learned about serialization, you might want to explore:

- [Storage Adapters](/docs/storage-adapters.md) - Learn about persistent storage options
- [Middleware](/docs/middleware.md) - Transform data during operations
- [Conflict Resolution](/docs/conflict-resolution.md) - Understand how conflicts are handled
- [Network Topologies](/docs/network-topologies.md) - Configure distributed architectures
