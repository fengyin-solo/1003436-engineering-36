import type { EntryRow } from './types'

// 当前演练标准：应急演练记录的校验、示例数据与旧版本迁移都以这份标准为准。
// 标准收紧或放宽时只改这里，校验脚本和迁移逻辑跟着走。
export const DRILL_STANDARD = {
  // 演练评价只允许这几档；旧版本记录里的其他取值一律回到默认档
  evaluations: ['未评定', '优秀', '良好', '合格', '不合格'],
  defaultEvaluation: '未评定',
  // 演练编号格式：DRIL-四位数字
  codePattern: /^DRIL-\d{4}$/,
  // 校验时不能为空的字段
  requiredFields: ['演练编号', '演练主题', '参演队伍', '演练日期'],
}

// 让一条演练记录符合当前演练标准：评价越界回默认档，必填字段补齐空串。
// 返回是否改动过，迁移时用来统计有多少条旧记录被标准覆盖。
export function conformDrillRow(row: EntryRow): { row: EntryRow; changed: boolean } {
  let changed = false
  const next: EntryRow = { ...row }
  if (!DRILL_STANDARD.evaluations.includes(String(next['演练评价'] ?? ''))) {
    next['演练评价'] = DRILL_STANDARD.defaultEvaluation
    changed = true
  }
  for (const field of DRILL_STANDARD.requiredFields) {
    if (next[field] === undefined || next[field] === null) {
      next[field] = ''
      changed = true
    }
  }
  return { row: next, changed }
}
