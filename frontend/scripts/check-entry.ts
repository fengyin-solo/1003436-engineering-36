// 演练检查流水线的数据层打包入口：把检查要用的 API 从 src 重新导出，
// 由 esbuild 打成单个 ESM 文件（.check-cache/data-layer.mjs）供 scripts/lib/data-checks.mjs 动态引入。
export { MODULES, MODULE_BY_KEY } from '@/data/modules'
export { SEED_ROWS } from '@/data/seed'
export { DRILL_STANDARD } from '@/data/drill-standard'
export {
  STORAGE_VERSION,
  allRows,
  listRows,
  saveRows,
  resetRows,
  mergeSeedRows,
  migrateModuleRows,
  normalizeStoredModules,
} from '@/data/local-store'
export {
  listEntries,
  runAction,
  resetModule,
  loadOverview,
  loadSampleData,
  updateEntryDetail,
  teamRestChecklist,
} from '@/api/local-service'
