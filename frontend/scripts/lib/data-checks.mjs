// 演练检查流水线的数据步骤：演练数据校验、总览与待办核对、跨模块联动验证。
// 数据层由 esbuild 打包到 .check-cache/data-layer.mjs，这里按需动态引入。
import { pathToFileURL } from 'node:url'

import { DIAG } from './diag-codes.mjs'

function fail(diag, message) {
  return { ok: false, diag, message }
}

function pass(detail = '') {
  return { ok: true, detail }
}

async function layer(bundlePath) {
  return import(pathToFileURL(bundlePath).href)
}

// 步骤二：校验演练主题、参演队伍、演练评价和示例数据，
// 并验证示例数据幂等装载与旧版本记录迁移（冲突以当前演练标准为准）。
export async function runValidate({ bundlePath }) {
  const L = await layer(bundlePath)
  const meta = L.MODULE_BY_KEY.get('drill')
  const seed = L.SEED_ROWS.drill ?? []
  const standard = L.DRILL_STANDARD

  // —— 示例数据形状：编号格式、字段齐全、状态合法、id 与编号不重复 ——
  if (!meta || seed.length === 0) {
    return fail(DIAG.VALID_SEED, '演练示例数据为空或模块未登记')
  }
  const ids = new Set()
  const codes = new Set()
  for (const row of seed) {
    const code = String(row['演练编号'] ?? '')
    if (!standard.codePattern.test(code)) {
      return fail(DIAG.VALID_SEED, `演练编号「${code}」不符合格式 DRIL-XXXX`)
    }
    if (ids.has(row.id) || codes.has(code)) {
      return fail(DIAG.VALID_SEED, `演练示例数据存在重复的 id 或演练编号「${code}」`)
    }
    ids.add(row.id)
    codes.add(code)
    for (const field of meta.fields) {
      if (!(field in row)) {
        return fail(DIAG.VALID_SEED, `演练记录「${code}」缺少字段「${field}」`)
      }
    }
    if (!meta.statuses.includes(String(row.status))) {
      return fail(DIAG.VALID_SEED, `演练记录「${code}」状态「${row.status}」不在模块标准里`)
    }
    if (typeof row.pending !== 'boolean' || typeof row.abnormal !== 'boolean') {
      return fail(DIAG.VALID_SEED, `演练记录「${code}」缺少 pending/abnormal 标记`)
    }
  }

  // —— 演练主题 ——
  for (const row of seed) {
    if (String(row['演练主题'] ?? '').trim() === '') {
      return fail(DIAG.VALID_THEME, `演练记录「${row['演练编号']}」的演练主题为空`)
    }
  }

  // —— 参演队伍：必须能在扑火队伍模块里找到 ——
  const teamNames = new Set((L.SEED_ROWS.fireteam ?? []).map((row) => String(row['队伍名称'])))
  for (const row of seed) {
    const team = String(row['参演队伍'] ?? '')
    if (!teamNames.has(team)) {
      return fail(DIAG.VALID_TEAM, `演练记录「${row['演练编号']}」的参演队伍「${team}」在扑火队伍模块里不存在`)
    }
  }

  // —— 演练评价：只取当前演练标准档位 ——
  for (const row of seed) {
    const evaluation = String(row['演练评价'] ?? '')
    if (!standard.evaluations.includes(evaluation)) {
      return fail(DIAG.VALID_EVAL, `演练记录「${row['演练编号']}」的评价「${evaluation}」不在当前演练标准档位内`)
    }
  }

  // —— 示例数据幂等装载：重复装载不能增加演练记录 ——
  L.saveRows('drill', [])
  const first = L.loadSampleData('drill')
  const second = L.loadSampleData('drill')
  if (first.added !== seed.length || first.total !== seed.length) {
    L.resetRows('drill')
    return fail(DIAG.VALID_IDEMPOTENT, `首次装载示例数据应为 ${seed.length} 条，实际补了 ${first.added} 条`)
  }
  if (second.added !== 0 || second.total !== seed.length) {
    L.resetRows('drill')
    return fail(DIAG.VALID_IDEMPOTENT, `重复装载示例数据后演练记录变为 ${second.total} 条（新增 ${second.added} 条）`)
  }

  // —— 旧版本记录兼容迁移：状态/评价/缺字段冲突时以当前演练标准为准 ——
  const legacyRows = [
    {
      id: 9001,
      status: '已完成', // 旧版本状态，不在当前演练标准里
      演练编号: 'DRIL-9001',
      演练主题: '旧版森林防火演练',
      参演队伍: '旧版扑火队',
      演练日期: '2025-05-12',
      参演人数: '16',
      使用装备: '旧版灭火机',
      演练评价: '优', // 旧版本评价写法，不在当前档位
      演练状态: '已完成',
    },
    {
      id: 9002,
      status: '筹备中',
      pending: true,
      abnormal: false,
      演练编号: 'DRIL-9002',
      演练主题: '缺字段的旧演练',
      参演队伍: '旧版扑火队',
      // 缺 演练日期 / 参演人数 / 使用装备 / 演练评价 / 演练状态
    },
  ]
  const migrated = L.migrateModuleRows('drill', legacyRows)
  const [migratedLegacy, migratedSparse] = migrated
  if (migratedLegacy.status !== '待筹备' || migratedLegacy.pending !== true) {
    L.resetRows('drill')
    return fail(DIAG.VALID_MIGRATION, `旧状态「已完成」应迁移为「待筹备」并标记待处理，实际为「${migratedLegacy.status}」`)
  }
  if (migratedLegacy['演练评价'] !== standard.defaultEvaluation) {
    L.resetRows('drill')
    return fail(DIAG.VALID_MIGRATION, `旧评价「优」应按当前演练标准迁为「${standard.defaultEvaluation}」，实际为「${migratedLegacy['演练评价']}」`)
  }
  for (const field of meta.fields) {
    if (!(field in migratedSparse)) {
      L.resetRows('drill')
      return fail(DIAG.VALID_MIGRATION, `缺字段旧记录迁移后仍缺「${field}」`)
    }
  }

  // 旧版本平铺存储形态（v1，无版本号）整体迁移：缺省模块回落到示例数据
  const normalized = L.normalizeStoredModules({ drill: legacyRows })
  const moduleCount = Object.keys(L.SEED_ROWS).length
  if (Object.keys(normalized).length !== moduleCount) {
    L.resetRows('drill')
    return fail(DIAG.VALID_MIGRATION, `旧版本存储迁移后应有 ${moduleCount} 个模块，实际 ${Object.keys(normalized).length} 个`)
  }
  if (normalized.drill.length !== 2 || normalized.drill[0].status !== '待筹备') {
    L.resetRows('drill')
    return fail(DIAG.VALID_MIGRATION, '旧版本存储里的演练记录未按当前演练标准迁移')
  }
  if ((normalized.equipment ?? []).length !== (L.SEED_ROWS.equipment ?? []).length) {
    L.resetRows('drill')
    return fail(DIAG.VALID_MIGRATION, '旧版本存储缺失的模块应回落到示例数据')
  }

  L.resetRows('drill')
  return pass(`示例数据 ${seed.length} 条，主题/队伍/评价合规，幂等装载与旧版本迁移通过`)
}

