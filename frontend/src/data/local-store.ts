import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import { conformDrillRow } from './drill-standard'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'forest-fire-patrol:entries'

// 存储结构版本：v1 是平铺的「模块 -> 记录数组」，v2 起带版本号，方便旧版本记录兼容迁移。
export const STORAGE_VERSION = 2

type StorageShape = {
  version: number
  modules: Record<string, EntryRow[]>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function persistShape(modules: Record<string, EntryRow[]>): StorageShape {
  return { version: STORAGE_VERSION, modules }
}

// 把单个模块的记录对齐到当前模块标准：状态、pending/abnormal、字段齐全。
// 与当前标准冲突的取值（如旧版本状态）以当前标准为准，回到初始状态并标记待处理。
export function migrateModuleRows(key: string, rows: EntryRow[]): EntryRow[] {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    return rows
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  return rows.map((raw, index) => {
    const row: EntryRow = { ...raw }
    row.id = Number(row.id) > 0 ? Number(row.id) : index + 1
    const status = String(row.status ?? '')
    if (!meta.statuses.includes(status)) {
      row.status = meta.statuses[0]
      row.pending = true
    } else {
      row.status = status
      row.pending = typeof row.pending === 'boolean' ? row.pending : status !== lastStatus
    }
    row.abnormal = typeof row.abnormal === 'boolean' ? row.abnormal : false
    for (const field of meta.fields) {
      if (row[field] === undefined || row[field] === null) {
        row[field] = ''
      }
    }
    if (key === 'drill') {
      // 演练记录额外对齐当前演练标准（评价档位、必填字段）
      const { row: conformed } = conformDrillRow(row)
      return conformed
    }
    return row
  })
}

// 兼容两种存储形态：带版本号的 v2，以及旧版本平铺的模块表。
// 只保留当前登记的模块，每个模块的记录都过一遍迁移，冲突以当前标准为准。
export function normalizeStoredModules(parsed: unknown): Record<string, EntryRow[]> {
  const source =
    parsed && typeof parsed === 'object' && 'modules' in parsed
      ? (parsed as StorageShape).modules
      : (parsed as Record<string, EntryRow[]>)
  const modules: Record<string, EntryRow[]> = {}
  for (const key of Object.keys(SEED_ROWS)) {
    const rows = Array.isArray(source?.[key]) ? (source[key] as EntryRow[]) : clone(SEED_ROWS[key])
    modules[key] = migrateModuleRows(key, rows)
  }
  return modules
}

// 幂等装载示例数据：按模块首个字段（业务编号）去重，已存在的记录不动，
// 缺的补进来并重新分配 id，重复装载不会让记录变多。
export function mergeSeedRows(key: string): { rows: EntryRow[]; added: number } {
  const meta = MODULE_BY_KEY.get(key)
  const existing = listRows(key)
  if (!meta) {
    return { rows: existing, added: 0 }
  }
  const codeField = meta.fields[0]
  const seen = new Set(existing.map((row) => String(row[codeField])))
  const missing = (SEED_ROWS[key] ?? []).filter((row) => !seen.has(String(row[codeField])))
  if (missing.length === 0) {
    return { rows: existing, added: 0 }
  }
  const nextId = Math.max(0, ...existing.map((row) => Number(row.id) || 0)) + 1
  const rows = [...existing, ...missing.map((row, offset) => ({ ...clone(row), id: nextId + offset }))]
  saveRows(key, rows)
  return { rows, added: missing.length }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistShape(fallback)))
    return fallback
  }
  try {
    const modules = normalizeStoredModules(JSON.parse(raw))
    // 迁移结果回写一次，旧版本记录下次读取就是新结构了
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistShape(modules)))
    return modules
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistShape(fallback)))
    return fallback
  }
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
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistShape(next)))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
