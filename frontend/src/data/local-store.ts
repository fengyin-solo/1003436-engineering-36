import { migrateEnvelope } from './migrations'
import { SEED_ROWS } from './seed'
import {
  CODE_FIELD,
  CURRENT_DATA_VERSION,
  DRILL_KEY,
  STORAGE_KEY,
  type DataEnvelope,
} from './standards'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// Node 侧（本地开发检查流水线）没有 localStorage，用 configureStorage 换内存后端。

export interface StorageBackend {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

class MemoryBackend implements StorageBackend {
  private store = new Map<string, string>()

  constructor(initial?: string | null) {
    if (initial !== null && initial !== undefined) {
      this.store.set(STORAGE_KEY, initial)
    }
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  // 测试用：直接看当前落盘内容。
  dump(): string | null {
    return this.getItem(STORAGE_KEY)
  }
}

export function createMemoryBackend(initial?: string | null): MemoryBackend & StorageBackend {
  return new MemoryBackend(initial)
}

const browserBackend: StorageBackend = {
  getItem: (key) => (typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(key) : null),
  setItem: (key, value) => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value)
    }
  },
}

let backend: StorageBackend = browserBackend

// 换掉存储后端（流水线 / 测试用）；换后端会同时清掉内存缓存。
export function configureStorage(next: StorageBackend): void {
  backend = next
  cache = null
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 幂等合并示例数据：按业务编号判重，已存在的记录一条不动，只补缺的记录和缺的模块。
// 返回新增了多少条，调用方可以据此确认「重复装载不会增加记录」。
export function mergeSeedRows(existing: Record<string, EntryRow[]>): {
  rows: Record<string, EntryRow[]>
  added: number
} {
  const next: Record<string, EntryRow[]> = {}
  let added = 0
  for (const [key, seed] of Object.entries(SEED_ROWS)) {
    const current = existing[key] ? [...existing[key]] : []
    const codeField = CODE_FIELD[key]
    const knownCodes = new Set(
      codeField ? current.map((row) => String(row[codeField] ?? '')).filter(Boolean) : [],
    )
    const usedIds = new Set(current.map((row) => Number(row.id)))
    let nextId = usedIds.size ? Math.max(...usedIds) + 1 : 1
    for (const seedRow of seed) {
      const code = codeField ? String(seedRow[codeField] ?? '') : ''
      if (code && knownCodes.has(code)) {
        continue // 同编号记录已存在：保留现有数据，不重复装载
      }
      let row = clone(seedRow)
      if (usedIds.has(Number(row.id))) {
        while (usedIds.has(nextId)) nextId += 1
        row = { ...row, id: nextId }
        nextId += 1
      }
      usedIds.add(Number(row.id))
      if (code) knownCodes.add(code)
      current.push(row)
      added += 1
    }
    next[key] = current
  }
  // 保留示例数据里没有、但用户数据里有的模块。
  for (const key of Object.keys(existing)) {
    if (!(key in next)) {
      next[key] = existing[key]
    }
  }
  return { rows: next, added }
}

function asEnvelope(raw: unknown): DataEnvelope {
  if (raw && typeof raw === 'object' && 'version' in raw && 'rows' in raw) {
    const maybe = raw as Partial<DataEnvelope>
    if (typeof maybe.version === 'number' && maybe.rows && typeof maybe.rows === 'object') {
      return { version: maybe.version, rows: maybe.rows as Record<string, EntryRow[]> }
    }
  }
  // 最老的裸结构：直接存的 Record<模块, 行数组>，按 v1 包进 envelope 再走迁移链。
  return { version: 1, rows: (raw ?? {}) as Record<string, EntryRow[]> }
}

function readStorage(): Record<string, EntryRow[]> {
  const raw = backend.getItem(STORAGE_KEY)
  if (raw === null) {
    const seeded = mergeSeedRows({}).rows
    persist(CURRENT_DATA_VERSION, seeded)
    return seeded
  }

  let envelope: DataEnvelope
  try {
    envelope = asEnvelope(JSON.parse(raw))
  } catch {
    // 落盘内容坏到无法解析：回退示例数据，避免页面白屏。
    const fallback = clone(SEED_ROWS)
    persist(CURRENT_DATA_VERSION, fallback)
    return fallback
  }

  const migrated = migrateEnvelope(envelope).envelope
  const { rows, added } = mergeSeedRows(migrated.rows)
  if (added > 0 || migrated.version !== envelope.version) {
    persist(migrated.version, rows)
  }
  return rows
}

function persist(version: number, rows: Record<string, EntryRow[]>): void {
  backend.setItem(STORAGE_KEY, JSON.stringify({ version, rows } satisfies DataEnvelope))
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  persist(CURRENT_DATA_VERSION, next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 重新执行一次「装载示例数据」：幂等，已有的记录不会被重复添加。
export function ensureSeedData(): { added: number; total: number } {
  const { rows, added } = mergeSeedRows(allRows())
  cache = rows
  if (added > 0) {
    persist(CURRENT_DATA_VERSION, rows)
  }
  return { added, total: rows[DRILL_KEY]?.length ?? 0 }
}

export function storageKey(): string {
  return STORAGE_KEY
}
