# SquirrelDB

A lightweight, type-safe SQLite wrapper for Bun with schema validation, automatic serialization, and database mirroring capabilities.

## Features

- 🔒 **Type-safe**: Full TypeScript support with generic types
- 📝 **Schema validation**: Define and enforce column types
- 🔄 **Auto-serialization**: Automatic JSON and boolean handling
- 🪞 **Database mirroring**: Replicate operations across multiple instances
- ⚡ **Built for Bun**: Leverages `bun:sqlite` for optimal performance
- 🛡️ **Error handling**: Structured error types with detailed messages

## Installation

```bash
bun add squirreldb
```

## Quick Start

```typescript
import { SquirrelDB } from 'squirreldb';

// Create database instance
const db = new SquirrelDB({
  filePath: './my-database.sqlite',
  tables: ['users', 'posts'] // Optional: predefined table names
});

// Define schema
await db.initTable('users', {
  columns: [
    ['id', 'string'],      // Primary key (automatically added if missing)
    ['name', 'string'],
    ['age', 'number'],
    ['active', 'boolean'],
    ['metadata', 'json']
  ]
});

// Add records
await db.add('users', {
  id: 'user-001',
  name: 'John Doe',
  age: 30,
  active: true,
  metadata: { role: 'admin', preferences: { theme: 'dark' } }
});

// Retrieve records
const user = await db.get('users', 'user-001');
const allUsers = await db.all('users');
```

## API Reference

### Constructor

```typescript
new SquirrelDB(options?: {
  tables?: string[];
  filePath?: string;
})
```

- `tables`: Optional array of predefined table names
- `filePath`: Database file path (default: `"db.sqlite"`)

### Schema Definition

```typescript
interface TableSchema {
  columns: ColumnDefinition[];
}

type ColumnDefinition = [string, ColumnType];
type ColumnType = 'string' | 'number' | 'boolean' | 'json';
```

### Methods

#### `initTable(tableName: string, schema: TableSchema): Promise<void>`

Initialize a table with a specific schema. The `id` column is automatically added as primary key if not present.

```typescript
await db.initTable('products', {
  columns: [
    ['name', 'string'],
    ['price', 'number'],
    ['inStock', 'boolean'],
    ['tags', 'json']
  ]
});
```

#### `add(tableName: string, data: RowData): Promise<RowData>`

Add or update a record. Uses `INSERT OR REPLACE` internally.

```typescript
const product = await db.add('products', {
  id: 'prod-001',
  name: 'Laptop',
  price: 999.99,
  inStock: true,
  tags: ['electronics', 'computers']
});
```

#### `get<T>(tableName: string, id: string): Promise<T | null>`

Retrieve a single record by ID.

```typescript
const product = await db.get<Product>('products', 'prod-001');
```

#### `all<T>(tableName: string): Promise<T[]>`

Retrieve all records from a table.

```typescript
const products = await db.all<Product>('products');
```

#### `has(tableName: string, id: string): Promise<boolean>`

Check if a record exists.

```typescript
const exists = await db.has('products', 'prod-001');
```

#### `delete(tableName: string, id: string): Promise<number>`

Delete a single record. Returns 1 if deleted, 0 if not found.

```typescript
const deleted = await db.delete('products', 'prod-001');
```

#### `deleteAll(tableName: string): Promise<number>`

Delete all records from a table. Returns the number of deleted records.

```typescript
const deletedCount = await db.deleteAll('products');
```

#### `startsWith<T>(tableName: string, query: string): Promise<T[]>`

Find records with IDs starting with a specific prefix.

```typescript
const userRecords = await db.startsWith('users', 'user-');
```

#### `increment(tableName: string, id: string, column: string, value: number): Promise<number>`

Increment a numeric field and return the new value.

```typescript
const newScore = await db.increment('users', 'user-001', 'score', 10);
```

## Data Types

### Supported Column Types

- `string`: Text values
- `number`: Numeric values (stored as REAL in SQLite)
- `boolean`: Boolean values (stored as INTEGER: 1/0)
- `json`: Any serializable object/array

### Automatic Serialization

SquirrelDB automatically handles serialization:

```typescript
// JSON objects are stringified when stored
await db.add('users', {
  id: 'user-001',
  preferences: { theme: 'dark', notifications: true } // Stored as JSON string
});

// Booleans are converted to integers
await db.add('users', {
  id: 'user-002',
  active: true // Stored as 1
});

// Data is automatically deserialized when retrieved
const user = await db.get('users', 'user-001');
console.log(user.preferences.theme); // 'dark' (parsed from JSON)
console.log(user.active); // true (converted from 1)
```

## Error Handling

SquirrelDB provides structured error handling with specific error types:

```typescript
import { ErrorKind } from 'squirreldb';

try {
  await db.add('users', { name: 'John' }); // Missing required 'id'
} catch (error) {
  if (error.kind === ErrorKind.MissingValue) {
    console.log('Required field missing:', error.message);
  }
}
```

### Error Types

- `ErrorKind.MissingValue`: Required fields are missing
- `ErrorKind.ParseException`: Data parsing failed
- `ErrorKind.InvalidType`: Type validation failed

## Advanced Features

### Database Mirroring

You can set up database mirroring for replication:

```typescript
const primary = new SquirrelDB({ filePath: 'primary.sqlite' });
const mirror = new SquirrelDB({ filePath: 'mirror.sqlite' });

// Operations on primary will be replicated to mirror
primary.mirrors.push(mirror);

await primary.add('users', { id: 'user-001', name: 'John' });
// This record now exists in both databases
```

### Type Safety

Use TypeScript generics for type-safe operations:

```typescript
interface User {
  id: string;
  name: string;
  age: number;
  active: boolean;
  metadata: { role: string };
}

const user = await db.get<User>('users', 'user-001');
const users = await db.all<User>('users');
```

## Requirements

- **Bun**: This package requires Bun runtime
- **SQLite**: Uses Bun's built-in SQLite support

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.