# 项目文件评审报告

**Mode:** PR Review
**Scope:** 当前工作区（分支 v20261025）的代码抽样评审，重点为 Creation-Studio 前后端、agent_backend、Video-Generation-Manager 的任务生命周期、权限和运行依赖；包括相关未跟踪源码。不是对全部文件逐行审计。
**Health Score:** 50/100（仅表示本次抽样发现的风险，按 2 Critical、4 Warning 计分，不代表产品功能完成度）

结论：任务持久化和回归测试基础已建立，但工作区命令权限、项目归属校验、Harness 默认启用方式存在明显缺口，建议先处理这些边界，再继续扩展智能体页面。

## 验证与限制

- 创作台 npm test：264 passed，0 failed。
- 视频管理器 npm test：121 passed，0 failed。
- 后端专项 pytest：test_context_discipline.py、test_tool_guard.py、test_skills.py，25 passed。
- 后端自己的 .venv/Scripts/python.exe 不存在；专项测试使用现有 ml-engineer 虚拟环境完成。这也直接验证了运行依赖问题。
- 权限复现只调用 check_command 校验函数，没有执行测试字符串，没有向工作区外写文件。
- 无真实图像/视频生成提交，无线上额度验收；不重启正式服务。不以本地测试通过代替浏览器平台稳定性验收。
- 当前相对本地 origin/v20261025 跟踪引用 ahead 41；没有 fetch，不能据此断言 GitHub 实时状态。工作区有大量修改及未跟踪文件，报告结论只适用于本次读取版本。

## Findings

### Critical

### 1. [P1 / R6] 工作区命令权限并未真正约束文件访问范围

位置：Creation-Studio/agent_backend/app/permissions.py:175–191；app/fs_tools.py:278–303。

Symptom: check_command 仅检查命令字符串中形如盘符绝对路径的片段，以及 cwd；随后以普通宿主进程执行任意命令。相对路径、环境变量、脚本内部访问都不受这个正则检查约束。

验证：以 agent_backend 为允许根和 cwd，校验函数均放行 Set-Content ../outside-review.txt ok 与 Set-Content $env:TEMP/review.txt ok。这两个字符串只做校验、没有实际运行。

Source: Domain-Driven Design — Aggregate Roots / invariant ownership；Code Complete — defensive programming。权限边界声明和执行器实际能力不一致。

Consequence: 用户选择“工作区权限”仍可能由模型命令改动工作区外的文件，界面承诺的范围无法兑现；高危关键词黑名单也不能被当成进程沙箱。

Remedy: 第一阶段在工作区档关闭通用命令工具，保留已经逐路径校验的文件工具；确实需要执行时采用受限程序及参数白名单。需要任意脚本能力时，应使用操作系统隔离和最小权限，或明确归入完全权限，不能仅扩大正则列表。

### 2. [P1 / R6] 任务详情和控制操作没有验证当前项目归属

位置：Creation-Studio/src/server.js:1385–1398、1431–1449；src/events.js:492–518。

Symptom: 服务已解析当前用户及 activeProject，但详情直接 events.get(id)，暂停、取消、重试等直接按 URL 中的事件或任务 ID 操作，没有对 event.spec.projectId/job.projectId 与当前项目进行比较。列表筛选不能替代这些对象级检查。

Consequence: 同一登录会话切换项目后，保留旧 ID 仍能读取和控制其他项目的任务；在多人本地使用情况下，登录校验本身也不能阻止按已知 ID 跨项目操作。可能暂停错误任务或触发不属于当前项目的重新生成。

Source: Domain-Driven Design — Bounded Context / invariant ownership；Clean Architecture — policy boundary。

Remedy: 为详情、日志、恢复、取消、重试、排序和成片操作统一加入项目归属守卫；内部服务调用单独明确授权。增加项目 A 创建任务、项目 B 使用同一 ID 读取及控制应被拒绝的 API 测试。本次是源码确认，未对正式用户任务进行越界操作。

### Warning

### 3. [P1 / R4] Harness 默认关闭，恢复与治理能力取决于隐藏配置

位置：Creation-Studio/agent_backend/app/harness/runtime.py:12–21；app/main.py:126–134、173–182；Creation-Studio/scripts/launch.js:118–123。

Symptom: HARNESS_RUNTIME_ENABLED 虽默认 true，但 HARNESS_PROJECT_ALLOWLIST 默认空；enabled(project) 只做 project in allowed。默认启动器没有为真实项目填入 allowlist，普通请求走 legacy 分支。

验证：清除 allowlist 后调用 enabled('proj-review') 返回 False。该验证证明代码默认行为，不代表检查过所有正在运行进程的环境变量。

