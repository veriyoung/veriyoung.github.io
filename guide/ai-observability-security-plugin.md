---
title: AI 可观测性与安全一体化插件设计方案
---

# AI 可观测性与安全一体化插件设计方案

# 技术设计文档v1.0
# AI 可观测性与安全护栏可拔插一体化插件设计方案
2026-07-19技术设计受众：架构师 / 安全工程师 / 平台工程师
## 目录- 背景与动机- 整体架构：双管道设计- 安全检测模型- Guard 管道：六阶段安全流水线- 可观测性管道：完整 Span 树- 双层融合：安全裁决写入 Span- 插件化接入方案- 策略配置引擎- 实现路线图## 1. 背景与动机前两份文档分别设计了 SDK 层可观测性插件和网关层可观测性方案。但实际生产环境中，只观测不设防等于只装了监控摄像头却没装门锁——你能看到攻击发生，但阻止不了它。
安全测试和安全审计是 AI 系统上线前的"体检"，但生产环境中的攻击不会只发生在测试期间。一个真正可用的插件需要在观测每一次 AI 调用的同时，判断操作是否安全，并在必要时阻断。这需要把可观测性（Trace / Span / Metrics）和安全护栏（Guard / Policy / Block）两套逻辑融合到一个插件中。
观测 + 设防
双重能力
OWASP Top 10
覆盖标准
安全裁决入 Span
追踪闭环
核心设计目标：一个插件，同时完成两件事——① 追踪每一次 AI 调用的完整链路（谁调了什么模型、用了什么工具、消耗了多少 token）；② 在每个关键节点判断操作是否安全（输入是否含注入、工具调用是否越权、输出是否泄露敏感信息），将安全裁决作为 Span 属性写入 Trace，形成可审计的安全记录。
## 2. 整体架构：双管道设计插件核心采用双管道并行架构：观测管道负责 Trace/Span 生成和导出，安全管道负责输入/输出/工具调用的风险检测和裁决。两条管道在同一拦截点触发，裁决结果写入 Span 属性。
```
graph TB
 subgraph "应用代码"
 APP["AI 应用 / Agent"]
 end

 subgraph "插件入口"
 ENTRY["PluginManager
sitecustomize / -javaagent / --require"]
 end

 subgraph "拦截器引擎"
 INT["InterceptorEngine
拦截 OpenAI / Anthropic / LangChain / MCP"]
 end

 subgraph "双管道"
 direction TB

 subgraph "观测管道 Observability Pipeline"
 O1["PreHook
创建 Span
记录开始时间"]
 O2["SpanBuilder
填充 GenAI 属性
trace_id / model / tokens"]
 O3["PostHook
结束 Span
记录延迟"]
 O4["ExporterChain
OTLP gRPC 导出"]
 end

 subgraph "安全管道 Security Pipeline"
 S1["InputGuard
prompt 注入检测
越狱检测 / PII 扫描"]
 S2["ToolGuard
工具调用校验
越权检测 / 参数验证"]
 S3["OutputGuard
输出内容检测
敏感信息泄露 / 危险指令"]
 S4["PolicyEngine
裁决：Block / Warn / Allow"]
 end
 end

 subgraph "融合层"
 F1["裁决写入 Span
security.verdict / security.risk_score
security.blocked_reason"]
 end

 subgraph "导出"
 E1["OTLP Collector"]
 E2["审计日志"]
 E3["告警系统"]
 end

 APP --> ENTRY --> INT
 INT --> O1
 INT --> S1
 O1 --> O2
 O2 --> S2
 S1 --> S4
 S2 --> S4
 S3 --> S4
 S4 -->|"Block"| F1
 S4 -->|"Allow"| O3
 O3 --> O4
 F1 --> O4
 O4 --> E1
 O4 --> E2
 O4 --> E3

 style O1 fill:#1a1d27,stroke:#6366f1
 style O2 fill:#1a1d27,stroke:#6366f1
 style O3 fill:#1a1d27,stroke:#6366f1
 style O4 fill:#1a1d27,stroke:#6366f1
 style S1 fill:#1a1d27,stroke:#f43f5e
 style S2 fill:#1a1d27,stroke:#f43f5e
 style S3 fill:#1a1d27,stroke:#f43f5e
 style S4 fill:#1a1d27,stroke:#f59e0b
 style F1 fill:#1a1d27,stroke:#22c55e
```图 1：双管道架构——观测管道与安全管道在同一拦截点并行触发，裁决结果融合到 Span 中
关键设计决策：当安全策略裁决为 Block 时，请求不会到达 LLM。但 Span 仍然会被创建和导出——只是gen_ai.operation.name标记为"blocked"，security.verdict设为"block"，security.blocked_reason记录具体原因。这意味着即使被拦截的请求也有完整的审计记录。
## 3. 安全检测模型### 3.1 覆盖标准：OWASP LLM + Agentic AI插件的安全检测覆盖 OWASP LLM Top 10（2025）和 OWASP Agentic AI Top 10（2026）两大标准。[1][2]
| **编号** | **风险** | **检测位置** | **检测方式** | **插件覆盖** |
| LLM01 | Prompt Injection | Input Guard | 规则匹配 + 分类模型 | 覆盖 |
| LLM02 | Sensitive Information Disclosure | Output Guard | 正则 + PII 检测 | 覆盖 |
| LLM03 | Supply Chain | — | 依赖扫描（不在本插件范围内） | 外部 |
| LLM04 | Data & Model Poisoning | Input Guard | 异常模式检测 | 覆盖 |
| LLM05 | Improper Output Handling | Output Guard | 输出格式校验 + 危险指令检测 | 覆盖 |
| LLM06 | Excessive Agency | Tool Guard | 工具白名单 + 权限校验 | 覆盖 |
| LLM07 | System Prompt Leakage | Output Guard | 系统提示词相似度比对 | 覆盖 |
| LLM08 | Vector & Embedding Weaknesses | — | 向量数据库层面（不在本插件范围内） | 外部 |
| LLM09 | Misinformation | Output Guard | 事实性评估（可选 LLM-as-Judge） | 可选 |
| LLM10 | Unbounded Consumption | 观测管道 | Token 用量监控 + 成本告警 | 覆盖 |
### 3.2 Agentic AI 特有风险Agent 场景下，除了传统 LLM 风险，还需要关注工具调用层面的安全问题。[3]
ASI02
工具滥用与利用
Agent 以不当权限调用工具，或通过工具接口放大攻击范围。例如诱导 Agent 利用代码解释器执行反向 Shell。
ASI03
身份与特权滥用
Agent 利用赋予的身份权限访问未授权资源，或通过工具调用提升权限。
ASI05
目标劫持
攻击者操纵 Agent 的目标使其服务于攻击目的，同时表面上看似正常执行任务。
ASI06
过度自主
Agent 在没有适当人类监督的情况下执行高风险操作（如删除资源、发起转账）。
## 4. Guard 管道：六阶段安全流水线安全管道借鉴了 Quisium 的六阶段流水线设计，在每个阶段设置检测点和短路机制。[4]
```
flowchart LR
 S1["Stage 1
Input Scan
注入检测 / 越狱检测"]
 S2["Stage 2
Risk Decision
Block / Warn / Allow"]
 S3["Stage 3
Forward to LLM
（仅在 Allow 时）"]
 S4["Stage 4
Output Scan
敏感信息 / 危险指令"]
 S5["Stage 5
Tool Validation
越权检测 / 参数校验"]
 S6["Stage 6
Return Decision
GuardDecision"]

 S1 --> S2
 S2 -->|"Allow"| S3
 S2 -->|"Block"| S6
 S3 --> S4
 S4 --> S5
 S5 --> S6

 style S1 fill:#1a1d27,stroke:#f43f5e
 style S2 fill:#1a1d27,stroke:#f59e0b
 style S3 fill:#1a1d27,stroke:#6366f1
 style S4 fill:#1a1d27,stroke:#f43f5e
 style S5 fill:#1a1d27,stroke:#f43f5e
 style S6 fill:#1a1d27,stroke:#22c55e
```图 2：六阶段安全流水线——任意阶段检测到风险即可短路，阻止请求到达 LLM 或阻止输出返回用户
### 4.1 输入 GuardInput Guard
#### prompt 注入检测 + 越狱检测 + PII 扫描在请求到达 LLM 之前，扫描所有用户输入和系统提示词。检测三类风险：注入攻击（"ignore previous instructions" / "DAN" 越狱变体 / 角色劫持）、PII 泄露（邮箱、手机号、身份证号、API Key 等入参中包含的敏感信息）、恶意载荷（Base64 编码指令、SQL 注入、XSS 等）。延迟预算：5-50ms。
# input_guard.py — 输入安全检测importrefromdataclassesimportdataclass@dataclassclassScanResult:allowed:bool# True = 安全可放行score:float# 0.0（安全）→ 1.0（严重风险）reasons:list[str]# 人类可读的风险原因safe_output:str|None# 脱敏后的文本（仅输出 Guard）# 注入检测模式库INJECTION_PATTERNS= [
(r"ignore\s+(all\s+)?(previous|above)\s+instructions",0.85,"指令覆盖"),
(r"(you\s+are\s+now|pretend\s+you\s+are)\s+the\s+system",0.80,"角色劫持"),
(r"repeat\s+(everything\s+)?(above|the\s+system\s+prompt)",0.90,"上下文泄露"),
(r"\bDAN\b.jailbreak",0.95,"DAN 越狱"),
(r"base64[:\s][A-Za-z0-9+/=]{20,}",0.75,"Base64 编码指令"),
]# PII 检测模式PII_PATTERNS= [
(r"sk-[A-Za-z0-9]{32,}",0.90,"OpenAI API Key"),
(r"1[3-9]\d{9}",0.60,"手机号"),
(r"\b[\w.-]+@[\w.-]+.\w{2,}\b",0.40,"邮箱"),
]defscan_prompt(prompt:str, system_prompt:str="") -> ScanResult:"""扫描 prompt 中的注入/越狱/PII 风险"""reasons = []
max_score =0.0forpattern, score, reasoninINJECTION_PATTERNS:ifre.search(pattern, prompt, re.IGNORECASE):
reasons.append(f"[注入] {reason}")
max_score =max(max_score, score)forpattern, score, reasoninPII_PATTERNS:ifre.search(pattern, prompt):
reasons.append(f"[PII] {reason}")
max_score =max(max_score, score)returnScanResult(
allowed=max_score<0.75,
score=max_score,
reasons=reasons,
safe_output=None,
)
### 4.2 工具 GuardTool Guard
#### 工具调用校验 + 越权检测 + 参数验证在 Agent 调用工具之前，对工具名称、参数和操作目标进行三重校验：白名单校验（工具名是否在允许列表中）、参数校验（参数是否符合 JSON Schema）、危险操作拦截（文件删除、系统命令执行、敏感 API 调用等）。
# tool_guard.py — 工具调用安全检测@dataclassclassToolCall:name:str# e.g. "read_file", "execute_shell"args:dict# e.g. {"path": "/etc/passwd"}schema:dict|None# JSON Schema# 危险工具黑名单DANGEROUS_TOOLS= {"execute_shell":0.95,"delete_file":0.90,"delete_resource":0.90,"run_sql":0.85,"send_http_request":0.70,
}# 危险参数模式DANGEROUS_ARG_PATTERNS= [
(r"rm\s+-rf\s+/",1.0,"递归删除根目录"),
(r"/etc/(passwd|shadow|sudoers)",0.95,"敏感系统文件"),
(r"curl.|\s(ba)?sh",0.95,"远程代码执行"),
(r"DROP\s+TABLE|DELETE\s+FROM",0.90,"数据库破坏"),
]defvalidate_tool_call(call: ToolCall, policy:"Policy") -> ScanResult:"""校验工具调用是否安全"""reasons = []
max_score =0.0# 1. 白名单校验ifpolicy.allowed_toolsandcall.namenot inpolicy.allowed_tools:returnScanResult(allowed=False, score=1.0,
reasons=[f"工具 '{call.name}' 不在白名单中"])# 2. 危险工具检测ifcall.nameinDANGEROUS_TOOLS:
score = DANGEROUS_TOOLS[call.name]
reasons.append(f"检测到危险工具: {call.name} (风险 {score})")
max_score =max(max_score, score)# 3. 危险参数检测forkey, valueincall.args.items():ifisinstance(value,str):forpattern, score, reasoninDANGEROUS_ARG_PATTERNS:ifre.search(pattern, value):
reasons.append(f"参数 '{key}' 包含危险操作: {reason}")
max_score =max(max_score, score)returnScanResult(
allowed=max_score<policy.block_threshold,
score=max_score,
reasons=reasons,
)
### 4.3 输出 GuardOutput Guard
#### 敏感信息泄露检测 + 危险指令检测 + 系统提示词泄露检测在 LLM 响应返回给用户之前，扫描输出内容：凭证泄露（API Key、JWT、SSH 私钥、密码）、危险指令（Shell 命令、恶意代码、自毁指令）、系统提示词泄露（输出内容与系统提示词的相似度比对）。可选择脱敏而非直接阻断。
# output_guard.py — 输出安全检测defscan_output(text:str, system_prompt:str="") -> ScanResult:"""扫描 LLM 输出中的安全风险"""reasons = []max_score =0.0# 1. 凭证泄露检测forpattern, score, reasonin[
(r"sk-[A-Za-z0-9]{32,}",0.95,"OpenAI API Key"),
(r"eyJ[A-Za-z0-9_-]{10,}.[A-Za-z0-9_-]{10,}.[A-Za-z0-9_-]{10,}",0.90,"JWT Token"),
(r"-----BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE KEY-----",0.95,"SSH 私钥"),
]:ifre.search(pattern, text):
reasons.append(f"[泄露] {reason}")
max_score =max(max_score, score)# 2. 危险指令检测forpattern, score, reasonin[
(r"\brm\s+-rf\b",0.95,"递归删除指令"),
(r"\bcurl\b.|.\b(ba)?sh\b",0.95,"远程代码执行"),
(r"\beval\s*(.*)",0.80,"动态代码执行"),
]:ifre.search(pattern, text):
reasons.append(f"[危险指令] {reason}")
max_score =max(max_score, score)# 3. 系统提示词泄露检测ifsystem_promptand_similarity(text, system_prompt) >0.60:
reasons.append("[泄露] 输出内容与系统提示词高度相似")
max_score =max(max_score,0.85)returnScanResult(allowed=max_score<0.75, score=max_score, reasons=reasons)
## 5. 可观测性管道：完整 Span 树观测管道的设计继承自前两份文档的核心方案，但增强了对Agent 内部完整推理链路的追踪——不仅覆盖 LLM 调用，还覆盖工具调用、多步推理、MCP 协议等 Agent 特有的环节。
```
sequenceDiagram
 participant App as 业务应用
 participant Plugin as 插件
 participant LLM as LLM API
 participant Tool as 外部工具
 participant OTel as OTLP Collector

 App->>Plugin: invoke_agent(query)
 Note over Plugin: Span: invoke_agent (root)

 Plugin->>LLM: 第一次 LLM 调用
 Note over Plugin: Span: chat gpt-4o (step 1)
 Note over Plugin: Input Guard 扫描通过

 LLM-->>Plugin: 返回 tool_call: search_weather
 Note over Plugin: Tool Guard 校验通过

 Plugin->>Tool: execute_tool: search_weather
 Note over Plugin: Span: execute_tool search_weather

 Tool-->>Plugin: 天气数据

 Plugin->>LLM: 第二次 LLM 调用
 Note over Plugin: Span: chat gpt-4o (step 2)

 LLM-->>Plugin: 最终回复
 Note over Plugin: Output Guard 扫描通过

 Plugin-->>App: 返回结果
 Note over Plugin: Span: invoke_agent 结束

 Plugin->>OTel: 导出完整 Span 树
 Note over OTel: invoke_agent
├── chat gpt-4o (step 1)
│ ├── security.input_scan
│ └── security.tool_scan
├── execute_tool search_weather
└── chat gpt-4o (step 2)
└── security.output_scan
```图 3：完整 Agent 调用的 Span 树——包含 LLM 调用、工具调用和安全检测三个维度
### 5.1 新增的安全 Span在原有 Span 树基础上，每个 Guard 阶段都会创建独立的子 Span：
| **Span 名称** | **父 Span** | **记录属性** |
| security.input_scan | chat Span | security.verdict,security.risk_score,security.scan_duration_ms,security.matched_patterns |
| security.output_scan | chat Span | security.verdict,security.risk_score,security.leaked_data_type |
| security.tool_scan | execute_tool Span | security.verdict,security.risk_score,security.tool_name,security.blocked_args |
## 6. 双层融合：安全裁决写入 Span这是插件最核心的创新点：将安全裁决作为 Span 属性写入 Trace，使得安全事件与调用链路形成完整的关联关系。
### 6.1 融合数据模型# 安全裁决写入 Span 的标准属性@dataclassclassGuardDecision:"""安全裁决——聚合所有 Guard 的扫描结果"""allowed:bool# 是否放行score:float# 最高风险分 0.0-1.0reasons:list[str]# 风险原因列表scan_results:list[ScanResult]# 各 Guard 的详细结果stage:str# "input" | "output" | "tool"defattach_decision_to_span(span: trace.Span, decision: GuardDecision):"""将 GuardDecision 写入 Span 属性"""span.set_attribute("security.verdict","block"if notdecision.allowedelse"allow")span.set_attribute("security.risk_score", decision.score)
span.set_attribute("security.stage", decision.stage)if notdecision.allowed:
span.set_attribute("security.blocked_reason","; ".join(decision.reasons))
span.set_status(trace.StatusCode.ERROR,"安全策略拦截")
### 6.2 融合后的 Span 属性全景| **属性类别** | **属性名** | **来源管道** | **示例值** |
| GenAI 标准 | gen_ai.operation.name | 观测 | "chat"/"blocked" |
| gen_ai.request.model | 观测 | "gpt-4o" |
| gen_ai.usage.input_tokens | 观测 | 1234 |
| gen_ai.usage.output_tokens | 观测 | 567 |
| 安全 | security.verdict | 安全 | "allow"/"block"/"warn" |
| security.risk_score | 安全 | 0.85 |
| security.stage | 安全 | "input"/"output"/"tool" |
| security.blocked_reason | 安全 | "[注入] 指令覆盖; [PII] API Key" |
| security.matched_patterns | 安全 | ["ignore previous instructions", "sk-***"] |
关键设计决策——Block 也生成 Span：当安全策略裁决为 Block 时，请求不会到达 LLM，但 Span 仍然会被创建。gen_ai.operation.name设为"blocked"，gen_ai.usage.*全部为 0。这样后端可以按security.verdict = "block"过滤出所有被拦截的请求，生成安全审计报告和告警。
## 7. 插件化接入方案### 7.1 零代码模式与前两份文档一致，插件通过运行时注入实现零代码接入。安全检测能力作为独立模块，通过配置开关控制：
# 环境变量控制AI_OBS_ENABLED=true# 总开关AI_OBS_SECURITY_ENABLED=true# 安全检测开关AI_OBS_SECURITY_MODE=strict# strict | balanced | logging_onlyAI_OBS_SECURITY_BLOCK_THRESHOLD=0.75# 启动命令（零代码）pythonapp.py# sitecustomize.py 自动加载插件# 或一行代码importai_obs_plugin; ai_obs_plugin.init(security_mode="strict",
block_threshold=0.75,
allowed_tools=["search_weather","read_file","send_email"],
)
### 7.2 装饰器模式：手动标注安全边界对于自定义 Agent 编排，提供装饰器来手动声明需要安全检测的节点：
fromai_obs_pluginimportobserve, security@observe(name="invoke_agent travel-planner")@security(input_guard=True, output_guard=True, tool_guard=True)async deftravel_planner(query:str) ->str:async withobserve(name="execute_tool search_weather"):@security(tool_guard=True, allowed_tools=["search_weather"])async defsearch(location):return awaitweather_api.search(location)
response =awaitllm.generate(query, weather_data)returnresponse
### 7.3 中间件模式：FastAPI 集成# FastAPI 中间件 —— 一行代码接入fromfastapiimportFastAPIfromai_obs_pluginimportAIObsMiddlewareapp= FastAPI()app.add_middleware(AIObsMiddleware, security_mode="balanced")@app.post("/v1/chat/completions")async defchat(request: ChatRequest):# 业务代码完全不变pass## 8. 策略配置引擎### 8.1 策略模型# policy.yaml — 策略配置文件policies:# 默认策略default: balanced# 严格模式：生产环境strict:input_guard_enabled: trueoutput_guard_enabled: truetool_guard_enabled: trueblock_threshold:0.60# 较低的阻断阈值warn_threshold:0.30raise_on_block: true# 阻断时抛异常allowed_tools:# 工具白名单- search_weather- read_file- send_email# 均衡模式：默认balanced:input_guard_enabled: trueoutput_guard_enabled: truetool_guard_enabled: trueblock_threshold:0.75warn_threshold:0.40raise_on_block: true# 仅日志模式：开发/测试logging_only:input_guard_enabled: trueoutput_guard_enabled: truetool_guard_enabled: trueblock_threshold:1.0# 永不阻断warn_threshold:0.30raise_on_block: false# 仅记录日志# 按路由/端点覆盖策略rules:- path: /api/internal/agent/*policy: strict- path: /api/public/chatpolicy: balanced- model: gpt-4o-minipolicy: balanced- model: gpt-4opolicy: strict### 8.2 策略生效流程```
flowchart TD
 REQ["请求到达"] --> MATCH{"路径/模型
匹配规则？"}
 MATCH -->|"是"| USE_RULE["使用匹配的策略"]
 MATCH -->|"否"| USE_DEFAULT["使用默认策略"]

 USE_RULE --> INPUT
 USE_DEFAULT --> INPUT

 INPUT["Input Guard 扫描"] --> CHECK{score > block_threshold?}
 CHECK -->|"是"| BLOCK["Block: 返回 403
写入 security.verdict=block"]
 CHECK -->|"否"| WARN{score > warn_threshold?}
 WARN -->|"是"| LOG_WARN["Warn: 记录日志
security.verdict=warn"]
 WARN -->|"否"| ALLOW["Allow: 放行到 LLM"]

 LOG_WARN --> ALLOW
 ALLOW --> LLM["LLM 调用"]
 LLM --> OUTPUT["Output Guard 扫描"]
 OUTPUT --> TOOL["Tool Guard 扫描"]
 TOOL --> RETURN["返回 GuardDecision"]

 style BLOCK fill:#1a1d27,stroke:#f43f5e,stroke-width:2px
 style ALLOW fill:#1a1d27,stroke:#22c55e
 style LOG_WARN fill:#1a1d27,stroke:#f59e0b
```图 4：策略生效流程——从请求到达到最终裁决的完整决策路径
## 9. 实现路线图- 阶段一：核心 Guard 引擎4 周
实现 Input Guard（注入检测 + 越狱检测 + PII 扫描）、Output Guard（凭证泄露 + 危险指令 + 系统提示词泄露）、Tool Guard（白名单 + 危险参数检测）。策略引擎（Policy + 三种预设模式）。GuardDecision 数据模型。- 阶段二：观测管道融合3 周
将 Guard 管道集成到现有拦截器引擎中。实现裁决写入 Span（security.* 属性）。安全 Span 的父子关系建模。Block 场景下的 Span 生命周期管理。- 阶段三：插件化封装3 周
Python 插件包封装（sitecustomize + import hook）。装饰器 API（@observe + @security）。中间件 API（FastAPI / Flask）。零代码接入验证。配置热更新支持。- 阶段四：高级检测能力4 周
LLM-as-Judge 安全评估（利用轻量级模型做二次判断）。Agent 行为异常检测（基于历史 pattern 的异常行为识别）。OWASP Agentic AI Top 10 全覆盖。多语言支持（Java Agent + Node.js）。## Sources- OWASP, "OWASP Top 10 for LLM Applications 2025" — LLM 应用十大安全风险，覆盖 Prompt Injection、Sensitive Information Disclosure、Excessive Agency 等核心风险。https://genai.owasp.org/- OWASP, "OWASP Agentic Skills Top 10" — Agentic AI 技能安全风险，2026 年新增，覆盖工具滥用、身份特权滥用、目标劫持、过度自主等风险。https://owasp.org/www-project-agentic-skills-top-10/- OWASP, "AI Agent Security Cheat Sheet" — AI Agent 安全防护清单，涵盖 Tool Abuse、Data Exfiltration、Memory Poisoning、Goal Hijacking、Excessive Autonomy 等风险。https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html- Quisium, "Production-grade security middleware for LLM calls" — Python 安全中间件库，六阶段 Guard 流水线（input scan → risk decision → forward → output scan → tool validation → return），支持策略配置和可插拔架构。https://github.com/siphalion/quisium- NVIDIA, "NeMo Guardrails" — 可扩展的 AI 护栏编排方案，支持主题控制、PII 检测、RAG 真实性、越狱防护、多语言多模态内容安全。https://developer.nvidia.com/nemo-guardrails