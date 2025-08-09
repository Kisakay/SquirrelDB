import { Database } from 'bun:sqlite';

export enum ErrorKind {
  MissingValue = "MISSING_VALUE",
  ParseException = "PARSE_EXCEPTION",
  InvalidType = "INVALID_TYPE",
}

// Define column types
type ColumnType = 'string' | 'number' | 'boolean' | 'json';
type ColumnDefinition = [string, ColumnType];

// Schema definition for a table
interface TableSchema {
  columns: ColumnDefinition[];
}

// Row data type
type RowData = Record<string, any>;

export class SquirrelDB<D = any> {
  private path: string;
  private db: Database;
  private predefinedTables: string[];
  private tableSchemas: Map<string, TableSchema> = new Map();
  private mirrors: SquirrelDB[] = [];

  constructor(options: {
    tables?: string[];
    filePath?: string;
  } = {}) {
    this.predefinedTables = options.tables ?? [];
    this.path = options.filePath ?? "db.sqlite";
    this.db = new Database(this.path);
    this.initDatabase();
  }

  private initDatabase(): void {
    // Note: Predefined tables are just reserved names
    // They must be initialized with initTable() before use
  }

  private createError(message: string, kind: ErrorKind): Error {
    const error = new Error(message);
    error.name = kind;
    Object.defineProperty(error, 'kind', {
      value: kind,
      writable: false
    });
    return error;
  }

  private async snapshot(): Promise<void> {
    // Implementation for snapshotting
  }

  private getSQLiteType(type: ColumnType): string {
    switch (type) {
      case 'string':
        return 'TEXT';
      case 'number':
        return 'REAL';
      case 'boolean':
        return 'INTEGER';
      case 'json':
        return 'TEXT';
      default:
        return 'TEXT';
    }
  }

