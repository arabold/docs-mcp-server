# 金字塔感知检索协议(Pyramid-Aware Retrieval Protocol)· Spec

> fork 分支:`cjmp-pyramid-retrieval`(基于 upstream v3.0.1)
> 上游仓库:github.com/arabold/docs-mcp-server
> 决策记录:2026-08-29 与用户共同确认(bench 三臂实验数据驱动)

## 1. 问题与目标

**问题**:docs-mcp-server 的 `search_docs` 返回"命中簇 + 父块 + 1 前兄弟 + 3 子块 + 2 后兄弟"的拼装全文,且我们的金字塔被索引成 3MB 单页 bundle(1732 chunk 共享一个 URL)。实测(bench 臂2,7 个 ui-interaction 任务,34 次检索):

- 单次返回负载中位数 **14.2K 字符(~3.5K token)**,P90 23K,最大 34.8K
- 返回内容常为整个 L2 case 源文件全文(含 import、全部小节)
- 负载注入上下文后逐轮复利,是 MCP 臂 token 消耗的重要构成
- 会话内同主题重复检索(meituan 单任务占其检索负载 45%)

**目标(硬门槛,Q12)**:

| 指标 | 及格线 | 满分线 |
|---|---|---|
| bench 7 任务 total token 均值(基线臂2 = 4.10M) | ≤ 2.87M(-30%) | ≤ 2.05M(-50%) |
| bench 7 任务 judge 均分(基线臂2 = 84.4) | ≥ 82.4(-2 分) | ≥ 84.4(不降) |
| 离线评测 recall@3(基线 = 原始 store 实测值) | 不降 | 不降 |
| 离线评测单次负载中位数(基线 14.2K 字符) | ≤ 5K | ≤ 3K |

**非目标**:不改变金字塔源文件内容(skills 臂零影响);不阉割 MCP 能力(全量内容仍可达,只是按需)。

## 2. 协议设计:三级检索阶梯

```
search_docs ──► 摘要卡片(默认)          ~0.5-0.7K 字符/卡,3 卡/次
                  标题+锚点 | API 签名一行流 | 最小示例 3-4 行 | 层级+score
                        │ 90% 场景到此为止,直接写代码
                        ▼ 点名要
read_section(library, path, section?) ──► 单个小节全文   ~1-3K 字符
                        │ 需要整单元上下文时
                        ▼
read_section(library, path) ──► 整个检索单元全文(= 一个 L2 case 或 L3 api 文件)
```

设计原则(与金字塔 L1→L2→L3 同构):**每个 token 都被点名要,没有顺带塞进来的**。

## 3. 文档侧改造(在 VibeCoding 仓库,源文件零改动)

改造 `skills/cjmp-docs-mcp/scripts/index-local-docs.sh` 的产物形态:

1. **检索单元化**:单页 3MB bundle → 多文件语料。L1 index 一份、每个 L2 case 一份、每个 L3 api 文件一份;URL 镜像仓库路径(如 `cj-ui-docs/cases/04-text-input-controls.md`)。拼装扩展被锁在单元内。
2. **元数据头**:每单元 front-matter:`layer: L1|L2|L3`、`topic`、`api_names`(从"完整 API"链接行机器提取)、`keywords`。索引为结构化字段,参与过滤与 FTS 加成。
3. **摘要卡片区(Q8=方案 A,程序抽取)**:生成器从每个 L2 case 机器提取:各 section 的标题+锚点、"完整 API"行的 API 名清单、首个代码块中主组件的链式调用行(≤4 行),拼为该单元的卡片段存入元数据/首部。不人工撰写,不改源文件。

cangjie-docs 库(官方)不动,仅金字塔库换新形态。

## 4. server 侧改造(本 fork)

| # | 改动 | 位置(上游结构) |
|---|---|---|
| S1 | **卡片式 search 返回**:MCP 层输出卡片(标题/锚点/签名/最小示例/层级/score/read_section 引用);limit 默认 5→3;新增 `detail: "full"\|"cards"` 参数保留旧全量行为 | `src/mcp/mcpServer.ts` search_docs handler + `src/tools/SearchTool.ts` |
| S2 | **新工具 `read_section`**:按 (library, path, section?) 返回单元/小节全文;无版本语义沿用 find_version | `src/mcp/mcpServer.ts` + 新 tool 类 |
| S3 | **拼装裁剪**:MarkdownAssemblyStrategy 参数化——卡片模式下命中 chunk + 标题路径,不做 3 子 2 兄弟扩展 | `src/store/assembly/` |
| S4 | **会话内查询去重**:server 进程内 session 缓存,token-Jaccard ≥0.85 的重复 query 返回引用提示(同库同 query 直接复用) | `src/tools/SearchTool.ts` 或 store 层 |
| S5 | **元数据加成**:api_names/topic 命中加成 FTS 权重(复用列权重机制) | `src/store/DocumentStore.ts` |
| S6 | **嵌入可用性**:无 embedding 端点时保持 FTS-only(现状即如此;query 为关键词袋风格,BM25 对症),RRF 向量权重置 0 | 配置 |

## 5. 评测与验收

**离线(Phase 1/5,分钟级迭代)**:
- 评测集:34 条轨迹真实 query + 按 7 任务 task.md/design-source 的组件属性分布扩充至 ~100 条;golden answer = 应命中的 case/api 文件(人工标注)
- 指标:recall@3、单次负载字符中位数;跑法:server CLI `search` 批处理
- 达标:recall@3 不降 + 负载中位数 ≤5K

**bench(Phase 6,终局验收)**:
- 配置:臂2 同构(5 skills 含 cjmp-docs-mcp,MCP 指向 fork 构建 + 新 store),AGENTS.md 增补两阶段检索协议说明
- 7 任务、opencode + GLM-5.2、同模拟器;judge = Qwen3.7-Plus
- 停止条件:Q12 双门槛(及格或满分),不达标则回炉离线迭代

**对照与报告(Phase 7)**:四臂数据并列 —— 臂1(整读金字塔 85.4/6.12M)、臂2(搜金字塔,原版 server,84.4/4.10M)、优化臂(本方案)、裸奔臂(无文档无 MCP,用户自跑)。产出设计文档 + 实验报告 + dashboard。

## 6. 部署与回退

- fork 构建 → `bench/.cache/cjmp-docs-mcp-fork/`(独立于 2.4.2 runtime)
- 新 store → `bench/.cache/cjmp-docs-fork-store/`(= official 副本库 + 新金字塔库;不动 `~/.local/share/cjmp-docs-mcp`)
- bench track.toml 的 `mcp_servers.command/env.DOOCS_MCP_STORE_PATH` 指向 fork;实验后可一键切回

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 卡片太薄导致 agent 多轮拉全文,token 反升 | 卡片含签名+示例,离线评测用"卡片可答率"抽检;必要时 read_section 结果计入负载预算观察 |
| recall 下降 | 元数据加成 + golden 集回归,降了先调权重不砍内容 |
| fork 与上游差异过大难以提 PR | 改动集中在 MCP 层与 assembly 配置,核心 store 不动,PR 可拆分 |
| 多文件语料索引方式与上游 scrape 流程不匹配 | Phase 2 先做最小索引实验(2 个文件)验证通路 |
