---
title: AI 调用链路可观测性设计文档
---

# AI 调用链路可观测性设计文档

> **技术设计文档v1.0** | 2026-07-19 | 受众：架构师 / 后端工程师 / AI 工程师

## 目录

- 背景与动机
- 核心概念
- 数据模型设计
- 架构设计
- 指标体系
- 实现方案
- 生态与标准

## 1. 背景与动机

传统的微服务可观测性方案在 AI 应用场景中暴露出一系列根本性不足。一个 LLM 调用产生的遥测数据量远超一次 HTTP 请求——prompt 和 completion 是数百到数万 token 的文本块，tool call 参数每次结构不同，Agent 的多步推理无法用固定 schema 捕获。
具体而言，以下四类问题在现有方案中无法解决：
问题一：调用链不可见。Agent 的一次请求可能触发 5-15 次 LLM 调用、多次工具调用和检索操作，但传统 APM 只看到一次 HTTP 请求。当 Agent 输出不符合预期时，无法定位是哪个环节出错。
问题二：质量不可度量。延迟和错误率能告诉你"服务挂了"，但无法告诉你"回答出现了幻觉"、"检索到的文档不相关"或"工具调用参数错误"。这些是 AI 应用最核心的故障类型。
问题三：成本不可追踪。Token 消耗是 AI 应用最大的运营成本来源。缺乏按租户、按模型、按路由的细粒度成本追踪，预算失控是常态。
问题四：非确定性难以复现。同一 prompt 在不同时间可能得到不同结果。传统的日志调试无法重现问题——需要完整的 span 树和精准的调用序列重放。[1]
OpenTelemetry 在 2024 年成立了 GenAI SIG，并在 v1.37 至 v1.41 版本中持续演进 GenAI 语义约定，定义了从 LLM 客户端调用、Agent 编排、MCP 工具调用到内容捕获和质量评估的六层标准[2]。本文档基于该标准体系，设计一套完整的 AI 调用链路可观测性方案。
## 2. 核心概念

AI 调用链路可观测性建立在四个核心原语之上，它们的关系比传统 APM 更复杂：
```
graph TD
 subgraph "一个 Trace（一次用户请求）"
 A[Span: invoke_agent] --> B[Span: chat gpt-4o]
 A --> C[Span: execute_tool web_search]
 C --> D[Span: MCP tools/call SERVER]
 A --> E[Span: chat gpt-4o]
 A --> F[Span: execute_tool summarize]
 A --> G[Span: chat gpt-4o]
 end
 B -.-> H[Event: operation.details]
 G -.-> I[Event: evaluation.result]
 H -.-> J[(External Storage)]
 style A fill:#1a1d27,stroke:#5b9cf5,stroke-width:2px
 style B fill:#1a1d27,stroke:#8b8fa3
 style C fill:#1a1d27,stroke:#8b8fa3
 style D fill:#1a1d27,stroke:#8b8fa3
 style E fill:#1a1d27,stroke:#8b8fa3
 style F fill:#1a1d27,stroke:#8b8fa3
 style G fill:#1a1d27,stroke:#8b8fa3
 style H fill:#1a1d27,stroke:#7ed6a0,stroke-dasharray:5
 style I fill:#1a1d27,stroke:#7ed6a0,stroke-dasharray:5
 style J fill:#1a1d27,stroke:#f5a623,stroke-dasharray:5
```图 1：Trace / Span / Event 三层关系示意
### 2.1 Trace（追踪）

一次用户请求的完整执行链路，由唯一的trace_id标识。一个 Agent 请求的 Trace 包含从 Agent 初始化到最终响应的所有 Span，包括 LLM 调用、工具执行、检索操作和内部推理步骤。
### 2.2 Span（跨度）

