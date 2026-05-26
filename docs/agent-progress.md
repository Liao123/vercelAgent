# 开发智能体项目进度

更新时间：2026-05-27

本文档用于记录开发智能体项目的工作项、当前状态、验收标准和执行记录。后续每完成一个工作项，都必须更新本文档。

## 状态说明

```text
todo        尚未开始
doing       正在进行
blocked     被阻塞，需要用户决策或外部条件
done        已完成并通过基本验证
deferred    暂缓，不属于当前阶段
```

## 更新规则

后续 AI 或开发者必须遵守：

1. 开始一个工作项前，把对应状态改为 `doing`。
2. 完成一个工作项后，把状态改为 `done`，并填写完成记录。
3. 如果遇到阻塞，把状态改为 `blocked`，写清楚阻塞原因和需要谁决策。
4. 不要只在聊天里说完成，必须同步更新本文档。
5. 涉及架构决策时，同时更新 `docs/agent-memory.md`。
6. 涉及新增能力时，必须写清楚验收标准。
7. 不要把密钥、token、私有账号信息写入本文档。

## 当前阶段目标

当前阶段先不大改项目结构，目标是把现有 Next.js 聊天应用逐步变成任务型开发智能体原型。

主链路：

```text
选择项目
  -> 创建 Thread / Task
  -> 读取项目规则
  -> 建立上下文
  -> 中文需求定位文件
  -> 制定计划
  -> 调工具读/改代码
  -> 展示 diff
  -> 运行验证
  -> 记录 trace
  -> 必要时压缩上下文
```

设计解析链路：

```text
内置浏览器
  -> AI 能打开指定网址
  -> 用户和 AI 可以基于页面继续开发任务
```

## 工作项列表

| ID | 状态 | 工作项 | 验收标准 |
| --- | --- | --- | --- |
| A001 | done | 建立架构规划文档 | `docs/agent-architecture.md` 已存在，并说明 Codex-like 架构、Chrome DevTools 主线、上下文压缩、权限、trace、MVP 顺序。 |
| A002 | done | 建立项目进度文档 | `docs/agent-progress.md` 已存在，包含工作项、状态说明、更新规则和验收标准。 |
| A003 | done | 建立本地记忆文档 | `docs/agent-memory.md` 已存在，记录项目事实、架构决策、用户偏好和后续注意事项。 |
| A004 | todo | 新增 `src/agent` 骨架 | 创建 `src/agent` 下的核心目录，不改变现有页面功能。 |
| A005 | todo | 抽象 `ModelProvider` | 模型调用统一走 provider 接口，现有 OpenAI 兼容接口可接入。 |
| A006 | todo | 定义核心类型 | 定义 `Thread`、`Task`、`Turn`、`AgentEvent`、`AgentPlan`、`ApprovalRequest`。 |
| A007 | todo | 建立任务事件流 | 聊天响应可输出任务事件，而不是只返回纯文本。 |
| A008 | todo | 建立 Trace Store 雏形 | 记录任务、模型输出、工具调用、文件变更和验证结果。 |
| A009 | todo | 建立 Workspace Manager | 支持记录当前项目路径、Git 根目录、框架信息和项目规则。 |
| A010 | todo | 读取项目规则 | 能读取 `AGENTS.md`、README、package 信息和基础配置。 |
| A011 | todo | 增加文件工具 | 支持目录扫描、读文件、搜索文件。 |
| A012 | todo | 增加 Git 工具 | 支持 `git status`、`git diff`，后续再扩展 branch/commit。 |
| A013 | todo | 增加 patch 修改工具 | AI 通过 patch 修改文件，修改后能展示 diff。 |
| A014 | todo | 增加审批机制 | 写文件、删文件、执行命令、安装依赖等高风险操作需要确认。 |
| A015 | todo | 建立上下文管理骨架 | 区分系统规则、项目规则、Thread Memory、Task Memory、Turn Context。 |
| A016 | todo | 增加上下文压缩机制 | 长对话、旧工具结果、大日志能压缩为结构化摘要。 |
| A017 | todo | 增加 token 预算管理 | 每次模型请求前计算上下文预算，预留输出空间。 |
| A018 | todo | 建立项目索引 | 扫描路由、页面、组件、接口、业务关键词、文件摘要。 |
| A019 | todo | 中文需求定位文件 | 用户说页面或模块中文名称时，能定位相关文件候选。 |
| A020 | todo | 增加验证工具 | 支持 lint/build/test 等项目验证命令。 |
| A021 | todo | 跑通开发闭环 | 需求 -> 定位文件 -> 计划 -> 修改 -> 验证 -> 总结。 |
| A022 | todo | 增加内置浏览器 UI | 产品内可以打开目标网址或本地页面，AI 可以触发打开指定 URL。 |
| A023 | deferred | Chrome DevTools 深度读取 | DOM、元素宽高、样式、console、network、design spec 等能力先暂缓。 |
| A024 | deferred | 页面生成/复刻流程 | demo URL + 素材 + design spec -> 修改代码 -> 浏览器验证，先暂缓。 |
| A025 | deferred | Electron 桌面端 | 主链路稳定后再做，不作为当前阶段目标。 |

## 完成记录

### 2026-05-27

- A001 已完成：建立并升级 `docs/agent-architecture.md`。
- A002 已完成：建立 `docs/agent-progress.md`。
- A003 已完成：建立 `docs/agent-memory.md`。

## 当前下一步

建议下一步从 A004 开始：新增 `src/agent` 骨架，但不要改变当前页面功能。
