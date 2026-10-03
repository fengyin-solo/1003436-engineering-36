# 森林防火巡护管理系统

面向森林火险监测、巡护任务调度、防火设施维护与应急响应指挥的林区防火管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 应急演练本地检查流水线

应急演练模块提供可重复的本地开发检查流程，一条命令跑完：

```bash
cd frontend && npm run check:drill   # 或在仓库根目录 make check-drill
```

流水线按顺序执行四步：

1. **环境准备**：校验 Node 版本，构建前端依赖（`node_modules` 缺失时自动 `npm install`），并用 esbuild 把数据层打包到 `.check-cache/`。
2. **演练数据校验**：校验演练主题（非空）、参演队伍（能在扑火队伍模块找到）、演练评价（只取当前演练标准档位）和示例数据（编号格式、字段齐全、状态合法）；同时验证重复装载示例数据不会增加演练记录、旧版本记录能兼容迁移（冲突时以当前演练标准为准，见 `frontend/src/data/drill-standard.ts`）。
3. **总览与待办核对**：`loadOverview` 的卡片与各模块待办、异常统计逐一对照明细数据。
4. **跨模块联动**：验证扑火队伍模块的队伍休整清单跟着消防装备模块的装备详情（最近检修日、装备状态）实时更新。

任一步骤失败都会打印诊断编号（如 `E2003` 演练评价不合标准、`E1003` 依赖安装失败，全表见
`frontend/scripts/lib/diag-codes.mjs`）并写入 `frontend/.drill-check-state.json`；修复后直接重跑
只会从失败步骤继续，加 `--fresh` 才从头跑。状态文件与 `.check-cache/` 均已 gitignore。

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 巡护任务 | `patrol` | 巡护任务 | 任务编号、巡护区域、巡护路线 |
| 火险监测 | `firewatch` | 火险监测点 | 监测点编号、监测区域、火险等级 |
| 瞭望台管理 | `lookout` | 瞭望台 | 瞭望台编号、所在山头、海拔高度 |
| 防火隔离带 | `firebreak` | 防火隔离带 | 隔离带编号、所属林区、起止坐标 |
| 扑火队伍 | `fireteam` | 扑火队伍 | 队伍编号、队伍名称、所属林场 |
| 消防装备 | `equipment` | 消防装备 | 装备编号、装备名称、装备类型 |
| 气象观测 | `weather` | 气象观测记录 | 记录编号、观测站点、观测时间 |
| 火情报告 | `firereport` | 火情报告 | 报告编号、起火地点、起火时间 |
| 无人机巡查 | `drone` | 无人机巡查任务 | 任务编号、飞行区域、飞行路线 |
| 防火宣传 | `campaign` | 防火宣传活动 | 活动编号、宣传主题、宣传方式 |
| 防火检查站 | `checkpoint` | 防火检查站 | 站点编号、站点位置、值守人员 |
| 值勤排班 | `duty` | 值勤排班表 | 排班编号、值勤日期、值勤时段 |
| 物资储备 | `supply` | 防火物资 | 物资编号、物资名称、物资类别 |
| 林区道路 | `forestroad` | 林区道路 | 道路编号、道路名称、起点位置 |
| 防火林带 | `firebelt` | 防火林带 | 林带编号、林带名称、所属林区 |
| 应急演练 | `drill` | 应急演练 | 演练编号、演练主题、参演队伍 |
| 焚烧审批 | `burnpermit` | 用火审批单 | 审批编号、申请单位、用火类型 |
| 林木生长 | `treegrowth` | 林木生长记录 | 记录编号、样地编号、林分类型 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`；当前演练标准（评价档位、编号格式、必填字段）在
  `frontend/src/data/drill-standard.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 本地存储带版本号（当前 v2）：旧版本记录读取时自动迁移，与当前标准冲突的取值以当前标准为准；
  `loadSampleData(模块)` 按业务编号幂等补装示例数据，重复调用不会增加记录。
- 装备详情用 `updateEntryDetail` 更新；扑火队伍页面的「队伍休整清单」由 `teamRestChecklist()`
  实时汇总休整队伍与其所属林场的装备详情，装备一改清单跟着变。
- 想回到初始数据：清掉浏览器里 `forest-fire-patrol:entries` 这一项，或调用 `resetModule(模块)`。
