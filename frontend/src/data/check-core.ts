// 本地开发检查流水线的数据侧核心：跑在 Node 里，通过内存存储后端驱动真实的数据层。
// 由 dev-check.mjs 经 vite 打包后动态 import；不要在浏览器页面里引用。
import {
  checkPendingFlags,
  completeEquipmentRepair,
  drillTodos,
  loadOverview,
  patchEquipment,
  restChecklistForTeams,
  runAction,
} from '@/api/local-service'
import { runDrillChecks } from '@/data/checks'
import {
  configureStorage,
  createMemoryBackend,
  ensureSeedData,
  listRows,
  resetRows,
  saveRows,
} from '@/data/local-store'
import { migrateEnvelope } from '@/data/migrations'
import { DRILL_KEY } from '@/data/standards'
import type { EntryRow } from '@/data/types'

export type CheckOutcome = {
  ok: boolean
  summary: string
  details: string[]
}

function freshBackend(initial?: string | null): void {
  configureStorage(createMemoryBackend(initial ?? null))
}

function assert(condition: boolean, code: string, message: string): void {
  if (!condition) {
    const error = new Error(message) as Error & { code: string }
    error.code = code
    throw error
  }
}

// 步骤 3：演练主题 / 参演队伍 / 演练评价 + 示例数据 + 幂等播种 + 旧版本迁移。
export function checkDrillData(): CheckOutcome {
  const details: string[] = []

  // 3.1 空存储首次读取：数据层应自动装上全部示例数据。
  freshBackend(null)
  const seededDrillCount = listRows(DRILL_KEY).length
  assert(seededDrillCount > 0, 'SEED-001', '空存储首次读取没有自动装载示例数据')
  const firstLoad = ensureSeedData()
  assert(firstLoad.added === 0 && firstLoad.total === seededDrillCount, 'SEED-001', '已播种数据被再次装载时发生变化')
  details.push(`首次读取自动装载示例数据：演练 ${seededDrillCount} 场`)

  // 3.2 重复装载必须幂等：一条演练记录都不能多出来。
  const drillCountBefore = listRows(DRILL_KEY).length
  const secondLoad = ensureSeedData()
  const drillCountAfter = listRows(DRILL_KEY).length
  assert(secondLoad.added === 0, 'SEED-002', `重复装载示例数据多写了 ${secondLoad.added} 条记录`)
  assert(
    drillCountBefore === drillCountAfter,
    'SEED-002',
    `重复装载使演练记录从 ${drillCountBefore} 条变成 ${drillCountAfter} 条`,
  )
  details.push(`再次装载示例数据：新增 ${secondLoad.added} 条，演练记录数保持 ${drillCountAfter} 场`)

  // 3.2b 用户删掉一条演练示例后再装载：只把缺的那条补回来，已有的不重复；
  //     连续装两次，第二次必须 0 新增。
  const withOneRemoved = listRows(DRILL_KEY).filter((row) => String(row['演练编号']) !== 'DRIL-2026-002')
  saveRows(DRILL_KEY, withOneRemoved)
  const refill = ensureSeedData()
  assert(refill.added === 1, 'SEED-002', `补缺装载应只补回 1 条，实际新增 ${refill.added} 条`)
  const refillAgain = ensureSeedData()
  assert(refillAgain.added === 0, 'SEED-002', `补完后再次装载应 0 新增，实际新增 ${refillAgain.added} 条`)
  assert(listRows(DRILL_KEY).length === drillCountAfter, 'SEED-002', '补缺装载后演练总数与初始不一致')
  details.push('删掉一条示例再装载：只补缺失记录，连续重复装载不新增')

  // 3.3 当前标准下的演练数据校验：主题 / 参演队伍 / 评价。
  const report = runDrillChecks()
  if (!report.ok) {
    const first = report.issues[0]
    assert(false, first.code, `${first.message}（共 ${report.issues.length} 个问题）`)
  }
  details.push(`演练数据校验通过：${report.counts.drills} 场演练，${report.counts.evaluated} 场已带标准评价`)

  // 3.4 旧版本记录兼容迁移：v1 数据 + 旧字段名 / 旧状态 / 非标准评价 / 缺评价。
  const legacyDrills: EntryRow[] = [
    {
      id: 101,
      status: '演练完毕', // 旧状态，应归并为「已实施」
      pending: true,
      abnormal: false,
      演练编号: 'DRIL-OLD-001',
      演练题目: '旧版地表火演练', // 旧字段名 → 演练主题
      参与队伍: '青山林场扑火一队', // 旧字段名 → 参演队伍
      演练日期: '2026-05-10',
      参演人数: 24,
      使用装备: '风力灭火机',
      演练评分: '优', // 旧字段 + 非标准评价 → 演练评价按标准归一
      演练状态: '已结束',
    },
    {
      id: 102,
      status: '已评价', // 旧状态，应归并为「已总结」
      pending: true,
      abnormal: false,
      演练编号: 'DRIL-OLD-002',
      演练题目: '旧版联防演练',
      参与队伍: '青松林场扑火二队',
      演练日期: '2026-04-02',
      参演人数: 20,
      使用装备: '油锯',
      // 缺演练评价：迁移后应按当前标准补「合格」
      演练状态: '已评价',
    },
  ]
  const legacyRaw = JSON.stringify({ version: 1, rows: { drill: legacyDrills } })
  const migrated = migrateEnvelope(JSON.parse(legacyRaw))
  const rows = migrated.envelope.rows[DRILL_KEY]
  assert(migrated.fromVersion === 1, 'MIG-001', '旧版本数据没有被识别为 v1')
  const old1 = rows.find((row) => row.id === 101)
  const old2 = rows.find((row) => row.id === 102)
  assert(old1?.status === '已实施', 'MIG-002', `旧状态「演练完毕」未归并为「已实施」，实际为「${old1?.status}」`)
  assert(String(old1?.['演练主题']) === '旧版地表火演练', 'MIG-003', '旧字段「演练题目」未迁移到「演练主题」')
  assert(String(old1?.['参演队伍']) === '青山林场扑火一队', 'MIG-003', '旧字段「参与队伍」未迁移到「参演队伍」')
  assert(old1?.['演练评分'] === undefined, 'MIG-003', '旧字段「演练评分」迁移后仍然残留')
  assert(['优秀', '良好', '合格', '不合格'].includes(String(old1?.['演练评价'])), 'MIG-004', '非标准演练评价未按当前标准归一')
  assert(old2?.status === '已总结', 'MIG-002', `旧状态「已评价」未归并为「已总结」，实际为「${old2?.status}」`)
  assert(String(old2?.['演练评价']) === '合格', 'MIG-004', '已评价旧记录缺评价时未按当前标准补「合格」')

  // 迁移必须幂等：再迁一遍结果不变。
  const again = migrateEnvelope(migrated.envelope)
  assert(
    JSON.stringify(again.envelope.rows[DRILL_KEY]) === JSON.stringify(rows),
    'MIG-005',
    '迁移不幂等：对已迁移数据再迁一次结果发生变化',
  )
  details.push(`旧版本记录迁移通过：v1 → v2，归一 ${migrated.notes.length} 项（${migrated.notes.slice(0, 2).join('；')}）`)

  // 3.5 经存储层读取旧记录：同样要按当前演练标准归一（迁移链接在读取路径上）。
  freshBackend(legacyRaw)
  const migratedLive = listRows(DRILL_KEY).find((row) => row.id === 101)
  assert(migratedLive?.status === '已实施', 'MIG-006', '经存储层读取的旧记录未按当前标准归一状态')
  assert(['优秀', '良好', '合格', '不合格'].includes(String(migratedLive?.['演练评价'])), 'MIG-006', '经存储层读取的旧记录未按当前标准归一评价')
  details.push('经存储层读取旧记录：状态与评价均以当前演练标准为准')

  // 3.6 演练模块重置后仍应满足当前标准校验（reset 走的是当前示例数据）。
  resetRows(DRILL_KEY)
  const resetReport = runDrillChecks()
  assert(resetReport.ok, 'SEED-003', `重置后的演练示例数据不达标：${resetReport.issues[0]?.message ?? ''}`)
  details.push('演练模块重置后重新校验通过')

  return { ok: true, summary: `演练数据检查通过（${details.length} 项）`, details }
}

