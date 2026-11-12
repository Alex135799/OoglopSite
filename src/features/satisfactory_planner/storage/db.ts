import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  CheckpointRecord,
  NormalizedSave,
  StoredSaveMeta,
} from '../domain/types';

export const PLANNER_DB_NAME = 'ooglop-planner';
const PLANNER_DB_VERSION = 2;

interface StoredSave extends StoredSaveMeta {
  blob: Blob;
}

interface StoredSession {
  id: 'current';
  model: NormalizedSave;
  updatedAt: string;
}

interface PlannerDBSchema extends DBSchema {
  saves: {
    key: string;
    value: StoredSave;
  };
  checkpoints: {
    key: string;
    value: CheckpointRecord;
    indexes: {
      'by-created': string;
      'by-save': string;
    };
  };
  sessions: {
    key: string;
    value: StoredSession;
  };
}

export interface StorageUsage {
  checkpoints: number;
  saves: number;
  bytes: number;
  quota?: number;
  usage?: number;
  percent: number;
  warning: boolean;
}

export interface SaveCheckpointInput {
  model: NormalizedSave;
  label: string;
  file?: Blob;
}

export interface CheckpointRepository {
  saveSession(model: NormalizedSave): Promise<void>;
  loadSession(): Promise<NormalizedSave | undefined>;
  clearSession(): Promise<void>;
  saveCheckpoint(input: SaveCheckpointInput): Promise<CheckpointRecord>;
  listCheckpoints(): Promise<CheckpointRecord[]>;
  getCheckpoint(id: string): Promise<CheckpointRecord | undefined>;
  deleteCheckpoint(id: string): Promise<void>;
  deleteAll(): Promise<void>;
  getUsage(): Promise<StorageUsage>;
  exportCheckpoint(id: string): Promise<string>;
  importCheckpoint(json: string): Promise<CheckpointRecord>;
  close(): Promise<void>;
}

