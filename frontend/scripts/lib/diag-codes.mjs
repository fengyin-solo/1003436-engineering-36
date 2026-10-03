// 演练检查流水线诊断编号：失败时打印并写进状态文件，修复后凭编号定位问题、从失败步骤继续。
export const DIAG = {
  PREP_NODE: 'E1001', // Node 版本过低
  PREP_PACKAGE: 'E1002', // frontend/package.json 缺失
  PREP_INSTALL: 'E1003', // 前端依赖安装失败
  PREP_BUNDLE: 'E1004', // 数据层打包失败
  VALID_THEME: 'E2001', // 演练主题为空
  VALID_TEAM: 'E2002', // 参演队伍在扑火队伍模块里不存在
  VALID_EVAL: 'E2003', // 演练评价不在当前演练标准档位内
  VALID_SEED: 'E2004', // 演练示例数据形状不符（编号/字段/状态）
  VALID_IDEMPOTENT: 'E2005', // 重复装载示例数据导致演练记录增加
  VALID_MIGRATION: 'E2006', // 旧版本记录迁移结果不符合当前演练标准
  OVERVIEW_CARDS: 'E3001', // 总览卡片与明细数据对不上
  OVERVIEW_PENDING: 'E3002', // 待办/异常统计与明细数据对不上
  XMOD_REST_TEAMS: 'E4001', // 队伍休整清单缺少休整队伍或关联装备
  XMOD_GEAR_SYNC: 'E4002', // 休整清单没有跟着装备详情更新
}

export const DIAG_HINTS = {
  [DIAG.PREP_NODE]: '升级本机 Node 到 18 以上再重跑',
  [DIAG.PREP_PACKAGE]: '确认在仓库根目录执行，frontend/package.json 应存在',
  [DIAG.PREP_INSTALL]: '检查网络与 npm registry 后重跑，会从此步骤继续',
  [DIAG.PREP_BUNDLE]: '确认 node_modules 完整（esbuild 可用），或先执行 npm install',
  [DIAG.VALID_THEME]: '补齐 src/data/seed.ts 里演练记录的演练主题',
  [DIAG.VALID_TEAM]: '演练参演队伍要能在扑火队伍模块的队伍名称里找到',
  [DIAG.VALID_EVAL]: '演练评价只取当前演练标准档位（见 src/data/drill-standard.ts）',
  [DIAG.VALID_SEED]: '演练示例数据需满足编号格式 DRIL-XXXX、字段齐全、状态合法',
  [DIAG.VALID_IDEMPOTENT]: '检查 mergeSeedRows 的按编号去重逻辑',
  [DIAG.VALID_MIGRATION]: '检查 migrateModuleRows / normalizeStoredModules 的迁移逻辑',
  [DIAG.OVERVIEW_CARDS]: '检查 loadOverview 的卡片汇总口径',
  [DIAG.OVERVIEW_PENDING]: '检查 loadOverview 的待办/异常统计口径',
  [DIAG.XMOD_REST_TEAMS]: '确认扑火队伍示例数据里有休整中队伍，且所属林场与装备保管林场对齐',
  [DIAG.XMOD_GEAR_SYNC]: '检查 teamRestChecklist 是否实时引用消防装备模块数据',
}
