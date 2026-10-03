#!/usr/bin/env node
// 应急演练本地开发检查流水线（可重复执行）：
//   1. prepare       环境准备：构建前端依赖
//   2. validate      校验演练主题、参演队伍、演练评价和示例数据（含幂等装载、旧版本迁移）
//   3. overview      核对总览与待办
//   4. cross-module  验证扑火队伍模块的休整清单跟着装备详情更新
//
// 任一步骤失败都会把诊断编号写进 frontend/.drill-check-state.json；
// 修复后直接重跑只会从失败步骤继续，加 --fresh 才从头跑。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DIAG, DIAG_HINTS } from './lib/diag-codes.mjs'
import { runCrossModule, runOverview, runValidate } from './lib/data-checks.mjs'

const frontendDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(frontendDir, '.check-cache')
const bundlePath = join(cacheDir, 'data-layer.mjs')
const statePath = join(frontendDir, '.drill-check-state.json')

function readState() {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return null
  }
}

function writeState(state) {
  writeFileSync(statePath, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2))
}

function clearState() {
  rmSync(statePath, { force: true })
}

// 每次运行都重新打包数据层：断点续跑时也能跑到刚修好的代码。
function ensureBundle() {
  mkdirSync(cacheDir, { recursive: true })
  const esbuildBin = join(frontendDir, 'node_modules', '.bin', 'esbuild')
  if (!existsSync(esbuildBin)) {
    return { ok: false, diag: DIAG.PREP_BUNDLE, message: '找不到 esbuild，前端依赖尚未安装' }
  }
  const result = spawnSync(
    esbuildBin,
    [
      join(frontendDir, 'scripts', 'check-entry.ts'),
      '--bundle',
      '--format=esm',
      '--platform=node',
      `--outfile=${bundlePath}`,
      '--alias:@=./src',
      '--log-level=warning',
    ],
    { cwd: frontendDir, encoding: 'utf8' },
  )
  if (result.status !== 0) {
    return {
      ok: false,
      diag: DIAG.PREP_BUNDLE,
      message: `数据层打包失败：${(result.stderr || result.stdout || '').trim()}`,
    }
  }
  return { ok: true }
}

// 步骤一：环境准备 —— Node 版本、package.json、前端依赖（缺失时才 npm install）。
function runPrepare() {
  const [major] = process.versions.node.split('.').map(Number)
  if (major < 18) {
    return { ok: false, diag: DIAG.PREP_NODE, message: `Node 版本 ${process.versions.node} 过低，需要 18 以上` }
  }
  if (!existsSync(join(frontendDir, 'package.json'))) {
    return { ok: false, diag: DIAG.PREP_PACKAGE, message: '缺少 frontend/package.json' }
  }
  const esbuildBin = join(frontendDir, 'node_modules', '.bin', 'esbuild')
  const needInstall = process.env.DRILL_CHECK_INSTALL === 'always' || !existsSync(esbuildBin)
  if (needInstall) {
    console.log('  · 安装前端依赖（npm install）…')
    const install = spawnSync('npm', ['install'], { cwd: frontendDir, stdio: 'inherit' })
    if (install.status !== 0) {
      return { ok: false, diag: DIAG.PREP_INSTALL, message: 'npm install 执行失败' }
    }
  }
  if (!existsSync(esbuildBin)) {
    return { ok: false, diag: DIAG.PREP_INSTALL, message: '依赖安装后仍找不到 esbuild' }
  }
  return { ok: true, detail: needInstall ? '依赖已安装' : '依赖已就绪，跳过安装' }
}

const STEPS = [
  { id: 'prepare', label: '环境准备（构建前端依赖）', run: runPrepare },
  { id: 'validate', label: '演练数据校验（主题/队伍/评价/示例数据）', run: runValidate },
  { id: 'overview', label: '总览与待办核对', run: runOverview },
  { id: 'cross-module', label: '跨模块联动（休整清单跟随装备详情）', run: runCrossModule },
]

async function main() {
  const fresh = process.argv.includes('--fresh')
  if (fresh) {
    clearState()
  }
  const state = fresh ? null : readState()

  let startIndex = 0
  if (state?.failedStep) {
    const index = STEPS.findIndex((step) => step.id === state.failedStep)
    if (index >= 0) {
      startIndex = index
      console.log(`检测到上次失败：步骤「${STEPS[index].label}」，诊断编号 ${state.diag}`)
      console.log('本次从失败步骤继续（从头跑请加 --fresh）\n')
    }
  }

  // 预检：数据层打包。失败记到环境准备头上，因为它是跑数据步骤的前提。
  const bundle = ensureBundle()
  if (!bundle.ok) {
    const failedStep = startIndex === 0 ? 'prepare' : STEPS[startIndex].id
    writeState({ failedStep, diag: bundle.diag, message: bundle.message })
    reportFailure(1, STEPS.find((s) => s.id === failedStep), bundle)
    process.exit(1)
  }

  for (let i = startIndex; i < STEPS.length; i += 1) {
    const step = STEPS[i]
    console.log(`[${i + 1}/${STEPS.length}] ${step.label}`)
    const startedAt = Date.now()
    let result
    try {
      result = await step.run({ bundlePath, frontendDir })
    } catch (error) {
      result = { ok: false, diag: 'E9999', message: error instanceof Error ? error.message : String(error) }
    }
    if (!result?.ok) {
      writeState({ failedStep: step.id, diag: result?.diag ?? 'E9999', message: result?.message ?? '未知错误' })
      reportFailure(i + 1, step, result)
      process.exit(1)
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`  ✓ 通过（${elapsed}s）${result.detail ? `：${result.detail}` : ''}\n`)
  }

  clearState()
  console.log('演练检查流水线全部通过 ✓')
}

function reportFailure(order, step, result) {
  const diag = result?.diag ?? 'E9999'
  console.error(`  ✗ 失败 [诊断编号 ${diag}] ${result?.message ?? '未知错误'}`)
  const hint = DIAG_HINTS[diag]
  if (hint) {
    console.error(`  · 排查建议：${hint}`)
  }
  console.error(`  · 已记录到 .drill-check-state.json，修复后重跑将从步骤「${step?.label ?? order}」继续`)
}

await main()