  private createTableIfNotExists(tableName: string, schema: TableSchema): void {
    // Always ensure 'id' column exists as primary key
    const hasIdColumn = schema.columns.some(([name]) => name === 'id');
    if (!hasIdColumn) {
      schema.columns.unshift(['id', 'string']);
    }

    const columnDefinitions = schema.columns.map(([name, type]) => {
      const sqlType = this.getSQLiteType(type);
      return name === 'id' ? `${name} ${sqlType} PRIMARY KEY` : `${name} ${sqlType}`;
    }).join(', ');

    this.db.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefinitions})`);
    this.tableSchemas.set(tableName, schema);
  }

  private validateRowData(tableName: string, data: RowData): void {
    const schema = this.tableSchemas.get(tableName);
    if (!schema) {
      throw this.createError(
        `Table ${tableName} does not exist or has no schema defined`,
        ErrorKind.InvalidType
      );
    }

    // Check if 'id' is provided
    if (!data.id) {
      throw this.createError(
        "Field 'id' is required for all operations",
        ErrorKind.MissingValue
      );
    }

    // Validate column types
    for (const [columnName, columnType] of schema.columns) {
      if (data.hasOwnProperty(columnName) && data[columnName] !== null) {
        const value = data[columnName];
        
        switch (columnType) {
          case 'string':
            if (typeof value !== 'string') {
              throw this.createError(
                `Column '${columnName}' expects string, got ${typeof value}`,
                ErrorKind.InvalidType
              );
            }
            break;
          case 'number':
            if (typeof value !== 'number') {
              throw this.createError(
                `Column '${columnName}' expects number, got ${typeof value}`,
                ErrorKind.InvalidType
              );
            }
            break;
          case 'boolean':
            if (typeof value !== 'boolean') {
              throw this.createError(
                `Column '${columnName}' expects boolean, got ${typeof value}`,
                ErrorKind.InvalidType
              );
            }
            break;
          case 'json':
            // JSON can be any serializable type
            try {
              JSON.stringify(value);
            } catch {
              throw this.createError(
                `Column '${columnName}' contains non-serializable JSON data`,
                ErrorKind.InvalidType
              );
            }
            break;
        }
      }
    }
  }

  private serializeValue(value: any, type: ColumnType): any {
    switch (type) {
      case 'json':
        return JSON.stringify(value);
      case 'boolean':
        return value ? 1 : 0;
      default:
        return value;
    }
  }

  private deserializeValue(value: any, type: ColumnType): any {
    if (value === null) return null;
    
    switch (type) {
      case 'json':
        return JSON.parse(value);
      case 'boolean':
        return value === 1;
      case 'number':
        return Number(value);
      default:
        return value;
    }
  }

  /**
   * Initialize a table with a specific schema
   */
  async initTable(tableName: string, schema: TableSchema): Promise<void> {
    if (typeof tableName !== "string") {
      throw this.createError(
        `Table name must be a string, received "${typeof tableName}"`,
        ErrorKind.InvalidType
      );
    }

    if (!schema || !schema.columns || !Array.isArray(schema.columns)) {
      throw this.createError(
        "Schema must contain a 'columns' array",
        ErrorKind.InvalidType
      );
    }

    // Check if table already exists with different schema
    if (this.tableSchemas.has(tableName)) {
      console.warn(`Table ${tableName} already exists. Schema will be updated.`);
    }

    this.createTableIfNotExists(tableName, schema);
    
    // Replicate to mirrors
    for (const mirror of this.mirrors) {
      await mirror.initTable(tableName, schema);
    }
  }

  /**
   * Add a new record to the specified table
   */
  async add(tableName: string, data: RowData): Promise<RowData> {
    if (typeof tableName !== "string") {
      throw this.createError(
        `Table name must be a string, received "${typeof tableName}"`,
        ErrorKind.InvalidType
      );
    }

    this.validateRowData(tableName, data);
    
    const schema = this.tableSchemas.get(tableName)!;
    const columnsToInsert: string[] = [];
    const values: any[] = [];
    const placeholders: string[] = [];

    for (const [columnName, columnType] of schema.columns) {
      if (data.hasOwnProperty(columnName) && data[columnName] !== undefined) {
        columnsToInsert.push(columnName);
        placeholders.push('?');
        values.push(this.serializeValue(data[columnName], columnType));
      }
    }

    const sql = `INSERT OR REPLACE INTO ${tableName} (${columnsToInsert.join(', ')}) VALUES (${placeholders.join(', ')})`;
    
    try {
      const stmt = this.db.prepare(sql);
      stmt.run(...values);
    } catch (e: any) {
      throw this.createError(
        `Failed to insert data into table ${tableName}: ${e.message}`,
        ErrorKind.InvalidType
      );
    }

    await this.snapshot();
    
    // Replicate to mirrors
    for (const mirror of this.mirrors) {
      await mirror.add(tableName, data);
    }

    return data;
  }

  /**
   * Get a record by ID from the specified table
   */
  async get<T = D>(tableName: string, id: string): Promise<T | null> {
    if (typeof tableName !== "string") {
      throw this.createError(
        `Table name must be a string, received "${typeof tableName}"`,
        ErrorKind.InvalidType
      );
    }

    if (typeof id !== "string") {
      throw this.createError(
        `ID must be a string, received "${typeof id}"`,
        ErrorKind.InvalidType
      );
    }

    const schema = this.tableSchemas.get(tableName);
    if (!schema) {
      throw this.createError(
        `Table ${tableName} does not exist or has no schema defined`,
        ErrorKind.InvalidType
      );
    }

    const columns = schema.columns.map(([name]) => name);
    const stmt = this.db.prepare(`SELECT ${columns.join(', ')} FROM ${tableName} WHERE id = ?`);
    const row = stmt.get(id) as Record<string, any> | null;

    if (!row) {
      return null;
    }

    // Deserialize values according to schema
    const result: Record<string, any> = {};
    for (const [columnName, columnType] of schema.columns) {
      if (row.hasOwnProperty(columnName)) {
        result[columnName] = this.deserializeValue(row[columnName], columnType);
      }
    }

    return result as T;
  }

  /**
   * Get all records from the specified table
   */
  async all<T = D>(tableName: string): Promise<T[]> {
    if (typeof tableName !== "string") {
      throw this.createError(
        `Table name must be a string, received "${typeof tableName}"`,
        ErrorKind.InvalidType
      );
    }

    const schema = this.tableSchemas.get(tableName);
    if (!schema) {
      throw this.createError(
        `Table ${tableName} does not exist or has no schema defined`,
        ErrorKind.InvalidType
      );
    }

    const columns = schema.columns.map(([name]) => name);
    const stmt = this.db.prepare(`SELECT ${columns.join(', ')} FROM ${tableName}`);
    const rows = stmt.all() as Record<string, any>[];

    return rows.map(row => {
      const result: Record<string, any> = {};
      for (const [columnName, columnType] of schema.columns) {
        if (row.hasOwnProperty(columnName)) {
          result[columnName] = this.deserializeValue(row[columnName], columnType);
        }
      }
      return result as T;
    });
  }

  /**
   * Check if a record exists in the specified table
   */
  async has(tableName: string, id: string): Promise<boolean> {
    return (await this.get(tableName, id)) !== null;
  }

  /**
   * Delete a record from the specified table
   */
  async delete(tableName: string, id: string): Promise<number> {
    if (typeof tableName !== "string") {
      throw this.createError(
        `Table name must be a string, received "${typeof tableName}"`,
        ErrorKind.InvalidType
      );
    }

    if (typeof id !== "string") {
      throw this.createError(
        `ID must be a string, received "${typeof id}"`,
        ErrorKind.InvalidType
      );
    }

    const stmt = this.db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);
    const result = stmt.run(id);

    await this.snapshot();
    
    // Replicate to mirrors
    for (const mirror of this.mirrors) {
      await mirror.delete(tableName, id);
    }

    return result.changes > 0 ? 1 : 0;
  }

  /**
   * Delete all records from the specified table
   */
  async deleteAll(tableName: string): Promise<number> {
    if (typeof tableName !== "string") {
      throw this.createError(
        `Table name must be a string, received "${typeof tableName}"`,
        ErrorKind.InvalidType
      );
    }

    const stmt = this.db.prepare(`DELETE FROM ${tableName}`);
    const result = stmt.run();

    await this.snapshot();
    
    // Replicate to mirrors
    for (const mirror of this.mirrors) {
      await mirror.deleteAll(tableName);
    }

    return result.changes;
  }

  /**
   * Find records that start with a specific prefix in their ID
   */
  async startsWith<T = D>(tableName: string, query: string): Promise<T[]> {
    if (typeof tableName !== "string") {
      throw this.createError(
        `Table name must be a string, received "${typeof tableName}"`,
        ErrorKind.InvalidType
      );
    }

    if (typeof query !== "string") {
      throw this.createError(
        `Query must be a string, received "${typeof query}"`,
        ErrorKind.InvalidType
      );
    }

    const schema = this.tableSchemas.get(tableName);
    if (!schema) {
      throw this.createError(
        `Table ${tableName} does not exist or has no schema defined`,
        ErrorKind.InvalidType
      );
    }

    const columns = schema.columns.map(([name]) => name);
    const stmt = this.db.prepare(`SELECT ${columns.join(', ')} FROM ${tableName} WHERE id LIKE ?`);
    const rows = stmt.all(`${query}%`) as Record<string, any>[];

    return rows.map(row => {
      const result: Record<string, any> = {};
      for (const [columnName, columnType] of schema.columns) {
        if (row.hasOwnProperty(columnName)) {
          result[columnName] = this.deserializeValue(row[columnName], columnType);
        }
      }
      return result as T;
    });
  }

  /**
   * Increment operation for numeric fields
   */
  async increment(tableName: string, id: string, column: string, value: number): Promise<number> {
    if (typeof tableName !== "string") {
      throw this.createError(
        `Table name must be a string, received "${typeof tableName}"`,
        ErrorKind.InvalidType
      );
    }

    const record = await this.get(tableName, id);
    if (!record) {
      throw this.createError(
        `Record with id '${id}' not found in table '${tableName}'`,
        ErrorKind.MissingValue
      );
    }

    const currentValue = (record as Record<string, any>)[column] || 0;
    if (typeof currentValue !== 'number') {
      throw this.createError(
        `Column '${column}' is not a number`,
        ErrorKind.InvalidType
      );
    }

    const newValue = currentValue + value;
    (record as Record<string, any>)[column] = newValue;
    
    await this.add(tableName, record as RowData);
    return newValue;
  }
}