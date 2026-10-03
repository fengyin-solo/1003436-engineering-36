import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, mergeSeedRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 装载示例数据：按业务编号去重，重复调用不会增加记录，返回本次补了几条。
export function loadSampleData(key: string): { added: number; total: number } {
  const meta = moduleMeta(key)
  const { rows, added } = mergeSeedRows(meta.key)
  return { added, total: rows.length }
}

// 更新单条记录的详情字段（只允许模块标准里登记的字段），状态流转仍走 runAction。
export function updateEntryDetail(
  key: string,
  id: number,
  patch: Record<string, string>,
): ActionResult {
  const meta = moduleMeta(key)
  const entries = Object.entries(patch).filter(([field]) => meta.fields.includes(field))
  if (entries.length === 0) {
    return { ok: false, message: `${meta.entity}没有可更新的详情字段` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const updated: EntryRow = { ...rows[index] }
  for (const [field, value] of entries) {
    updated[field] = value
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}详情已更新` }
}

// 队伍休整清单：休整中的队伍 + 所属林场的装备详情。
// 清单是从消防装备模块实时算出来的，装备详情一改，清单跟着变。
export type RestChecklistItem = {
  队伍编号: string
  队伍名称: string
  所属林场: string
  装备: { id: number; 装备编号: string; 装备名称: string; 装备状态: string; 最近检修日: string }[]
  待检修装备数: number
}

export function teamRestChecklist(): RestChecklistItem[] {
  const equipment = listRows('equipment')
  return listRows('fireteam')
    .filter((team) => String(team.status) === '休整中')
    .map((team) => {
      const linked = equipment.filter(
        (item) => String(item['保管林场']) === String(team['所属林场']),
      )
      return {
        队伍编号: String(team['队伍编号'] ?? ''),
        队伍名称: String(team['队伍名称'] ?? ''),
        所属林场: String(team['所属林场'] ?? ''),
        装备: linked.map((item) => ({
          id: Number(item.id),
          装备编号: String(item['装备编号'] ?? ''),
          装备名称: String(item['装备名称'] ?? ''),
          装备状态: String(item.status ?? ''),
          最近检修日: String(item['最近检修日'] ?? ''),
        })),
        待检修装备数: linked.filter((item) => String(item.status) === '待检修').length,
      }
    })
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