// 步骤三：核对总览与待办 —— loadOverview 的卡片和各模块统计要与明细数据一致。
export async function runOverview({ bundlePath }) {
  const L = await layer(bundlePath)
  for (const key of Object.keys(L.SEED_ROWS)) {
    L.resetRows(key)
  }
  const raw = L.allRows()
  const overview = L.loadOverview()

  const totalCreated = overview.modules.reduce((sum, item) => sum + item.created, 0)
  const totalPending = overview.modules.reduce((sum, item) => sum + item.pending, 0)
  const totalAbnormal = overview.modules.reduce((sum, item) => sum + item.abnormal, 0)
  const cards = Object.fromEntries(overview.cards.map((card) => [card.label, card.value]))

  if (cards['业务模块'] !== L.MODULES.length || overview.modules.length !== L.MODULES.length) {
    return fail(DIAG.OVERVIEW_CARDS, `总览模块数 ${cards['业务模块']} 与登记的 ${L.MODULES.length} 个模块不符`)
  }
  if (cards['登记总量'] !== totalCreated) {
    return fail(DIAG.OVERVIEW_CARDS, `总览登记总量 ${cards['登记总量']} 与模块明细合计 ${totalCreated} 不符`)
  }
  if (cards['待处理'] !== totalPending || cards['异常量'] !== totalAbnormal) {
    return fail(DIAG.OVERVIEW_CARDS, '总览卡片与模块明细合计不符')
  }

  // 待办口径：逐模块对照原始记录的 pending/abnormal
  for (const item of overview.modules) {
    const meta = L.MODULES.find((entry) => entry.name === item.name)
    const rows = (meta && raw[meta.key]) || []
    const pending = rows.filter((row) => row.pending).length
    const abnormal = rows.filter((row) => row.abnormal).length
    if (item.created !== rows.length) {
      return fail(DIAG.OVERVIEW_PENDING, `模块「${item.name}」总览登记 ${item.created} 条，明细 ${rows.length} 条`)
    }
    if (item.pending !== pending) {
      return fail(DIAG.OVERVIEW_PENDING, `模块「${item.name}」待办 ${item.pending} 条，明细 ${pending} 条`)
    }
    if (item.abnormal !== abnormal) {
      return fail(DIAG.OVERVIEW_PENDING, `模块「${item.name}」异常 ${item.abnormal} 条，明细 ${abnormal} 条`)
    }
  }

  const drillMeta = L.MODULE_BY_KEY.get('drill')
  const drillPending = (raw.drill ?? []).filter((row) => row.pending).length
  return pass(`总览 ${overview.modules.length} 个模块、登记 ${totalCreated} 条；演练待办 ${drillPending} 条（${drillMeta.name}）`)
}