Source: A Philosophy of Software Design — information hiding / complexity caused by configuration；The Mythical Man-Month — Conceptual Integrity。

Consequence: 新页面即使展示 Harness 风格步骤，也不能假定实际执行启用了其租约、检查点和预算治理。legacy 与 Harness 两套路径继续分化，恢复行为难以保持一致。

Remedy: 明确一个正式执行引擎；若保留灰度开关，应在设置和健康状态显示当前项目实际引擎，并验证真实项目 ID。按启动器正式配置增加端到端测试，而不是仅在单元测试里手动开启 Harness。

### 4. [P2 / R3] 智能体命令工具仍硬编码 PowerShell，与用户的 Git Bash 约定冲突

位置：Creation-Studio/agent_backend/app/fs_tools.py:279、300。

Symptom: run_command 文档和执行参数均固定为 powershell -Command，没有使用已指定的 Git Bash。

Source: The Pragmatic Programmer — DRY / single source of knowledge。全局执行环境约定未收口到工具实现。

Consequence: 智能体产生 POSIX 命令时会按另一种 Shell 解释，路径、引号和环境变量语义不同，导致命令失败或行为偏离预期；同时直接违反本会话明确的终端偏好。

Remedy: 统一 Shell 配置与调用入口，使用 D:/notebook/software/git/Git/bin/bash.exe、--noprofile --norc -c、shell=False；同步文档和权限设计。仅更换 Shell 不能修复第 1 项权限边界问题。

### 5. [P2 / R5] 智能体运行仍依赖另一项目的 Python 环境

位置：Creation-Studio/scripts/launch.js:29–32；Creation-Studio/agent_backend/start.sh:5–9；Creation-Studio/start-agent.cmd:5–6。

Symptom: 代码虽然优先查找本项目 .venv，但该目录中的 Python 当前不存在，实际回退到 D:/notebook/AIGC/ml-engineer/backend/.venv/Scripts/python.exe。本轮直接调用本项目解释器失败，使用回退解释器后专项测试通过。

Source: Clean Architecture — dependency direction；Software Engineering at Google — reproducible builds。

Consequence: ml-engineer 清理、依赖升级或迁移会影响创作台智能体；新机器仅复制本仓库也无法按当前状态独立启动。

Remedy: 建立本项目独立虚拟环境和可复现安装说明；环境变量覆盖可保留，但移除静默跨项目回退，缺少环境时给出具体初始化命令。复验启动器、健康检查和后端完整测试。

### 6. [P2 / R1、R2] 前端入口集中承担过多独立功能，继续扩展会放大回归范围

位置：Creation-Studio/web/app.js（本轮统计 10299 行、380 个普通/async function 声明）；src/server.js（2114 行）。

Symptom: app.js 同时包含素材、媒体、图像、智能体会话、输入与引用、流式消息、日志、任务、设置及项目管理。问题不在行数本身，而在同一入口同时持有多个业务页面的渲染、状态和事件绑定，新增智能体功能仍需修改这个共享文件。

Source: Refactoring — Divergent Change；A Philosophy of Software Design — information hiding。

Consequence: 新智能体工作台的会话恢复、流式输出和文件预览容易与现有全局状态及页面重绘相互影响；定位和回归范围扩大。该项是维护风险，不声称已经复现浏览器卡顿。

Remedy: 先按页面抽出 agent/{api,state,chat,run-panel,artifacts} 模块，以稳定接口连接现有路由；随后再拆媒体和创作台。避免一边重写所有页面一边更换任务执行模型。现有测试应补少量真实 DOM 交互验收，而不能只靠源码包含某字符串。

## 已有进展

- 图像与视频任务已有持久化记录、事件聚合、历史执行快照和分页接口。
- 重试执行使用独立 runId，管理器提交使用 runId 作为幂等键，已有测试覆盖，未重复报告旧问题。
- 上下文折叠、失败回复限长、统一摘要哈希结构等补强已存在，旧报告中的相关结论不能原样沿用。
- 视频管理器 JSON 存储采用临时文件加 rename，不能将其描述为直接覆盖文件导致必然损坏。
- 本地回归 410 项通过，但后端仅运行 25 项专项测试，未运行全部 pytest；没有完成真实平台生成和当前 UI 的全面验收。

## Summary

推荐顺序：命令权限边界与项目归属守卫 → 明确 Harness 正式入口及独立环境 → 拆分智能体前端模块 → 实施新页面。

新智能体页面方案可以继续使用，但应以真实执行引擎和持久化运行记录作为状态来源，先补上述边界，再实现进度、继续执行和产物交付。此次仅新增报告，不修改业务源码，不清理用户文件、不提交 Git。
