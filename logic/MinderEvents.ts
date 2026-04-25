import AsyncStorage from '@react-native-async-storage/async-storage';

const EVENTS_STORAGE_KEY = '@minderEvents';

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

const normalizeEvent = (event: any): MinderEvent | null => {
  if (!event || typeof event !== 'object') return null;
  if (typeof event.id !== 'string') return null;
  if (typeof event.minderId !== 'string') return null;
  if (typeof event.kind !== 'string') return null;
  if (typeof event.at !== 'number') return null;

  const kind = event.kind === 'note' ? 'log' : event.kind;
  if (kind !== 'log' && kind !== 'completed' && kind !== 'missed' && kind !== 'triggered') return null;

  const mood = event.mood;
  const normalizedMood: Mood | undefined =
    mood === 'good' || mood === 'neutral' || mood === 'bad' ? (mood as Mood) : undefined;

  return {
    id: event.id,
    minderId: event.minderId,
    kind,
    at: event.at,
    text: typeof event.text === 'string' ? event.text : undefined,
    triggerAt: typeof event.triggerAt === 'number' ? event.triggerAt : undefined,
    mood: normalizedMood,
  };
};

const readAll = async (): Promise<MinderEvent[]> => {
  const raw = await AsyncStorage.getItem(EVENTS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEvent).filter(Boolean) as MinderEvent[];
  } catch {
    return [];
  }
};

const writeAll = async (events: MinderEvent[]) => {
  await AsyncStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
};

export const getAllMinderEvents = async () => readAll();

export const getEventsForMinder = async (minderId: string) => {
  const all = await readAll();
  return all.filter(e => e.minderId === minderId).sort((a, b) => b.at - a.at);
};

export const addMinderEvent = async (event: Omit<MinderEvent, 'id'> & { id?: string }) => {
  const all = await readAll();
  const id = event.id || `${Date.now()}-${Math.random()}`;
  if (event.id && all.some(e => e.id === id)) return id;
  all.push({ ...event, id });
  await writeAll(all);
  return id;
};

export const upsertMissedEvents = async (minderId: string, triggerAts: number[]) => {
  const all = await readAll();
  const existing = new Set(
    all.filter(e => e.minderId === minderId && e.kind === 'missed' && typeof e.triggerAt === 'number').map(e => e.id),
  );

  let changed = false;
  for (const triggerAt of triggerAts) {
    const id = `missed:${minderId}:${triggerAt}`;
    if (existing.has(id)) continue;
    all.push({
      id,
      minderId,
      kind: 'missed',
      at: triggerAt,
      triggerAt,
    });
    changed = true;
  }

  if (changed) {
    await writeAll(all);
  }
};