const newId = (): string => {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  return `checkpoint-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const defaultLabel = (): string =>
  `Checkpoint ${new Date().toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`;

const isNormalizedSave = (value: unknown): value is NormalizedSave => {
  if (typeof value !== 'object' || value === null) return false;
  const model = value as Partial<NormalizedSave>;
  return (
    model.schemaVersion === 1 &&
    Array.isArray(model.buildings) &&
    Array.isArray(model.lines) &&
    Array.isArray(model.findings) &&
    typeof model.source?.sha256 === 'string' &&
    typeof model.power?.generation === 'number' &&
    typeof model.coverage?.ratio === 'number'
  );
};

export const createCheckpointRepository = (
  dbName = PLANNER_DB_NAME,
): CheckpointRepository => {
  let dbPromise: Promise<IDBPDatabase<PlannerDBSchema>> | undefined;

  const db = (): Promise<IDBPDatabase<PlannerDBSchema>> => {
    if (!dbPromise) {
      dbPromise = openDB<PlannerDBSchema>(dbName, PLANNER_DB_VERSION, {
        upgrade(database) {
          if (!database.objectStoreNames.contains('saves')) {
            database.createObjectStore('saves', { keyPath: 'hash' });
          }
          if (!database.objectStoreNames.contains('checkpoints')) {
            const checkpoints = database.createObjectStore('checkpoints', {
              keyPath: 'id',
            });
            checkpoints.createIndex('by-created', 'createdAt');
            checkpoints.createIndex('by-save', 'saveHash');
          }
          if (!database.objectStoreNames.contains('sessions')) {
            database.createObjectStore('sessions', { keyPath: 'id' });
          }
        },
      });
    }
    return dbPromise;
  };

  const saveSession = async (model: NormalizedSave): Promise<void> => {
    const database = await db();
    await database.put('sessions', {
      id: 'current',
      model,
      updatedAt: new Date().toISOString(),
    });
  };

  const loadSession = async (): Promise<NormalizedSave | undefined> => {
    const database = await db();
    const session = await database.get('sessions', 'current');
    return session?.model;
  };

  const clearSession = async (): Promise<void> => {
    const database = await db();
    await database.delete('sessions', 'current');
  };

  const saveCheckpoint = async ({
    model,
    label,
    file,
  }: SaveCheckpointInput): Promise<CheckpointRecord> => {
    const database = await db();
    const hash = model.source.sha256;

    if (file) {
      const existing = await database.get('saves', hash);
      if (!existing) {
        await database.put('saves', {
          hash,
          blob: file,
          fileName: model.source.fileName,
          size: model.source.size,
          gameVersion: model.gameDataVersion,
          importedAt: model.importedAt,
        });
      }
    }

    const record: CheckpointRecord = {
      id: newId(),
      label: label.trim() || defaultLabel(),
      createdAt: new Date().toISOString(),
      saveHash: hash,
      model,
    };
    await database.put('checkpoints', record);
    return record;
  };

  const listCheckpoints = async (): Promise<CheckpointRecord[]> => {
    const database = await db();
    const records = await database.getAllFromIndex('checkpoints', 'by-created');
    return records.reverse();
  };

  const getCheckpoint = async (id: string): Promise<CheckpointRecord | undefined> => {
    const database = await db();
    return database.get('checkpoints', id);
  };

  const deleteCheckpoint = async (id: string): Promise<void> => {
    const database = await db();
    const record = await database.get('checkpoints', id);
    if (!record) return;
    await database.delete('checkpoints', id);
    const remaining = await database.countFromIndex(
      'checkpoints',
      'by-save',
      record.saveHash,
    );
    if (remaining === 0) await database.delete('saves', record.saveHash);
  };

  const deleteAll = async (): Promise<void> => {
    const database = await db();
    await database.clear('checkpoints');
    await database.clear('saves');
  };

  const getUsage = async (): Promise<StorageUsage> => {
    const database = await db();
    const checkpoints = await database.count('checkpoints');
    const saves = await database.getAll('saves');
    const bytes = saves.reduce((total, save) => total + save.size, 0);
    let quota: number | undefined;
    let usage: number | undefined;
    try {
      const estimate = await navigator.storage?.estimate?.();
      quota = estimate?.quota;
      usage = estimate?.usage;
    } catch {
      quota = undefined;
      usage = undefined;
    }
    const denominator = quota && quota > 0 ? quota : undefined;
    const percent = denominator ? Math.min(1, (usage ?? 0) / denominator) : 0;
    return {
      checkpoints,
      saves: saves.length,
      bytes,
      ...(quota !== undefined ? { quota } : {}),
      ...(usage !== undefined ? { usage } : {}),
      percent,
      warning: checkpoints > 20 || percent > 0.8,
    };
  };

  const exportCheckpoint = async (id: string): Promise<string> => {
    const record = await getCheckpoint(id);
    if (!record) throw new Error('Checkpoint not found.');
    return JSON.stringify(
      {
        format: 'ooglop-planner-checkpoint',
        version: 1,
        label: record.label,
        createdAt: record.createdAt,
        model: record.model,
      },
      null,
      2,
    );
  };

  const importCheckpoint = async (json: string): Promise<CheckpointRecord> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('The checkpoint file is not valid JSON.');
    }
    const payload =
      typeof parsed === 'object' && parsed !== null && 'model' in parsed
        ? (parsed as { label?: unknown; model?: unknown })
        : undefined;
    const model = payload?.model ?? parsed;
    if (!isNormalizedSave(model)) {
      throw new Error('The checkpoint file does not contain a planner model.');
    }
    const label =
      typeof payload?.label === 'string' && payload.label.trim().length > 0
        ? payload.label
        : `Imported ${model.source.fileName}`;
    const record: CheckpointRecord = {
      id: newId(),
      label,
      createdAt: new Date().toISOString(),
      saveHash: model.source.sha256,
      model,
    };
    const database = await db();
    await database.put('checkpoints', record);
    return record;
  };

  const close = async (): Promise<void> => {
    const pending = dbPromise;
    dbPromise = undefined;
    if (pending) {
      const database = await pending;
      database.close();
    }
  };

  return {
    saveSession,
    loadSession,
    clearSession,
    saveCheckpoint,
    listCheckpoints,
    getCheckpoint,
    deleteCheckpoint,
    deleteAll,
    getUsage,
    exportCheckpoint,
    importCheckpoint,
    close,
  };
};

export const plannerRepository = createCheckpointRepository();

export { deleteDB };