// 步骤四：跨模块联动 —— 扑火队伍模块的队伍休整清单要跟着消防装备模块的装备详情更新。
export async function runCrossModule({ bundlePath }) {
  const L = await layer(bundlePath)
  L.resetRows('fireteam')
  L.resetRows('equipment')

  const before = L.teamRestChecklist()
  if (before.length === 0) {
    return fail(DIAG.XMOD_REST_TEAMS, '队伍休整清单为空：扑火队伍模块没有休整中的队伍')
  }
  const item = before.find((entry) => entry.装备.length > 0)
  if (!item) {
    return fail(DIAG.XMOD_REST_TEAMS, '休整中的队伍没有关联到任何装备（按所属林场匹配保管林场）')
  }
  const gear = item.装备.find((entry) => entry.装备状态 !== '待检修') ?? item.装备[0]
  const marker = '2099-01-01'

  // 更新装备详情（最近检修日）→ 休整清单要跟着变
  const updated = L.updateEntryDetail('equipment', gear.id, { 最近检修日: marker })
  if (!updated.ok) {
    return fail(DIAG.XMOD_GEAR_SYNC, `装备详情更新失败：${updated.message}`)
  }
  const after = L.teamRestChecklist()
  const afterItem = after.find((entry) => entry.队伍编号 === item.队伍编号)
  const afterGear = afterItem?.装备.find((entry) => entry.id === gear.id)
  if (!afterGear || afterGear.最近检修日 !== marker) {
    return fail(DIAG.XMOD_GEAR_SYNC, `装备「${gear.装备编号}」检修日更新为 ${marker} 后，休整清单里仍是「${afterGear?.最近检修日 ?? '缺失'}」`)
  }

  // 装备状态流转（送检登记）→ 休整清单的装备状态与待检修数也要跟着变
  const pendingBefore = afterItem.待检修装备数
  const flowed = L.runAction('equipment', gear.id, '送检登记')
  if (!flowed.ok) {
    return fail(DIAG.XMOD_GEAR_SYNC, `装备送检登记失败：${flowed.message}`)
  }
  const finalList = L.teamRestChecklist()
  const finalItem = finalList.find((entry) => entry.队伍编号 === item.队伍编号)
  const finalGear = finalItem?.装备.find((entry) => entry.id === gear.id)
  if (!finalGear || finalGear.装备状态 !== '待检修') {
    return fail(DIAG.XMOD_GEAR_SYNC, `装备「${gear.装备编号}」送检后，休整清单里状态仍是「${finalGear?.装备状态 ?? '缺失'}」`)
  }
  if (finalItem.待检修装备数 !== pendingBefore + 1) {
    return fail(DIAG.XMOD_GEAR_SYNC, `送检后休整清单待检修装备数应为 ${pendingBefore + 1}，实际 ${finalItem.待检修装备数}`)
  }

  L.resetRows('equipment')
  L.resetRows('fireteam')
  return pass(`休整队伍「${item.队伍名称}」关联 ${item.装备.length} 件装备，装备详情与状态流转均实时同步`)
}
