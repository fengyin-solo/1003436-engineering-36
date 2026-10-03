import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
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

// ===== 装备详情更新 =====

// 装备详情里允许直接改的字段（状态流转仍走 runAction，不在这里开口子）。
const EQUIPMENT_EDITABLE_FIELDS = ['装备名称', '装备类型', '规格型号', '保管林场', '最近检修日']

// 检修完成登记：装备送检后检修合格、恢复可用。休整清单靠它把队伍从「装备卡住」里放出来。
export function completeEquipmentRepair(id: number, lastInspection: string): ActionResult {
  const meta = moduleMeta('equipment')
  const rows = listRows('equipment')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (String(rows[index].status) !== '待检修') {
    return { ok: false, message: `装备 ${rows[index]['装备编号']} 当前为「${rows[index].status}」，不在待检修状态，无需检修登记` }
  }
  const next = [...rows]
  next[index] = {
    ...rows[index],
    status: '可用',
    pending: true,
    abnormal: false,
    ...(lastInspection.trim() ? { 最近检修日: lastInspection.trim() } : {}),
  }
  saveRows('equipment', next)
  return { ok: true, message: `装备 ${next[index]['装备编号']} 检修完成，恢复可用` }
}

export function patchEquipment(id: number, patch: Record<string, string | number>): ActionResult {
  const meta = moduleMeta('equipment')
  const rows = listRows('equipment')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const allowed = Object.fromEntries(
    Object.entries(patch).filter(([field]) => EQUIPMENT_EDITABLE_FIELDS.includes(field)),
  )
  const next = [...rows]
  next[index] = { ...rows[index], ...allowed }
  saveRows('equipment', next)
  return { ok: true, message: `装备 ${next[index]['装备编号']} 详情已更新（${Object.keys(allowed).length} 个字段）` }
}

// ===== 队伍休整清单（跟着装备详情走） =====

export type RestChecklistItem = {
  teamId: number
  teamCode: string
  teamName: string
  teamStatus: string
  equipmentCode: string
  equipmentName: string
  equipmentType: string
  equipmentStatus: string
  lastInspection: string
  // 装备可用、最近有检修记录才算休整就绪；装备待检修/已报废会把队伍卡在休整中。
  restReady: boolean
  blockers: string[]
}

// 休整清单不是独立存的一份数据：每次都从扑火队伍 × 消防装备实时派生。
// 装备详情一变（领用/送检/报废或直接改详情），下一次取清单就是最新结果。
export function restChecklistForTeams(): RestChecklistItem[] {
  const teams = listRows('fireteam').filter((row) => String(row.status) === '休整中')
  const equipment = listRows('equipment')
  return teams.map((team) => {
    const equipmentCode = String(team['配属装备'] ?? '').trim()
    const linked = equipment.find((row) => String(row['装备编号'] ?? '') === equipmentCode)
    const blockers: string[] = []
    if (!equipmentCode) {
      blockers.push('未登记配属装备')
    } else if (!linked) {
      blockers.push(`配属装备 ${equipmentCode} 不存在`)
    } else {
      if (String(linked.status) !== '可用') {
        blockers.push(`配属装备当前为「${linked.status}」`)
      }
      if (!String(linked['最近检修日'] ?? '').trim()) {
        blockers.push('配属装备缺少最近检修日')
      }
    }
    return {
      teamId: Number(team.id),
      teamCode: String(team['队伍编号'] ?? ''),
      teamName: String(team['队伍名称'] ?? ''),
      teamStatus: String(team.status),
      equipmentCode,
      equipmentName: linked ? String(linked['装备名称'] ?? '') : '',
      equipmentType: linked ? String(linked['装备类型'] ?? '') : '',
      equipmentStatus: linked ? String(linked.status ?? '') : '',
      lastInspection: linked ? String(linked['最近检修日'] ?? '') : '',
      restReady: blockers.length === 0,
      blockers,
    }
  })
}

// ===== 总览 / 待办核对 =====

export type PendingCheckItem = {
  module: string
  name: string
  flagged: number
  recomputed: number
  consistent: boolean
}

// 待办核对：用当前模块状态标准（末状态不算待办）重算一遍 pending，和记录里标的比。
export function checkPendingFlags(): PendingCheckItem[] {
  const rows = allRows()
  return [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    const terminal = meta.statuses[meta.statuses.length - 1]
    const recomputed = entries.filter((row) => String(row.status) !== terminal).length
    const flagged = entries.filter((row) => row.pending).length
    return {
      module: meta.key,
      name: meta.name,
      flagged,
      recomputed,
      consistent: flagged === recomputed,
    }
  })
}

// 应急演练的待办清单：还没走到「已归档」的演练，按当前状态给出下一步动作。
export function drillTodos(): { id: number; code: string; theme: string; status: string; nextAction: string }[] {
  const meta = moduleMeta('drill')
  // 当前状态 -> 下一步要做的动作（状态推进链的下一个动作）。
  const nextActionByStatus: Record<string, string> = {
    待筹备: '开始筹备',
    筹备中: '完成演练',
    已实施: '提交总结',
    已总结: '归档',
  }
  return listRows('drill')
    .filter((row) => row.pending)
    .map((row) => ({
      id: Number(row.id),
      code: String(row['演练编号'] ?? ''),
      theme: String(row['演练主题'] ?? ''),
      status: String(row.status),
      nextAction: nextActionByStatus[String(row.status)] ?? '继续推进',
    }))
}