Trace 中的一个独立操作单元。每个 Span 携带以下核心信息：操作名称、Span 类型、起止时间、输入/输出、模型名称、token 用量、状态码和自定义属性。关键 Span 类型包括：
| **Span 类型** | **操作名** | **Kind** | **说明** |
| LLM 推理 | chat {model} | CLIENT | 一次 LLM 调用 |
| Agent 调用 | invoke_agent {name} | CLIENT / INTERNAL | 远程 Agent 服务或本地框架执行 |
| 工作流 | invoke_workflow {name} | INTERNAL | 预定义工作流执行 |
| 工具执行 | execute_tool {name} | INTERNAL | 工具调用 |
| 检索 | retrieval | INTERNAL | RAG 检索步骤 |
| 嵌入 | embeddings | CLIENT | 向量嵌入操作 |
### 2.3 Metrics（指标）

聚合后的时序数据，用于告警和趋势分析。核心指标包括：操作延迟的 p50/p95/p99、token 消耗分布、错误率、吞吐量和缓存命中率。指标按gen_ai.operation.name、gen_ai.request.model、gen_ai.provider.name等维度切分。
### 2.4 Events（事件）

附着在 Span 上的离散事件，承载重量级数据。包括：
- gen_ai.client.inference.operation.details— 记录完整的输入/输出消息（prompt 和 completion）- gen_ai.evaluation.result— 质量评估结果，携带评分和标签

### 2.5 Evaluations（评估）

附着在 Span 上的评分属性，用于衡量 AI 输出质量。典型评估维度包括：忠实度（faithfulness）、答案相关性（answer relevancy）、幻觉严重度（hallucination severity）、工具调用正确性（tool correctness）和目标完成度（goal completion）。评分存储为 Span 属性，与延迟和 token 消耗在同一个查询平面，无需跨系统 join。
## 3. 数据模型设计

### 3.1 LLM 推理 Span每次 LLM 调用生成一个 Span。这是最基础也是频次最高的 Span 类型。

| **属性** | **类型** | **示例值** | **必填** |
| gen_ai.operation.name | string | chat / text_completion / generate_content | 是 |
| gen_ai.provider.name | string | openai / anthropic / aws.bedrock | 是 |
| gen_ai.request.model | string | gpt-4o-mini | 是 |
| gen_ai.response.model | string | gpt-4o-mini-2024-07-18 | 是 |
| gen_ai.usage.input_tokens | int | 142 | 是 |
| gen_ai.usage.output_tokens | int | 87 | 是 |
| gen_ai.usage.cache_read.input_tokens | int | 50 | 否 |
| gen_ai.usage.reasoning.output_tokens | int | 200 | 否 |
| gen_ai.response.finish_reasons | string[] | ["stop"] / ["tool_calls"] | 是 |
| gen_ai.request.temperature | float | 0.7 | 否 |
| gen_ai.request.max_tokens | int | 4096 | 否 |
### 3.2 Agent / Workflow SpanAgent 编排层的 Span 是 AI 可观测性与传统微服务可观测性最大的分歧点。v1.41 明确了两个场景：CLIENT用于远程调用（如 OpenAI Assistants API）

，INTERNAL用于本地框架执行（如 LangGraph）。
| **属性** | **类型** | **示例** | **说明** |
| gen_ai.operation.name | string | invoke_agent / invoke_workflow / create_agent | 操作类型 |
| gen_ai.agent.name | string | support-router | Agent 名称 |
| gen_ai.agent.id | string | agent-42 | Agent 唯一标识 |
| session.id | string | sess-abc123 | 会话 ID，关联多轮对话 |
### 3.3 Tool Execution Span工具执行 Span 的 Kind 为INTERNAL。v1.41 要求 Span 名称必须包含工具名：execute_tool {gen_ai.tool.name}。
| **属性** | **类型** | **示例** | **说明** |
| gen_ai.tool.name | string | web_search | 工具名称 |
| gen_ai.tool.call.id | string | call_xyz | 调用 ID |
| gen_ai.tool.call.arguments | string | {"query":"..."} | 调用参数（受隐私策略限制） |
| gen_ai.tool.call.result | string | {"results":[...]} | 调用结果（受隐私策略限制） |
### 3.4 MCP SpanMCP（Model Context Protocol）

