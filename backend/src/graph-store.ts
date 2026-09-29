import { Pool } from "pg";
import { config } from "./config.js";

export interface GraphStore {
  hset(key: string, field: string, value: string): Promise<unknown>; hget(key: string, field: string): Promise<string | null>; hvals(key: string): Promise<string[]>; hdel(key: string, ...fields: string[]): Promise<unknown>; hmget(key: string, ...fields: string[]): Promise<Array<string | null>>;
  sadd(key: string, ...members: string[]): Promise<unknown>; srem(key: string, ...members: string[]): Promise<unknown>; smembers(key: string): Promise<string[]>; del(...keys: string[]): Promise<unknown>;
}

const parseKey = (key: string) => { const match = key.match(/^agentguard:repo:([^:]+):graph:(.+)$/); if (!match) throw new Error(`Invalid graph key: ${key}`); return { repo: match[1], bucket: match[2] }; };

export class PostgresGraphStore implements GraphStore {
  private readonly pool: Pool;
  private ready?: Promise<unknown>;
  constructor(connectionString = config.databaseUrl) {
    this.pool = new Pool({ connectionString });
  }
  private async query(text: string, values: unknown[] = []) { this.ready ??= this.pool.query(`CREATE TABLE IF NOT EXISTS graph_hashes (repo_id text NOT NULL, bucket text NOT NULL, field text NOT NULL, value jsonb NOT NULL, PRIMARY KEY(repo_id,bucket,field)); CREATE TABLE IF NOT EXISTS graph_sets (repo_id text NOT NULL, bucket text NOT NULL, member text NOT NULL, PRIMARY KEY(repo_id,bucket,member)); CREATE INDEX IF NOT EXISTS graph_hashes_repo_bucket ON graph_hashes(repo_id,bucket); CREATE INDEX IF NOT EXISTS graph_sets_repo_bucket ON graph_sets(repo_id,bucket)`); await this.ready; return this.pool.query(text, values); }
  async hset(key: string, field: string, value: string) { const { repo, bucket } = parseKey(key); return this.query("INSERT INTO graph_hashes VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT(repo_id,bucket,field) DO UPDATE SET value=EXCLUDED.value", [repo, bucket, field, value]); }
  async hget(key: string, field: string) { const { repo, bucket } = parseKey(key); const result = await this.query("SELECT value::text AS value FROM graph_hashes WHERE repo_id=$1 AND bucket=$2 AND field=$3", [repo, bucket, field]); return result.rows[0]?.value ?? null; }
  async hvals(key: string) { const { repo, bucket } = parseKey(key); const result = await this.query("SELECT value::text AS value FROM graph_hashes WHERE repo_id=$1 AND bucket=$2", [repo, bucket]); return result.rows.map(row => row.value); }
  async hdel(key: string, ...fields: string[]) { if (!fields.length) return; const { repo, bucket } = parseKey(key); return this.query("DELETE FROM graph_hashes WHERE repo_id=$1 AND bucket=$2 AND field=ANY($3)", [repo, bucket, fields]); }
  async hmget(key: string, ...fields: string[]) { return Promise.all(fields.map(field => this.hget(key, field))); }
  async sadd(key: string, ...members: string[]) { if (!members.length) return; const { repo, bucket } = parseKey(key); return this.query("INSERT INTO graph_sets SELECT $1,$2,unnest($3::text[]) ON CONFLICT DO NOTHING", [repo, bucket, members]); }
  async srem(key: string, ...members: string[]) { if (!members.length) return; const { repo, bucket } = parseKey(key); return this.query("DELETE FROM graph_sets WHERE repo_id=$1 AND bucket=$2 AND member=ANY($3)", [repo, bucket, members]); }
  async smembers(key: string) { const { repo, bucket } = parseKey(key); const result = await this.query("SELECT member FROM graph_sets WHERE repo_id=$1 AND bucket=$2", [repo, bucket]); return result.rows.map(row => row.member); }
  async del(...keys: string[]) { for (const key of keys) { const { repo, bucket } = parseKey(key); await Promise.all([this.query("DELETE FROM graph_hashes WHERE repo_id=$1 AND bucket=$2", [repo, bucket]), this.query("DELETE FROM graph_sets WHERE repo_id=$1 AND bucket=$2", [repo, bucket])]); } }
}

export const graphStore = new PostgresGraphStore();
