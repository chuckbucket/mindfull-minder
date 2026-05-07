import * as SQLite from 'expo-sqlite';

// 'note' is legacy; normalize to 'log' on read.
export type MinderEventKind = 'log' | 'note' | 'completed' | 'missed' | 'triggered';
export type Mood = 'good' | 'neutral' | 'bad';

export type MinderEvent = {
  id: string;
  minderId: string;
  kind: MinderEventKind;
  at: number; // unix ms timestamp of the event
  text?: string;
  triggerAt?: number; // unix ms timestamp for scheduled trigger related to event
  mood?: Mood;
};

type EventRow = {
  id: string;
  minderId: string;
  kind: string;
  at: number;
  text: string | null;
  triggerAt: number | null;
  mood: string | null;
};

let _db: SQLite.SQLiteDatabase | null = null;

const getDb = async (): Promise<SQLite.SQLiteDatabase> => {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('mindfull_minder.db');
  await _db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS minder_events (
      id TEXT PRIMARY KEY,
      minderId TEXT NOT NULL,
      kind TEXT NOT NULL,
      at INTEGER NOT NULL,
      text TEXT,
      triggerAt INTEGER,
      mood TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_me_minder ON minder_events (minderId);
    CREATE INDEX IF NOT EXISTS idx_me_at ON minder_events (at);
  `);
  return _db;
};

const rowToEvent = (row: EventRow): MinderEvent => ({
  id: row.id,
  minderId: row.minderId,
  kind: row.kind === 'note' ? 'log' : (row.kind as MinderEventKind),
  at: row.at,
  text: row.text ?? undefined,
  triggerAt: row.triggerAt ?? undefined,
  mood: (row.mood as Mood | null) ?? undefined,
});

export const getAllMinderEvents = async (): Promise<MinderEvent[]> => {
  const db = await getDb();
  const rows = await db.getAllAsync<EventRow>('SELECT * FROM minder_events ORDER BY at DESC');
  return rows.map(rowToEvent);
};

export const getEventsForMinder = async (minderId: string): Promise<MinderEvent[]> => {
  const db = await getDb();
  const rows = await db.getAllAsync<EventRow>(
    'SELECT * FROM minder_events WHERE minderId = ? ORDER BY at DESC',
    minderId,
  );
  return rows.map(rowToEvent);
};

export const addMinderEvent = async (event: Omit<MinderEvent, 'id'> & { id?: string }): Promise<string> => {
  const db = await getDb();
  const id = event.id ?? `${Date.now()}-${Math.random()}`;
  await db.runAsync(
    'INSERT OR IGNORE INTO minder_events (id, minderId, kind, at, text, triggerAt, mood) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, event.minderId, event.kind, event.at, event.text ?? null, event.triggerAt ?? null, event.mood ?? null,
  );
  return id;
};

export const deleteEventsForMinder = async (minderId: string): Promise<void> => {
  const db = await getDb();
  await db.runAsync('DELETE FROM minder_events WHERE minderId = ?', minderId);
};

export const upsertMissedEvents = async (minderId: string, triggerAts: number[]): Promise<void> => {
  if (triggerAts.length === 0) return;
  const db = await getDb();
  for (const triggerAt of triggerAts) {
    const id = `missed:${minderId}:${triggerAt}`;
    await db.runAsync(
      'INSERT OR IGNORE INTO minder_events (id, minderId, kind, at, text, triggerAt, mood) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, minderId, 'missed', triggerAt, null, triggerAt, null,
    );
  }
};

export const clearAllMinderEvents = async (): Promise<void> => {
  const db = await getDb();
  await db.runAsync('DELETE FROM minder_events');
};