// 步骤 4：总览与待办核对 + 跨模块的队伍休整清单跟随装备详情更新。
export function checkOverviewAndTodos(): CheckOutcome {
  const details: string[] = []

  // 用干净的当前标准数据做总览核对。
  freshBackend(null)

  // 4.1 总览卡片：登记总量 / 待处理 = 各模块数字之和。
  const overview = loadOverview()
  const sumByModule = overview.modules.reduce((sum, item) => sum + item.created, 0)
  const totalCard = overview.cards.find((card) => card.label === '登记总量')
  assert(totalCard?.value === sumByModule, 'OVW-001', `总览「登记总量」${totalCard?.value} 与各模块合计 ${sumByModule} 不一致`)
  const pendingCard = overview.cards.find((card) => card.label === '待处理')
  const pendingSum = overview.modules.reduce((sum, item) => sum + item.pending, 0)
  assert(pendingCard?.value === pendingSum, 'OVW-001', `总览「待处理」${pendingCard?.value} 与各模块合计 ${pendingSum} 不一致`)
  details.push(`总览卡片核对通过：登记总量 ${sumByModule}，待处理 ${pendingSum}`)

  // 4.2 待办标记一致性：按当前状态标准重算 pending，要和记录里标的一致。
  const pendingChecks = checkPendingFlags()
  const inconsistent = pendingChecks.filter((item) => !item.consistent)
  assert(
    inconsistent.length === 0,
    'TODO-001',
    `待办标记与状态标准不一致：${inconsistent.map((item) => `${item.name}(${item.flagged}/${item.recomputed})`).join('、')}`,
  )
  details.push(`待办标记核对通过：${pendingChecks.length} 个模块的 pending 与状态标准一致`)

  // 4.3 演练待办：所有 pending 演练都要列出来，并带下一步动作。
  const todos = drillTodos()
  const expectedTodoCount = listRows(DRILL_KEY).filter((row) => row.pending).length
  assert(todos.length === expectedTodoCount, 'TODO-002', `演练待办 ${todos.length} 条与待办演练数 ${expectedTodoCount} 不一致`)
  assert(todos.every((todo) => todo.nextAction), 'TODO-002', '存在没有下一步动作的演练待办')
  details.push(`演练待办核对通过：${todos.length} 场待推进演练，均带下一步动作`)

  // 4.4 跨模块：队伍休整清单跟着装备详情更新。
  // 红枫林场扑火四队（休整中）配属 EQUI-0004，种子数据里它「待检修」，休整应被卡住。
  const before = restChecklistForTeams()
  const team4 = before.find((item) => item.teamCode === 'TEAM-0004')
  assert(team4 !== undefined, 'REST-001', '休整中的红枫林场扑火四队没有出现在休整清单')
  assert(team4?.restReady === false, 'REST-002', '配属装备待检修时休整清单却显示就绪')
  assert(team4?.equipmentStatus === '待检修', 'REST-002', '休整清单没有带出配属装备的当前状态')
  details.push(`休整清单初始：${team4?.teamName} 因装备「${team4?.equipmentStatus}」暂不能结束休整`)

  // 更新装备详情：检修日跟着清单变；状态仍是待检修，继续阻断。
  const equipId = listRows('equipment').find((row) => String(row['装备编号']) === 'EQUI-0004')?.id as number
  const patch = patchEquipment(equipId, { 最近检修日: '2026-10-02' })
  assert(patch.ok, 'REST-003', `更新装备详情失败：${patch.message}`)
  const afterPatch = restChecklistForTeams().find((item) => item.teamCode === 'TEAM-0004')
  assert(afterPatch?.lastInspection === '2026-10-02', 'REST-003', '装备详情更新后，休整清单里的最近检修日没有跟着更新')
  assert(afterPatch?.restReady === false, 'REST-003', '装备仍在待检修，休整清单不应就绪')
  details.push('装备检修日更新后，休整清单同步带出最新检修日，状态仍阻断休整')

  // 检修完成、装备恢复可用：清单必须立刻就绪（不存第二份快照，全部现场派生）。
  const repaired = completeEquipmentRepair(equipId, '2026-10-02')
  assert(repaired.ok, 'REST-004', `装备检修完成登记失败：${repaired.message}`)
  const afterRepair = restChecklistForTeams().find((item) => item.teamCode === 'TEAM-0004')
  assert(afterRepair?.equipmentStatus === '可用', 'REST-004', `装备恢复可用后清单仍显示「${afterRepair?.equipmentStatus ?? '未知'}」`)
  assert(afterRepair?.restReady === true, 'REST-004', `装备恢复可用后休整仍未就绪：${afterRepair?.blockers.join('、') ?? '队伍不在休整清单'}`)
  details.push('装备检修完成恢复可用后，休整清单立即就绪，无阻断项')

  // 再把装备送检：清单要再次跟着变，证明不是缓存。
  const reinspect = runAction('equipment', equipId, '送检登记')
  assert(reinspect.ok, 'REST-005', `装备再次送检登记失败：${reinspect.message}`)
  const afterReinspect = restChecklistForTeams().find((item) => item.teamCode === 'TEAM-0004')
  assert(afterReinspect?.equipmentStatus === '待检修' && afterReinspect?.restReady === false, 'REST-005', '装备再次送检后休整清单没有跟随更新')
  details.push('装备再次送检后，休整清单立刻重新变为阻断状态（实时派生、无缓存）')

  return { ok: true, summary: `总览与待办核对通过（${details.length} 项）`, details }
}
