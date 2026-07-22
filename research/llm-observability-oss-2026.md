---
title: 2026年 LLM 可观测性开源工具汇总
---

# 2026年 LLM 可观测性开源工具汇总

综合四篇权威文章的调研结果，整理 2026 年 LLM 可观测性领域的开源工具全景。
**数据来源：**
- [1337skills: LLM Observability 2026](https://1337skills.com/ko/blog/2026-06-18-llm-observability-2026-tracing-evaluation-phoenix-langfuse/)- [LangChain: 8 LLM Observability Tools](https://www.langchain.com/resources/llm-observability-tools)- [OpenObserve: Top Open Source LLM Observability Tools 2026](https://openobserve.ai/blog/llm-observability-tools/)- [Firecrawl: Best LLM Observability Tools 2026](https://www.firecrawl.dev/blog/best-llm-observability-tools)## 总表：14 个开源 LLM 可观测性工具工具
许可证
定位
核心能力
自托管
推荐文章
Langfuse
MIT
全能型平台
分布式追踪、Prompt 版本管理、LLM-as-Judge 评估、数据集管理、Playground
✅
4/4
Arize Phoenix
ELv2
评估与 RAG 调试
OpenTelemetry 原生、幻觉检测、嵌入漂移检测、RAG 检索管道可视化
✅
4/4
MLflow
Apache 2.0
ML 实验跟踪 + LLM 追溯
50+ 内置评估指标、AI Gateway 网关、OpenTelemetry 原生、Prompt 管理
✅
2/4
Comet Opik
Apache 2.0
全能型（Comet 出品）
自动化 Prompt 优化（6 种算法）、幻觉/审核/相关性评估、低代码平台集成
✅
3/4
DeepEval
Apache 2.0
评估框架
研究级评估指标、LLM-as-Judge、幻觉检测、毒性检测
✅
1/4
OpenTelemetry
Apache 2.0 (CNCF)
插桩标准
厂商中立追踪协议、GenAI 语义约定、打破供应商锁定
N/A
4/4
OpenLLMetry
Apache 2.0
插桩库
纯 OTel 插桩、一行代码接入、最广框架覆盖、隐私脱敏
✅
2/4
TruLens
MIT
RAG 评估
RAG 三合一评估（答案相关性、上下文相关性、忠实度）
✅
2/4
Helicone
Apache 2.0
网关代理
代理式接入（改一行 URL）、智能缓存、100+ 模型支持、超低延迟
✅
2/4
Portkey
MIT
AI 网关
250+ 模型路由、故障转移、20-40ms 开销、生产级网关
✅
2/4
Lunary
Apache 2.0
轻量级 RAG 可观测
两分钟接入、RAG 专用追踪、嵌入指标、多 JS 运行时支持
✅
1/4
OpenObserve
AGPL-3.0
统一 LLM + 基础设施
日志/指标/追踪/LLM 四合一、列式存储（≈140x 压缩）、SQL 查询、单二进制部署
✅
1/4
Evidently AI
开源
ML + LLM 统一监控
数据漂移检测、模型质量监控、ML 与 LLM 指标统一
✅
1/4
W&B Weave
开源
MLOps 实验跟踪
实验追踪、模型版本管理、LLM 应用评估
✅
1/4
## 按功能分类### 全能型平台（追踪 + 评估 + Prompt 管理）- **Langfuse**（MIT）：社区最活跃（28,000+ GitHub Stars），被四篇文章一致推荐为首选- **Comet Opik**（Apache 2.0）：自动化 Prompt 优化是差异化优势- **MLflow**（Apache 2.0）：已有 ML 基础设施的团队零成本扩展### 评估与测试- **Arize Phoenix**（ELv2）：RAG 检索管道调试最佳，OpenTelemetry 原生- **DeepEval**（Apache 2.0）：研究级评估指标，LLM-as-Judge 首选- **TruLens**（MIT）：专注 RAG 三合一评估- **Evidently AI**（开源）：ML + LLM 统一监控，数据漂移检测### 网关与代理- **Portkey**（MIT）：生产级网关，250+ 模型路由与故障转移- **Helicone**（Apache 2.0）：最快接入，改一行 URL 即可- **OpenLLMetry**（Apache 2.0）：最中立的插桩库，搭配任意后端### 基础设施 + LLM 统一- **OpenObserve**（AGPL-3.0）：统一日志/指标/追踪/LLM，低成本存储### 轻量级- **Lunary**（Apache 2.0）：两分钟接入，适合 RAG 管道和聊天机器人### 实验追踪- **W&B Weave**（开源）：MLOps 工作流中追踪 LLM 应用## 闭源平台（供参考）工具
定位
说明
LangSmith
全能型
LangChain 官方，深度集成 LangChain/LangGraph
Datadog
企业 APM
基础设施与 LLM 监控统一，适合已有 Datadog 的团队
New Relic
企业 APM
同上，适合已有 New Relic 的团队
Braintrust
评估优先
系统化 Prompt 实验与对比
Confident AI
评估平台
基于 DeepEval 的商业平台
Galileo AI
实时护栏
实时安全护栏与质量检测
## 选型建议**首选 Langfuse**（MIT）：社区最活跃，功能最全面，四篇文章一致推荐- **RAG 应用优先 Arize Phoenix**：检索管道可视化与幻觉检测最强- **已有 ML 基础设施选 MLflow**：零成本扩展 LLM 可观测性- **追求零锁死选 OpenLLMetry + 自选后端**：纯 OpenTelemetry 标准，可随时切换后端- **网关层需求选 Portkey 或 Helicone**：代理式接入，无需修改代码- **统一基础设施监控选 OpenObserve**：日志/指标/追踪/LLM 四合一**核心原则：优先选择 OpenTelemetry 原生支持的工具，投资标准而非投资供应商。**
生成时间：2026-07-22