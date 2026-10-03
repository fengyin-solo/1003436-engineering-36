.PHONY: install frontend build check

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

# 应急演练本地开发检查流水线：装依赖 → 构建 → 演练数据校验 → 总览与待办核对。
# 失败保留诊断编号，修复后只从失败步骤继续；check-restart 从头重跑。
check:
	cd frontend && npm run dev:check

check-restart:
	cd frontend && npm run dev:check -- --restart