在 2025 年快速普及，但带来一个可观测性难题：Agent 端和 MCP 服务端产生两个独立的 Trace。OTel MCP 语义约定（v1.39）通过 W3C Trace Context 传播解决了跨进程 Trace 断裂问题[3]。
| **属性** | **类型** | **示例** |
| mcp.method.name | string | tools/call |
| mcp.session.id | string | session-xyz |
| mcp.protocol.version | string | 2025-03-26 |
| jsonrpc.request.id | int | 42 |
| network.transport | string | pipe / tcp |
### 3.5 内容捕获策略Prompt 和 completion 是最有价值的调试数据，也是最敏感的。规范定义了三种模式：
不记录
默认模式
Span 属性
便捷但受限
外部存储
推荐生产模式
推荐生产环境采用模式三：完整内容存入外部存储（S3 / ClickHouse / GreptimeDB），Span 仅持有引用 URL。独立的 IAM 和保留策略，审计日志与 Trace 数据解耦。
## 4. 架构设计

```
graph TB
 subgraph "应用层"
 A1[AI Agent 应用]
 A2[LLM SDK 调用]
 A3[MCP 工具调用]
 end

 subgraph "采集层"
 B1[OTel Auto-Instrumentation]
 B2[OpenInference SDK]
 B3[自定义 Span 封装]
 end

 subgraph "传输层"
 C1[OTLP Collector]
 end

 subgraph "处理层"
 D1[Span 处理器]
 D2[指标聚合器]
 D3[评估引擎]
 end

 subgraph "存储层"
 E1[(ClickHouse - Traces)]
 E2[(Prometheus - Metrics)]
 E3[(S3 - Content)]
 E4[(PostgreSQL - Metadata)]
 end

 subgraph "展示层"
 F1[Trace 查询面板]
 F2[指标仪表盘]
 F3[告警规则]
 end

 A1 --> B1
 A2 --> B2
 A3 --> B3
 B1 --> C1
 B2 --> C1
 B3 --> C1
 C1 --> D1
 C1 --> D2
 D1 --> E1
 D2 --> E2
 D1 --> E3
 D1 --> E4
 D1 --> D3
 D3 --> E1
 E1 --> F1
 E2 --> F2
 E2 --> F3

 style A1 fill:#1a1d27,stroke:#5b9cf5
 style A2 fill:#1a1d27,stroke:#5b9cf5
 style A3 fill:#1a1d27,stroke:#5b9cf5
 style D3 fill:#1a1d27,stroke:#7ed6a0
 style E3 fill:#1a1d27,stroke:#f5a623
```图 2：AI 调用链路可观测性整体架构
### 4.1 采集层采集层负责在应用代码中自动或手动生成 Span 和 Metrics。推荐优先使用 OpenTelemetry 自动插桩，对主流 LLM SDK 的覆盖已较为成熟：
#### 自动插桩一行代码启用：OpenAIInstrumentor().instrument()。自动生成符合 GenAI 语义约定的 Span 和 Metrics，覆盖 OpenAI、Anthropic、AWS Bedrock 等主流 SDK。
#### 手动插桩对 Agent 编排层（LangGraph、CrewAI 等）和自定义工具调用，使用@observe装饰器或tracer.start_span()手动创建 Span，携带 Agent 名称、工具名等业务语义。
### 4.2 传输层使用 OTLP Collector 作为统一的遥测数据网关。支持三种部署模式：
- Sidecar 模式— 与应用容器同 Pod，本地 localhost 上报，零网络开销- DaemonSet 模式— 每个 Node 一个 Collector，共享资源池- Gateway 模式— 集中式 Collector 集群，支持多租户路由和流量整形

### 4.3 存储层根据数据类型选择专用存储引擎，而非试图用单一数据库解决所有问题：

