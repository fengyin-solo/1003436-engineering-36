#!/usr/bin/env node
// 应急演练本地开发检查流水线（可重复执行）：
//   1) 装依赖  2) 构建前端  3) 校验演练数据  4) 核对总览与待办（含休整清单联动）
// 失败时把「诊断编号 + 失败步骤」写进检查点状态文件；修复后重跑只从失败步骤继续。
//
// 用法：
//   node scripts/dev-check.mjs            # 断点续跑（已成功的步骤跳过）
//   node scripts/dev-check.mjs --restart  # 从头重跑
//   node scripts/dev-check.mjs --only 3   # 只跑指定步骤
//   node scripts/dev-check.mjs --list     # 列出步骤与诊断编号
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'

const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTEND = join(HERE, '..')
const STATE_DIR = join(FRONTEND, 'node_modules', '.cache', 'dev-check')
const STATE_FILE = join(STATE_DIR, 'state.json')
const BUNDLE_FILE = join(STATE_DIR, 'check-core.mjs')

// 步骤定义：id 是断点编号，failureCode 是失败时对外保留的诊断编号。
const STEPS = [
  {
    id: 1,
    key: 'install',
    name: '构建前端依赖',
    failureCode: 'ENV-001',
    hint: '依赖装不上或原生包缺失：删掉 frontend/node_modules 后重新 npm install',
  },
  {
    id: 2,
    key: 'build',
    name: '前端类型检查与生产构建',
    failureCode: 'BUILD-001',
    hint: 'vue-tsc 类型错误或 vite 构建失败，按上方输出修复后重跑即可从本步继续',
  },
  {
    id: 3,
    key: 'drill',
    name: '校验演练主题 / 参演队伍 / 演练评价 / 示例数据',
    failureCode: 'DRILL-CHECK',
    hint: '看具体诊断编号（DRILL-* / SEED-* / MIG-*）修数据或迁移逻辑',
  },
  {
    id: 4,
    key: 'overview',
    name: '核对总览与待办（含队伍休整清单跟随装备详情）',
    failureCode: 'OVERVIEW-CHECK',
    hint: '看具体诊断编号（OVW-* / TODO-* / REST-*）修总览、待办或跨模块联动',
  },
]

const args = new Set(process.argv.slice(2))
if (args.has('--list')) {
  for (const step of STEPS) {
    console.log(`步骤 ${step.id} [${step.key}] ${step.name}  失败诊断编号：${step.failureCode}`)
  }
  process.exit(0)
}
const onlyArg = process.argv[process.argv.indexOf('--only') + 1]
const ONLY = args.has('--only') ? Number(onlyArg) : null
const RESTART = args.has('--restart')

function log(line) {
  console.log(line)
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { completed: [], lastFailure: null }
  }
}

