// 旧版本记录的兼容迁移：按版本号一步步往前挪，每一步都把数据向「当前标准」归一。
// 迁移规则只描述从旧到新的差异；迁移本身幂等，可以对已经是最新的数据反复执行。
import { MODULE_BY_KEY } from './modules'
import {
  CURRENT_DATA_VERSION,
  DRILL_DEFAULT_EVALUATION,
  DRILL_EVALUATIONS,
  DRILL_EVALUATED_STATUSES,
  DRILL_FIELD_RENAMES,
  DRILL_KEY,
  DRILL_STATUS_RENAMES,
  type DataEnvelope,
} from './standards'
import type { EntryRow } from './types'

export type StepResult = {
  envelope: DataEnvelope
  notes: string[]
}

export type MigrateResult = {
  envelope: DataEnvelope
  fromVersion: number
  notes: string[]
}

function normalizeDrillRow(row: EntryRow, notes: string[]): EntryRow {
  const next: EntryRow = { ...row }

  // 1) 旧字段名改到当前字段名；新字段已有值时以当前值为准，旧值只做补缺。
  for (const [legacyField, currentField] of Object.entries(DRILL_FIELD_RENAMES)) {
    if (legacyField in next) {
      const legacyValue = next[legacyField]
      delete next[legacyField]
      if (next[currentField] === undefined || next[currentField] === '') {
        next[currentField] = legacyValue
        notes.push(`字段「${legacyField}」改名为「${currentField}」`)
      } else {
        notes.push(`字段「${legacyField}」与「${currentField}」冲突，以当前标准字段为准`)
      }
    }
  }

  // 2) 旧状态归并到当前标准状态；不在标准状态集里的状态一律按映射归一。
  const meta = MODULE_BY_KEY.get(DRILL_KEY)
  const standardStatuses = meta ? meta.statuses : []
  const renamed = DRILL_STATUS_RENAMES[String(next.status)]
  if (renamed) {
    notes.push(`状态「${next.status}」按当前标准归并为「${renamed}」`)
    next.status = renamed
  } else if (meta && !standardStatuses.includes(String(next.status))) {
    notes.push(`状态「${next.status}」不在当前标准中，回退为「${meta.statuses[0]}」`)
    next.status = meta.statuses[0]
  }

  // 3) 已实施之后的记录必须有标准评价；缺评价或评价非标准时，按当前标准归一。
  if (DRILL_EVALUATED_STATUSES.includes(String(next.status))) {
    const evaluation = String(next['演练评价'] ?? '')
    if (!evaluation) {
      next['演练评价'] = DRILL_DEFAULT_EVALUATION
      notes.push(`演练 ${next['演练编号'] ?? next.id} 缺少演练评价，按当前标准补为「${DRILL_DEFAULT_EVALUATION}」`)
    } else if (!DRILL_EVALUATIONS.includes(evaluation as (typeof DRILL_EVALUATIONS)[number])) {
      next['演练评价'] = DRILL_DEFAULT_EVALUATION
      notes.push(`演练评价「${evaluation}」不在当前标准中，归一为「${DRILL_DEFAULT_EVALUATION}」`)
    }
  }

  // 4) pending 以当前标准重算：最后一个状态（已归档）不再待办，其余都是待办。
  if (meta) {
    const terminal = meta.statuses[meta.statuses.length - 1]
    next.pending = next.status !== terminal
  }
  return next
}

// v1 → v2：演练旧字段改名（演练题目/参与队伍/演练评分）、旧状态与旧评价归并到当前标准。
function migrateV1ToV2(envelope: DataEnvelope): StepResult {
  const notes: string[] = []
  const drills = (envelope.rows[DRILL_KEY] ?? []).map((row) => normalizeDrillRow(row, notes))
  return { envelope: { ...envelope, rows: { ...envelope.rows, [DRILL_KEY]: drills } }, notes }
}

// version -> 升到下一版的迁移。裸结构（version 0）在读取处先包成 envelope，再从 v1 开始迁。
const STEPS: Record<number, (envelope: DataEnvelope) => StepResult> = {
  1: migrateV1ToV2,
}

export function migrateEnvelope(input: DataEnvelope): MigrateResult {
  const fromVersion = input.version
  let envelope = input
  const notes: string[] = []

  while (envelope.version < CURRENT_DATA_VERSION) {
    const step = STEPS[envelope.version]
    if (!step) {
      throw new Error(`缺少数据版本 v${envelope.version} 的迁移，无法升到 v${CURRENT_DATA_VERSION}`)
    }
    const result = step(envelope)
    envelope = { ...result.envelope, version: envelope.version + 1 }
    notes.push(...result.notes)
  }

  // 已经是最新版也跑一遍归一：老版本记录即使漏过迁移，读取时仍会向当前标准看齐。
  if (fromVersion === CURRENT_DATA_VERSION) {
    envelope = {
      version: CURRENT_DATA_VERSION,
      rows: { ...envelope.rows, [DRILL_KEY]: (envelope.rows[DRILL_KEY] ?? []).map((row) => normalizeDrillRow(row, notes)) },
    }
  }

  return { envelope, fromVersion, notes }
}