| **数据类型** | **存储引擎** | **保留策略** | **说明** |
| Traces（Span 树） | ClickHouse / Elasticsearch | 7-30 天 | 高基数、高写入吞吐 |
| Metrics（时序指标） | Prometheus / VictoriaMetrics | 90-365 天 | 低基数、聚合查询 |
| Content（prompt/completion） | S3 / MinIO | 按合规需求 | 大对象、低频访问 |
| Metadata（会话/用户/配置） | PostgreSQL | 永久 | 关系型、事务性 |
### 4.4 评估层评估引擎独立于主链路运行，消费 Span 数据进行离线或近线评分：
- 在线采样评分— 对 5%-10% 的生产流量运行 LLM-as-Judge 评估，评分写入 Span 属性- 离线批量评分— 对回归数据集运行全量评估，作为 CI/CD 门禁- 失败 Trace 自动转测试用例— 生产故障的 Trace 自动导入数据集，防止同类问题复发## 5. 指标体系

### 5.1 核心指标| **指标** | **类型** | **维度** | **用途** |

| gen_ai.client.operation.duration | Histogram | operation.name, model, provider | 延迟监控，p95 告警，路由决策 |
| gen_ai.client.token.usage | Histogram | operation.name, model, token_type | Token 消耗趋势，成本分析 |
| error_rate | Counter | operation.name, provider, error_type | 4xx/5xx/超时/限流，按提供商分 |
| throughput | Counter | route, model | 每秒请求数，队列深度 |
| cache_hit_rate | Gauge | cache_type | 语义缓存 vs 精确缓存命中率 |
| eval_score | Gauge | eval_type, route | 忠实度/相关性/幻觉评分 |
### 5.2 Token 使用 Histogram 桶策略推荐使用指数增长的桶边界，覆盖 1 token 到 67M token：
[1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864]
### 5.3 告警规则建议| **告警** | **条件** | **严重级别** |
| LLM 调用 p95 延迟飙升 | p95 > 基线 × 3 持续 5min | P2 |
| 错误率异常 | 5xx > 5% 持续 3min | P1 |
| Token 消耗异常 | 日消耗 > 预算 120% | P2 |
| 幻觉率上升 | hallucination_score < 0.7 持续 10min | P2 |
| 评估服务不可用 | judge_error_rate > 10% | P3 |
## 6. 实现方案

### 6.1 分阶段落地路径- 阶段一：基础插桩

接入 OpenTelemetry Auto-Instrumentation，自动采集 LLM SDK 调用的 Span 和 Metrics。开通 OTLP 导出到 ClickHouse 和 Prometheus。目标：所有 LLM 调用可见、延迟和 token 消耗可查。- 阶段二：Agent 编排追踪
对 Agent 框架（LangGraph、CrewAI 等）和工具调用添加手动 Span，构建完整的 invoke_agent → chat → execute_tool 链路。目标：Agent 多步推理过程可追溯。- 阶段三：内容捕获与评估
启用 prompt/completion 内容捕获（外部存储模式），部署 LLM-as-Judge 评估引擎，在 Span 上附着质量评分。目标：质量可度量，故障可复现。- 阶段四：闭环优化
将失败 Trace 自动导入测试数据集，CI 门禁拦截评分不达标的 prompt 和模型变更。目标：同类问题不再复发。

### 6.2 代码示例Python 最小接入示例：

```
graph LR
 A["Python App"] --> B["OpenAIInstrumentor().instrument()"]
 B --> C["OTLP Exporter"]
 C --> D["Collector"]
 D --> E["ClickHouse"]
 D --> F["Prometheus"]
 style A fill:#1a1d27,stroke:#5b9cf5
 style B fill:#1a1d27,stroke:#7ed6a0
 style C fill:#1a1d27,stroke:#8b8fa3
 style D fill:#1a1d27,stroke:#f5a623
 style E fill:#1a1d27,stroke:#8b8fa3
 style F fill:#1a1d27,stroke:#8b8fa3
```图 3：最小接入数据流
### 6.3 内容捕获开关生产环境默认关闭内容捕获，按需开启：
- 环境变量：OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true- 稳定性开关：OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest启用最新语义约定- 外部存储：内容写入 S3/MinIO，Span 仅携带content_ref_url

