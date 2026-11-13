import type { Pool } from 'pg';
import type { RequestStore } from './index.js';

export class PostgresRequestStore implements RequestStore {
  private ready: Promise<unknown>;
  constructor(private pool: Pool) {
    this.ready=pool.query('CREATE TABLE IF NOT EXISTS detailx_ts_requests(scope TEXT,kind TEXT,id TEXT,value JSONB NOT NULL,PRIMARY KEY(scope,kind,id))');
  }
  async get(scope:string,kind:string,id:string) {
    await this.ready;
    const result=await this.pool.query('SELECT value FROM detailx_ts_requests WHERE scope=$1 AND kind=$2 AND id=$3',[scope,kind,id]);
    return result.rows[0]?.value as Record<string,unknown>|undefined;
  }
  async putOnce(scope:string,kind:string,id:string,value:Record<string,unknown>) {
    await this.ready;
    const db=await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('INSERT INTO detailx_ts_requests VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[scope,kind,id,JSON.stringify(value)]);
      const result=await db.query('SELECT value FROM detailx_ts_requests WHERE scope=$1 AND kind=$2 AND id=$3',[scope,kind,id]);
      await db.query('COMMIT');
      return result.rows[0].value as Record<string,unknown>;
    } catch(error) { await db.query('ROLLBACK'); throw error; }
    finally {db.release();}
  }
  async update(scope:string,kind:string,id:string,value:Record<string,unknown>) {
    await this.ready;
    await this.pool.query('UPDATE detailx_ts_requests SET value=$1 WHERE scope=$2 AND kind=$3 AND id=$4',[JSON.stringify(value),scope,kind,id]);
  }
}
