// 本地数据的「当前标准」：版本号、字段名、状态集、评价集都以这里为准。
// 旧版本记录迁移、示例数据合并发生冲突时，统一向这份标准看齐。
import type { EntryRow } from './types'

export const STORAGE_KEY = 'forest-fire-patrol:entries'

// 存储 envelope 版本：结构 / 标准变更就 +1，并在 MIGRATIONS 里补一条迁移。
// undefined 表示最老的裸结构：localStorage 里直接存的 Record<模块, EntryRow[]>。
export const CURRENT_DATA_VERSION = 2

export type DataEnvelope = {
  version: number
  rows: Record<string, EntryRow[]>
}

// 每个模块取「业务编号」字段的规则：示例数据合并时按它判重，避免重复装载。
export const CODE_FIELD: Record<string, string> = {
  patrol: '任务编号',
  firewatch: '监测点编号',
  lookout: '瞭望台编号',
  firebreak: '隔离带编号',
  fireteam: '队伍编号',
  equipment: '装备编号',
  weather: '记录编号',
  firereport: '报告编号',
  drone: '任务编号',
  campaign: '活动编号',
  checkpoint: '站点编号',
  duty: '排班编号',
  supply: '物资编号',
  forestroad: '道路编号',
  firebelt: '林带编号',
  drill: '演练编号',
  burnpermit: '审批编号',
  treegrowth: '记录编号',
}

// ===== 应急演练（drill）的当前标准 =====
export const DRILL_KEY = 'drill'
export const DRILL_CODE_FIELD = '演练编号'

// 老版本字段名 → 当前字段名。
export const DRILL_FIELD_RENAMES: Record<string, string> = {
  演练题目: '演练主题',
  参与队伍: '参演队伍',
  演练评分: '演练评价',
}

// 老版本状态 → 当前标准状态（modules.ts drill.statuses）。
// 冲突时一律落到当前标准：同义旧状态归并到对应的现行状态。
export const DRILL_STATUS_RENAMES: Record<string, string> = {
  待安排: '待筹备',
  筹备: '筹备中',
  演练完毕: '已实施',
  已完成: '已实施',
  已评价: '已总结',
}

// 当前演练标准允许的评价；没有评价时按「合格」补齐。
export const DRILL_EVALUATIONS = ['优秀', '良好', '合格', '不合格'] as const
export const DRILL_DEFAULT_EVALUATION = '合格'

// 已实施之后的状态必须有演练评价（校验规则）。
export const DRILL_EVALUATED_STATUSES = ['已实施', '已总结', '已归档']