### 6.4 技术选型推荐| **组件** | **推荐方案** | **备选** |

| 采集 SDK | OpenTelemetry + OpenInference | LangFuse SDK, 自定义埋点 |
| Collector | OTLP Collector (Gateway) | Vector, Fluentd |
| Trace 存储 | ClickHouse | Elasticsearch, Grafana Tempo |
| 指标存储 | Prometheus + Grafana | Datadog, New Relic |
| 内容存储 | S3 / MinIO | GCS, Azure Blob |
| 元数据存储 | PostgreSQL | MySQL |
| 评估引擎 | 自建 LLM-as-Judge | LangSmith, Arize Phoenix |
## 7. 生态与标准

### 7.1 OpenTelemetry GenAI 语义约定截至 2026 年 5 月（v1.41）

，GenAI 语义约定处于Development状态，但核心概念已稳定[2]。涵盖六层标准：
| **层级** | **内容** | **成熟度** |
| Layer 1 | Client Spans — 标准化模型调用（chat / embeddings / retrieval） | 稳定 |
| Layer 2 | Agent & Workflow Spans — create_agent / invoke_agent / invoke_workflow / execute_tool | 发展中 |
| Layer 3 | MCP 语义约定 — 跨进程 Trace 传播、MCP 指标 | 发展中 |
| Layer 4 | Events & Content Capture — 三种内容记录模式 | 稳定 |
| Layer 5 | Metrics — operation.duration 和 token.usage 两个核心 Histogram | 稳定 |
| Layer 6 | Provider-Specific — OpenAI 缓存 token、Anthropic 推理 token 等 | 发展中 |
### 7.2 主要平台对比| **平台** | **监控能力** | **可观测性** | **数据格式** | **部署方式** |
| LangSmith | 中等 | 强（LangChain 生态） | OTLP + 原生 SDK | SaaS |
| LangFuse | 中等 | 强（Traces + Prompts + Eval） | OTLP + 原生 SDK | 自部署 / SaaS |
| Arize Phoenix | 中等 | 强（OTel 原生） | OTLP + OpenInference | 自部署 |
| Datadog LLM | 强（APM 核心） | 中等 | OTLP + 厂商 Agent | SaaS |
| FutureAGI | 强（网关指标） | 强（Trace + Eval） | OTLP + OpenInference | 自部署 / SaaS |
### 7.3 关键版本演进| **版本** | **日期** | **关键变更** |
| v1.37 | 2025 | Chat history 重构：从 per-message events 改为聚合属性 |
| v1.38 | 2025 | 新增 Evaluation event、tool definitions、invoke_agent |
| v1.39 | 2025 | MCP 语义约定 |
| v1.40 | 2026 | Retrieval span、cache token 属性 |
| v1.41 | 2026-05 | execute_tool 命名要求、reasoning tokens、invoke_workflow |
设计建议：当前阶段建议基于 OTel GenAI 语义约定构建，避免深度绑定具体厂商。使用 OpenInference / OpenLLMetry 作为数据格式层，OLTP 作为传输协议。这样可以在不修改应用代码的前提下，切换后端平台或同时输出到多个后端。
## Sources- FutureAGI, "LLM Monitoring vs LLM Observability in 2026: A Practical Split" (2025-08-14). 系统对比了 LLM 监控与可观测性的差异，提出了 alert-into-trace 的闭环模式。https://futureagi.com/blog/llm-monitoring-vs-llm-observability-2026- Greptime, "How OpenTelemetry Traces LLM Calls, Agent Reasoning, and MCP Tools" (2026-05-21). 详尽解析了 OTel GenAI 语义约定的六层标准，从 Client Span 到 Provider-Specific 约定。https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions- OpenTelemetry, "Semantic Conventions for GenAI" (v1.41.0). 官方 GenAI 语义约定规范，定义了 MCP、Agent、Workflow 等核心概念。https://opentelemetry.io/docs/specs/semconv/gen-ai/