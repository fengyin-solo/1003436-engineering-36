.PHONY: install frontend build check-drill

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

# 应急演练本地开发检查流水线：环境准备 -> 演练数据校验 -> 总览与待办 -> 跨模块联动
check-drill:
	cd frontend && npm run check:drill
