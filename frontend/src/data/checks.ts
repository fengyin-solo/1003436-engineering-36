// 本地开发检查流水线用的数据校验：演练主题 / 参演队伍 / 演练评价 / 示例数据。
// 这些检查只读数据，不改数据；发现的问题带稳定编号，方便失败后只重跑失败步骤。
import { listRows } from './local-store'
import { SEED_ROWS } from './seed'
import {
  CODE_FIELD,
  DRILL_CODE_FIELD,
  DRILL_EVALUATED_STATUSES,
  DRILL_EVALUATIONS,
  DRILL_KEY,
} from './standards'
import type { EntryRow } from './types'

export type CheckIssue = {
  code: string
  message: string
}

export type CheckReport = {
  ok: boolean
  issues: CheckIssue[]
  counts: Record<string, number>
}

// 参演队伍在当前数据里以「扑火队伍名称」匹配（示例数据中的队伍名）。
function knownTeamNames(): Set<string> {
  return new Set(
    listRows('fireteam')
      .map((row) => String(row['队伍名称'] ?? '').trim())
      .filter(Boolean),
  )
}

function drillLabel(row: EntryRow): string {
  return String(row[DRILL_CODE_FIELD] ?? `id=${row.id}`)
}

// 校验一场演练：主题必填、参演队伍必填且要能对上扑火队伍、
// 已实施及之后的状态必须有标准评价。
export function validateDrillRows(rows: EntryRow[] = listRows(DRILL_KEY)): CheckIssue[] {
  const issues: CheckIssue[] = []
  const teams = knownTeamNames()
  const seenCodes = new Set<string>()

  for (const row of rows) {
    const label = drillLabel(row)

    const theme = String(row['演练主题'] ?? '').trim()
    if (!theme) {
      issues.push({ code: 'DRILL-THEME-EMPTY', message: `演练 ${label} 缺少演练主题` })
    }

    const teamField = String(row['参演队伍'] ?? '').trim()
    if (!teamField) {
      issues.push({ code: 'DRILL-TEAM-EMPTY', message: `演练 ${label} 缺少参演队伍` })
    } else {
      // 参演队伍允许写多支（顿号/逗号分隔），每一支都得在扑火队伍里登记过。
      const names = teamField.split(/[、,，]/).map((name) => name.trim()).filter(Boolean)
      for (const name of names) {
        if (!teams.has(name)) {
          issues.push({
            code: 'DRILL-TEAM-UNKNOWN',
            message: `演练 ${label} 的参演队伍「${name}」在扑火队伍模块中不存在`,
          })
        }
      }
    }

    if (DRILL_EVALUATED_STATUSES.includes(String(row.status))) {
      const evaluation = String(row['演练评价'] ?? '').trim()
      if (!evaluation) {
        issues.push({ code: 'DRILL-EVAL-EMPTY', message: `演练 ${label} 已${row.status}，但缺少演练评价` })
      } else if (!DRILL_EVALUATIONS.includes(evaluation as (typeof DRILL_EVALUATIONS)[number])) {
        issues.push({
          code: 'DRILL-EVAL-NONSTANDARD',
          message: `演练 ${label} 的演练评价「${evaluation}」不在当前标准（${DRILL_EVALUATIONS.join('、')}）内`,
        })
      }
    }

    const code = String(row[DRILL_CODE_FIELD] ?? '').trim()
    if (code) {
      if (seenCodes.has(code)) {
        issues.push({ code: 'DRILL-CODE-DUP', message: `演练编号 ${code} 重复` })
      }
      seenCodes.add(code)
    }
  }
  return issues
}

// 校验示例数据：每个模块的示例记录都得带得齐业务编号，且编号不重复。
export function validateSeedRows(): CheckIssue[] {
  const issues: CheckIssue[] = []
  for (const [key, rows] of Object.entries(SEED_ROWS)) {
    const codeField = CODE_FIELD[key]
    if (!codeField) {
      issues.push({ code: 'SEED-NO-CODE-FIELD', message: `模块 ${key} 没有配置业务编号字段，无法判重` })
      continue
    }
    const seen = new Set<string>()
    for (const row of rows) {
      const code = String(row[codeField] ?? '').trim()
      if (!code) {
        issues.push({ code: 'SEED-CODE-EMPTY', message: `模块 ${key} 的 id=${row.id} 示例缺少${codeField}` })
        continue
      }
      if (seen.has(code)) {
        issues.push({ code: 'SEED-CODE-DUP', message: `模块 ${key} 的示例数据编号 ${code} 重复` })
      }
      seen.add(code)
    }
  }
  return issues
}

export function runDrillChecks(): CheckReport {
  const issues = [...validateDrillRows(), ...validateSeedRows()]
  const drills = listRows(DRILL_KEY)
  return {
    ok: issues.length === 0,
    issues,
    counts: {
      drills: drills.length,
      evaluated: drills.filter((row) =>
        DRILL_EVALUATED_STATUSES.includes(String(row.status)) &&
        DRILL_EVALUATIONS.includes(String(row['演练评价'] ?? '') as (typeof DRILL_EVALUATIONS)[number]),
      ).length,
    },
  }
}