function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function runNpm(argsList) {
  const result = spawnSync('npm', argsList, {
    cwd: FRONTEND,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  return { ok: result.status === 0, status: result.status }
}

// 步骤 1 额外体检：node_modules 里有没有当前平台的 rollup 原生包
//（典型故障：在别的系统装好 node_modules 拷过来，vite 一跑就 MODULE_NOT_FOUND）。
function verifyRollupBinary() {
  const candidates = process.platform === 'linux'
    ? [`@rollup/rollup-${process.platform}-${process.arch}-gnu`, `@rollup/rollup-${process.platform}-${process.arch}-musl`]
    : [`@rollup/rollup-${process.platform}-${process.arch}`]
  const found = candidates.find((pkg) => existsSync(join(FRONTEND, 'node_modules', pkg, 'package.json')))
  return found ? null : candidates[0]
}

async function bundleCheckCore() {
  await build({
    configFile: false,
    logLevel: 'warn',
    plugins: [vue()],
    resolve: {
      alias: {
        '@': join(FRONTEND, 'src'),
      },
    },
    build: {
      lib: { entry: join(FRONTEND, 'src', 'data', 'check-core.ts'), formats: ['es'], fileName: () => 'check-core.mjs' },
      outDir: STATE_DIR,
      emptyOutDir: false,
      write: true,
      rollupOptions: { external: [] },
    },
  })
}

function fail(step, code, message, extra = {}) {
  log('')
  log(`✗ 步骤 ${step.id} 失败 [诊断编号：${code}] ${step.name}`)
  log(`  原因：${message}`)
  if (step.hint) {
    log(`  建议：${step.hint}`)
  }
  const state = loadState()
  state.lastFailure = { stepId: step.id, stepKey: step.key, code, message: String(message).split('\n')[0], at: new Date().toISOString() }
  saveState(state)
  process.exitCode = 1
  return false
}

function ok(step, detail) {
  log(`✓ 步骤 ${step.id} 通过：${step.name}${detail ? `（${detail}）` : ''}`)
  const state = loadState()
  if (!state.completed.includes(step.id)) {
    state.completed.push(step.id)
  }
  // 不在中途清 lastFailure：本次续跑要把失败步及其后的步骤全部重跑完。
  state.lastSuccessAt = new Date().toISOString()
  saveState(state)
}

async function main() {
  if (RESTART) {
    rmSync(STATE_DIR, { recursive: true, force: true })
  }
  const state = loadState()
  saveState(state)

  log('应急演练本地开发检查流水线')
  log(`检查点状态：${STATE_FILE}`)
  if (state.lastFailure) {
    log(`上次失败在步骤 ${state.lastFailure.stepId}（${state.lastFailure.code}），本次从步骤 ${state.lastFailure.stepId} 继续`)
  }

  for (const step of STEPS) {
    if (ONLY !== null) {
      if (Number.isNaN(ONLY) || step.id !== ONLY) {
        continue
      }
    } else if (state.completed.includes(step.id)) {
      // 已成功的步骤跳过；但失败步及其之后的步骤要从失败处重新跑，不能跳过。
      if (state.lastFailure && step.id >= state.lastFailure.stepId) {
        log(`── 步骤 ${step.id}：${step.name}（上次失败/未完成，重新执行）`)
      } else {
        log(`→ 步骤 ${step.id} 已成功过，跳过（--restart 可强制重跑）`)
        continue
      }
    } else {
      log('')
      log(`── 步骤 ${step.id}：${step.name}`)
    }

    if (step.key === 'install') {
      // 已装且平台包齐全就不重复安装；否则按「轻量 install → 清理重装 → 显式补平台包」逐级兜底。
      let missing = verifyRollupBinary()
      if (existsSync(join(FRONTEND, 'node_modules')) && !missing) {
        ok(step, '依赖已就绪')
        continue
      }

      const first = runNpm(['install'])
      missing = verifyRollupBinary()
      if ((!first.ok || missing) && missing) {
        // npm 可选依赖 bug：stale node_modules 不会补当前平台包，清掉重装。
        log('首次安装未补全平台依赖，清理 node_modules 后重装……')
        rmSync(join(FRONTEND, 'node_modules'), { recursive: true, force: true })
        const second = runNpm(['install'])
        missing = verifyRollupBinary()
        if ((!second.ok || missing) && missing) {
          // 清理重装仍可能漏掉平台可选包（lockfile 为别的平台生成时），显式按当前平台补装。
          log(`仍缺少平台包 ${missing}，显式补装当前平台的 rollup 原生包……`)
          const third = runNpm(['install', missing, '--no-save'])
          missing = verifyRollupBinary()
          if (!third.ok || missing) {
            fail(step, step.failureCode, `依赖安装失败或仍缺少平台包 ${missing ?? ''}（退出码 ${third.status}）`)
            return
          }
        } else if (!second.ok) {
          fail(step, step.failureCode, `npm install 失败（退出码 ${second.status}）`)
          return
        }
      } else if (!first.ok) {
        fail(step, step.failureCode, `npm install 失败（退出码 ${first.status}）`)
        return
      }
      ok(step, '依赖安装完成')
      continue
    }

    if (step.key === 'build') {
      const result = runNpm(['run', 'build'])
      if (!result.ok) {
        fail(step, step.failureCode, `npm run build 失败（退出码 ${result.status}）`)
        return
      }
      ok(step, 'vue-tsc 与 vite build 均通过')
      continue
    }

    // 数据侧步骤：先打 node ESM 包（类型问题在步骤 2 已经过 vue-tsc 拦过一遍）。
    try {
      await bundleCheckCore()
    } catch (error) {
      fail(step, 'BUNDLE-001', `检查核心打包失败：${error?.message ?? error}`)
      return
    }

    const core = await import(pathToFileURL(BUNDLE_FILE).href + `?t=${Date.now()}`)

    if (step.key === 'drill') {
      try {
        const outcome = core.checkDrillData()
        for (const detail of outcome.details) {
          log(`  · ${detail}`)
        }
        ok(step, `${outcome.details.length} 项检查`)
      } catch (error) {
        fail(step, error.code || step.failureCode, error.message)
        return
      }
      continue
    }

    if (step.key === 'overview') {
      try {
        const outcome = core.checkOverviewAndTodos()
        for (const detail of outcome.details) {
          log(`  · ${detail}`)
        }
        ok(step, `${outcome.details.length} 项检查`)
      } catch (error) {
        fail(step, error.code || step.failureCode, error.message)
        return
      }
      continue
    }
  }

  if (ONLY === null) {
    const state = loadState()
    state.lastFailure = null
    saveState(state)
    log('')
    log('全部检查通过 ✓（再跑一次会直接跳过已成功步骤；--restart 可完整重跑）')
  }
}

main().catch((error) => {
  const state = loadState()
  state.lastFailure = { stepId: 0, stepKey: 'runner', code: 'RUNNER-001', message: String(error?.message ?? error).split('\n')[0], at: new Date().toISOString() }
  saveState(state)
  console.error(error)
  process.exit(1)
})
