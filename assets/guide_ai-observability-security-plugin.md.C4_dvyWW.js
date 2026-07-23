import{_ as n,o as a,c as p,a2 as e}from"./chunks/framework.CHeM0PsO.js";const d=JSON.parse('{"title":"AI 可观测性与安全一体化插件设计方案","description":"","frontmatter":{"title":"AI 可观测性与安全一体化插件设计方案"},"headers":[],"relativePath":"guide/ai-observability-security-plugin.md","filePath":"guide/ai-observability-security-plugin.md","lastUpdated":1784762596000}'),t={name:"guide/ai-observability-security-plugin.md"};function l(o,s,i,u,c,r){return a(),p("div",null,[...s[0]||(s[0]=[e(`<h1 id="ai-可观测性与安全一体化插件设计方案" tabindex="-1">AI 可观测性与安全一体化插件设计方案 <a class="header-anchor" href="#ai-可观测性与安全一体化插件设计方案" aria-label="Permalink to &quot;AI 可观测性与安全一体化插件设计方案&quot;">​</a></h1><blockquote><p><strong>技术设计文档v1.0</strong> | 2026-07-19 | 受众：架构师 / 安全工程师 / 平台工程师</p></blockquote><h2 id="目录" tabindex="-1">目录 <a class="header-anchor" href="#目录" aria-label="Permalink to &quot;目录&quot;">​</a></h2><ul><li>背景与动机</li><li>整体架构：双管道设计</li><li>安全检测模型</li><li>Guard 管道：六阶段安全流水线</li><li>可观测性管道：完整 Span 树</li><li>双层融合：安全裁决写入 Span</li><li>插件化接入方案</li><li>策略配置引擎</li><li>实现路线图</li></ul><h2 id="_1-背景与动机" tabindex="-1">1. 背景与动机 <a class="header-anchor" href="#_1-背景与动机" aria-label="Permalink to &quot;1. 背景与动机&quot;">​</a></h2><p>前两份文档分别设计了 SDK 层可观测性插件和网关层可观测性方案。但实际生产环境中，只观测不设防等于只装了监控摄像头却没装门锁——你能看到攻击发生，但阻止不了它。 安全测试和安全审计是 AI 系统上线前的&quot;体检&quot;，但生产环境中的攻击不会只发生在测试期间。一个真正可用的插件需要在观测每一次 AI 调用的同时，判断操作是否安全，并在必要时阻断。这需要把可观测性（Trace / Span / Metrics）和安全护栏（Guard / Policy / Block）两套逻辑融合到一个插件中。 观测 + 设防 双重能力 OWASP Top 10 覆盖标准 安全裁决入 Span 追踪闭环 核心设计目标：一个插件，同时完成两件事——① 追踪每一次 AI 调用的完整链路（谁调了什么模型、用了什么工具、消耗了多少 token）；② 在每个关键节点判断操作是否安全（输入是否含注入、工具调用是否越权、输出是否泄露敏感信息），将安全裁决作为 Span 属性写入 Trace，形成可审计的安全记录。</p><h2 id="_2-整体架构-双管道设计" tabindex="-1">2. 整体架构：双管道设计 <a class="header-anchor" href="#_2-整体架构-双管道设计" aria-label="Permalink to &quot;2. 整体架构：双管道设计&quot;">​</a></h2><p>插件核心采用双管道并行架构：观测管道负责 Trace/Span 生成和导出，安全管道负责输入/输出/工具调用的风险检测和裁决。两条管道在同一拦截点触发，裁决结果写入 Span 属性。</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>graph TB</span></span>
<span class="line"><span> subgraph &quot;应用代码&quot;</span></span>
<span class="line"><span> APP[&quot;AI 应用 / Agent&quot;]</span></span>
<span class="line"><span> end</span></span>
<span class="line"><span></span></span>
<span class="line"><span> subgraph &quot;插件入口&quot;</span></span>
<span class="line"><span> ENTRY[&quot;PluginManager</span></span>
<span class="line"><span>sitecustomize / -javaagent / --require&quot;]</span></span>
<span class="line"><span> end</span></span>
<span class="line"><span></span></span>
<span class="line"><span> subgraph &quot;拦截器引擎&quot;</span></span>
<span class="line"><span> INT[&quot;InterceptorEngine</span></span>
<span class="line"><span>拦截 OpenAI / Anthropic / LangChain / MCP&quot;]</span></span>
<span class="line"><span> end</span></span>
<span class="line"><span></span></span>
<span class="line"><span> subgraph &quot;双管道&quot;</span></span>
<span class="line"><span> direction TB</span></span>
<span class="line"><span></span></span>
<span class="line"><span> subgraph &quot;观测管道 Observability Pipeline&quot;</span></span>
<span class="line"><span> O1[&quot;PreHook</span></span>
<span class="line"><span>创建 Span</span></span>
<span class="line"><span>记录开始时间&quot;]</span></span>
<span class="line"><span> O2[&quot;SpanBuilder</span></span>
<span class="line"><span>填充 GenAI 属性</span></span>
<span class="line"><span>trace_id / model / tokens&quot;]</span></span>
<span class="line"><span> O3[&quot;PostHook</span></span>
<span class="line"><span>结束 Span</span></span>
<span class="line"><span>记录延迟&quot;]</span></span>
<span class="line"><span> O4[&quot;ExporterChain</span></span>
<span class="line"><span>OTLP gRPC 导出&quot;]</span></span>
<span class="line"><span> end</span></span>
<span class="line"><span></span></span>
<span class="line"><span> subgraph &quot;安全管道 Security Pipeline&quot;</span></span>
<span class="line"><span> S1[&quot;InputGuard</span></span>
<span class="line"><span>prompt 注入检测</span></span>
<span class="line"><span>越狱检测 / PII 扫描&quot;]</span></span>
<span class="line"><span> S2[&quot;ToolGuard</span></span>
<span class="line"><span>工具调用校验</span></span>
<span class="line"><span>越权检测 / 参数验证&quot;]</span></span>
<span class="line"><span> S3[&quot;OutputGuard</span></span>
<span class="line"><span>输出内容检测</span></span>
<span class="line"><span>敏感信息泄露 / 危险指令&quot;]</span></span>
<span class="line"><span> S4[&quot;PolicyEngine</span></span>
<span class="line"><span>裁决：Block / Warn / Allow&quot;]</span></span>
<span class="line"><span> end</span></span>
<span class="line"><span> end</span></span>
<span class="line"><span></span></span>
<span class="line"><span> subgraph &quot;融合层&quot;</span></span>
<span class="line"><span> F1[&quot;裁决写入 Span</span></span>
<span class="line"><span>security.verdict / security.risk_score</span></span>
<span class="line"><span>security.blocked_reason&quot;]</span></span>
<span class="line"><span> end</span></span>
<span class="line"><span></span></span>
<span class="line"><span> subgraph &quot;导出&quot;</span></span>
<span class="line"><span> E1[&quot;OTLP Collector&quot;]</span></span>
<span class="line"><span> E2[&quot;审计日志&quot;]</span></span>
<span class="line"><span> E3[&quot;告警系统&quot;]</span></span>
<span class="line"><span> end</span></span>
<span class="line"><span></span></span>
<span class="line"><span> APP --&gt; ENTRY --&gt; INT</span></span>
<span class="line"><span> INT --&gt; O1</span></span>
<span class="line"><span> INT --&gt; S1</span></span>
<span class="line"><span> O1 --&gt; O2</span></span>
<span class="line"><span> O2 --&gt; S2</span></span>
<span class="line"><span> S1 --&gt; S4</span></span>
<span class="line"><span> S2 --&gt; S4</span></span>
<span class="line"><span> S3 --&gt; S4</span></span>
<span class="line"><span> S4 --&gt;|&quot;Block&quot;| F1</span></span>
<span class="line"><span> S4 --&gt;|&quot;Allow&quot;| O3</span></span>
<span class="line"><span> O3 --&gt; O4</span></span>
<span class="line"><span> F1 --&gt; O4</span></span>
<span class="line"><span> O4 --&gt; E1</span></span>
<span class="line"><span> O4 --&gt; E2</span></span>
<span class="line"><span> O4 --&gt; E3</span></span>
<span class="line"><span></span></span>
<span class="line"><span> style O1 fill:#1a1d27,stroke:#6366f1</span></span>
<span class="line"><span> style O2 fill:#1a1d27,stroke:#6366f1</span></span>
<span class="line"><span> style O3 fill:#1a1d27,stroke:#6366f1</span></span>
<span class="line"><span> style O4 fill:#1a1d27,stroke:#6366f1</span></span>
<span class="line"><span> style S1 fill:#1a1d27,stroke:#f43f5e</span></span>
<span class="line"><span> style S2 fill:#1a1d27,stroke:#f43f5e</span></span>
<span class="line"><span> style S3 fill:#1a1d27,stroke:#f43f5e</span></span>
<span class="line"><span> style S4 fill:#1a1d27,stroke:#f59e0b</span></span>
<span class="line"><span> style F1 fill:#1a1d27,stroke:#22c55e</span></span>
<span class="line"><span>\`\`\`图 1：双管道架构——观测管道与安全管道在同一拦截点并行触发，裁决结果融合到 Span 中</span></span>
<span class="line"><span>关键设计决策：当安全策略裁决为 Block 时，请求不会到达 LLM。但 Span 仍然会被创建和导出——只是gen_ai.operation.name标记为&quot;blocked&quot;，security.verdict设为&quot;block&quot;，security.blocked_reason记录具体原因。这意味着即使被拦截的请求也有完整的审计记录。</span></span>
<span class="line"><span>## 3. 安全检测模型</span></span>
<span class="line"><span></span></span>
<span class="line"><span>### 3.1 覆盖标准：OWASP LLM + Agentic AI插件的安全检测覆盖 OWASP LLM Top 10（2025）</span></span>
<span class="line"><span></span></span>
<span class="line"><span>和 OWASP Agentic AI Top 10（2026）两大标准。[1][2]</span></span>
<span class="line"><span>| **编号** | **风险** | **检测位置** | **检测方式** | **插件覆盖** |</span></span>
<span class="line"><span>| LLM01 | Prompt Injection | Input Guard | 规则匹配 + 分类模型 | 覆盖 |</span></span>
<span class="line"><span>| LLM02 | Sensitive Information Disclosure | Output Guard | 正则 + PII 检测 | 覆盖 |</span></span>
<span class="line"><span>| LLM03 | Supply Chain | — | 依赖扫描（不在本插件范围内） | 外部 |</span></span>
<span class="line"><span>| LLM04 | Data &amp; Model Poisoning | Input Guard | 异常模式检测 | 覆盖 |</span></span>
<span class="line"><span>| LLM05 | Improper Output Handling | Output Guard | 输出格式校验 + 危险指令检测 | 覆盖 |</span></span>
<span class="line"><span>| LLM06 | Excessive Agency | Tool Guard | 工具白名单 + 权限校验 | 覆盖 |</span></span>
<span class="line"><span>| LLM07 | System Prompt Leakage | Output Guard | 系统提示词相似度比对 | 覆盖 |</span></span>
<span class="line"><span>| LLM08 | Vector &amp; Embedding Weaknesses | — | 向量数据库层面（不在本插件范围内） | 外部 |</span></span>
<span class="line"><span>| LLM09 | Misinformation | Output Guard | 事实性评估（可选 LLM-as-Judge） | 可选 |</span></span>
<span class="line"><span>| LLM10 | Unbounded Consumption | 观测管道 | Token 用量监控 + 成本告警 | 覆盖 |</span></span>
<span class="line"><span>### 3.2 Agentic AI 特有风险Agent 场景下，除了传统 LLM 风险，还需要关注工具调用层面的安全问题。[3]</span></span>
<span class="line"><span>ASI02</span></span>
<span class="line"><span>工具滥用与利用</span></span>
<span class="line"><span>Agent 以不当权限调用工具，或通过工具接口放大攻击范围。例如诱导 Agent 利用代码解释器执行反向 Shell。</span></span>
<span class="line"><span>ASI03</span></span>
<span class="line"><span>身份与特权滥用</span></span>
<span class="line"><span>Agent 利用赋予的身份权限访问未授权资源，或通过工具调用提升权限。</span></span>
<span class="line"><span>ASI05</span></span>
<span class="line"><span>目标劫持</span></span>
<span class="line"><span>攻击者操纵 Agent 的目标使其服务于攻击目的，同时表面上看似正常执行任务。</span></span>
<span class="line"><span>ASI06</span></span>
<span class="line"><span>过度自主</span></span>
<span class="line"><span>Agent 在没有适当人类监督的情况下执行高风险操作（如删除资源、发起转账）。</span></span>
<span class="line"><span>## 4. Guard 管道：六阶段安全流水线</span></span>
<span class="line"><span></span></span>
<span class="line"><span>安全管道借鉴了 Quisium 的六阶段流水线设计，在每个阶段设置检测点和短路机制。[4]</span></span></code></pre></div><p>flowchart LR S1[&quot;Stage 1 Input Scan 注入检测 / 越狱检测&quot;] S2[&quot;Stage 2 Risk Decision Block / Warn / Allow&quot;] S3[&quot;Stage 3 Forward to LLM （仅在 Allow 时）&quot;] S4[&quot;Stage 4 Output Scan 敏感信息 / 危险指令&quot;] S5[&quot;Stage 5 Tool Validation 越权检测 / 参数校验&quot;] S6[&quot;Stage 6 Return Decision GuardDecision&quot;]</p><p>S1 --&gt; S2 S2 --&gt;|&quot;Allow&quot;| S3 S2 --&gt;|&quot;Block&quot;| S6 S3 --&gt; S4 S4 --&gt; S5 S5 --&gt; S6</p><p>style S1 fill:#1a1d27,stroke:#f43f5e style S2 fill:#1a1d27,stroke:#f59e0b style S3 fill:#1a1d27,stroke:#6366f1 style S4 fill:#1a1d27,stroke:#f43f5e style S5 fill:#1a1d27,stroke:#f43f5e style S6 fill:#1a1d27,stroke:#22c55e</p><div class="language-图 vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">图</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>### 4.1 输入 GuardInput Guard</span></span>
<span class="line highlighted"><span>#### prompt 注入检测 + 越狱检测 + PII 扫描在请求到达 LLM 之前，扫描所有用户输入和系统提示词。检测三类风险：注入攻击（&quot;ignore previous instructions&quot; / &quot;DAN&quot; 越狱变体 / 角色劫持）、PII 泄露（邮箱、手机号、身份证号、API Key 等入参中包含的敏感信息）、恶意载荷（Base64 编码指令、SQL 注入、XSS 等）。延迟预算：5-50ms。</span></span>
<span class="line"><span># input_guard.py — 输入安全检测importrefromdataclassesimportdataclass@dataclassclassScanResult:allowed:bool# True = 安全可放行score:float# 0.0（安全）→ 1.0（严重风险）reasons:list[str]# 人类可读的风险原因safe_output:str|None# 脱敏后的文本（仅输出 Guard）# 注入检测模式库INJECTION_PATTERNS= [</span></span>
<span class="line"><span>(r&quot;ignore\\s+(all\\s+)?(previous|above)\\s+instructions&quot;,0.85,&quot;指令覆盖&quot;),</span></span>
<span class="line"><span>(r&quot;(you\\s+are\\s+now|pretend\\s+you\\s+are)\\s+the\\s+system&quot;,0.80,&quot;角色劫持&quot;),</span></span>
<span class="line"><span>(r&quot;repeat\\s+(everything\\s+)?(above|the\\s+system\\s+prompt)&quot;,0.90,&quot;上下文泄露&quot;),</span></span>
<span class="line"><span>(r&quot;\\bDAN\\b.jailbreak&quot;,0.95,&quot;DAN 越狱&quot;),</span></span>
<span class="line"><span>(r&quot;base64[:\\s][A-Za-z0-9+/=]{20,}&quot;,0.75,&quot;Base64 编码指令&quot;),</span></span>
<span class="line"><span>]# PII 检测模式PII_PATTERNS= [</span></span>
<span class="line"><span>(r&quot;sk-[A-Za-z0-9]{32,}&quot;,0.90,&quot;OpenAI API Key&quot;),</span></span>
<span class="line"><span>(r&quot;1[3-9]\\d{9}&quot;,0.60,&quot;手机号&quot;),</span></span>
<span class="line"><span>(r&quot;\\b[\\w.-]+@[\\w.-]+.\\w{2,}\\b&quot;,0.40,&quot;邮箱&quot;),</span></span>
<span class="line"><span>]defscan_prompt(prompt:str, system_prompt:str=&quot;&quot;) -&gt; ScanResult:&quot;&quot;&quot;扫描 prompt 中的注入/越狱/PII 风险&quot;&quot;&quot;reasons = []</span></span>
<span class="line"><span>max_score =0.0forpattern, score, reasoninINJECTION_PATTERNS:ifre.search(pattern, prompt, re.IGNORECASE):</span></span>
<span class="line"><span>reasons.append(f&quot;[注入] {reason}&quot;)</span></span>
<span class="line"><span>max_score =max(max_score, score)forpattern, score, reasoninPII_PATTERNS:ifre.search(pattern, prompt):</span></span>
<span class="line"><span>reasons.append(f&quot;[PII] {reason}&quot;)</span></span>
<span class="line"><span>max_score =max(max_score, score)returnScanResult(</span></span>
<span class="line"><span>allowed=max_score&lt;0.75,</span></span>
<span class="line"><span>score=max_score,</span></span>
<span class="line"><span>reasons=reasons,</span></span>
<span class="line"><span>safe_output=None,</span></span>
<span class="line"><span>)</span></span>
<span class="line"><span>### 4.2 工具 GuardTool Guard</span></span>
<span class="line"><span>#### 工具调用校验 + 越权检测 + 参数验证在 Agent 调用工具之前，对工具名称、参数和操作目标进行三重校验：白名单校验（工具名是否在允许列表中）、参数校验（参数是否符合 JSON Schema）、危险操作拦截（文件删除、系统命令执行、敏感 API 调用等）。</span></span>
<span class="line"><span># tool_guard.py — 工具调用安全检测@dataclassclassToolCall:name:str# e.g. &quot;read_file&quot;, &quot;execute_shell&quot;args:dict# e.g. {&quot;path&quot;: &quot;/etc/passwd&quot;}schema:dict|None# JSON Schema# 危险工具黑名单DANGEROUS_TOOLS= {&quot;execute_shell&quot;:0.95,&quot;delete_file&quot;:0.90,&quot;delete_resource&quot;:0.90,&quot;run_sql&quot;:0.85,&quot;send_http_request&quot;:0.70,</span></span>
<span class="line"><span>}# 危险参数模式DANGEROUS_ARG_PATTERNS= [</span></span>
<span class="line"><span>(r&quot;rm\\s+-rf\\s+/&quot;,1.0,&quot;递归删除根目录&quot;),</span></span>
<span class="line"><span>(r&quot;/etc/(passwd|shadow|sudoers)&quot;,0.95,&quot;敏感系统文件&quot;),</span></span>
<span class="line"><span>(r&quot;curl.|\\s(ba)?sh&quot;,0.95,&quot;远程代码执行&quot;),</span></span>
<span class="line"><span>(r&quot;DROP\\s+TABLE|DELETE\\s+FROM&quot;,0.90,&quot;数据库破坏&quot;),</span></span>
<span class="line"><span>]defvalidate_tool_call(call: ToolCall, policy:&quot;Policy&quot;) -&gt; ScanResult:&quot;&quot;&quot;校验工具调用是否安全&quot;&quot;&quot;reasons = []</span></span>
<span class="line"><span>max_score =0.0# 1. 白名单校验ifpolicy.allowed_toolsandcall.namenot inpolicy.allowed_tools:returnScanResult(allowed=False, score=1.0,</span></span>
<span class="line"><span>reasons=[f&quot;工具 &#39;{call.name}&#39; 不在白名单中&quot;])# 2. 危险工具检测ifcall.nameinDANGEROUS_TOOLS:</span></span>
<span class="line"><span>score = DANGEROUS_TOOLS[call.name]</span></span>
<span class="line"><span>reasons.append(f&quot;检测到危险工具: {call.name} (风险 {score})&quot;)</span></span>
<span class="line"><span>max_score =max(max_score, score)# 3. 危险参数检测forkey, valueincall.args.items():ifisinstance(value,str):forpattern, score, reasoninDANGEROUS_ARG_PATTERNS:ifre.search(pattern, value):</span></span>
<span class="line"><span>reasons.append(f&quot;参数 &#39;{key}&#39; 包含危险操作: {reason}&quot;)</span></span>
<span class="line"><span>max_score =max(max_score, score)returnScanResult(</span></span>
<span class="line"><span>allowed=max_score&lt;policy.block_threshold,</span></span>
<span class="line"><span>score=max_score,</span></span>
<span class="line"><span>reasons=reasons,</span></span>
<span class="line"><span>)</span></span>
<span class="line"><span>### 4.3 输出 GuardOutput Guard</span></span>
<span class="line"><span>#### 敏感信息泄露检测 + 危险指令检测 + 系统提示词泄露检测在 LLM 响应返回给用户之前，扫描输出内容：凭证泄露（API Key、JWT、SSH 私钥、密码）、危险指令（Shell 命令、恶意代码、自毁指令）、系统提示词泄露（输出内容与系统提示词的相似度比对）。可选择脱敏而非直接阻断。</span></span>
<span class="line"><span># output_guard.py — 输出安全检测defscan_output(text:str, system_prompt:str=&quot;&quot;) -&gt; ScanResult:&quot;&quot;&quot;扫描 LLM 输出中的安全风险&quot;&quot;&quot;reasons = []max_score =0.0# 1. 凭证泄露检测forpattern, score, reasonin[</span></span>
<span class="line"><span>(r&quot;sk-[A-Za-z0-9]{32,}&quot;,0.95,&quot;OpenAI API Key&quot;),</span></span>
<span class="line"><span>(r&quot;eyJ[A-Za-z0-9_-]{10,}.[A-Za-z0-9_-]{10,}.[A-Za-z0-9_-]{10,}&quot;,0.90,&quot;JWT Token&quot;),</span></span>
<span class="line"><span>(r&quot;-----BEGIN\\s+(RSA|EC|DSA|OPENSSH)\\s+PRIVATE KEY-----&quot;,0.95,&quot;SSH 私钥&quot;),</span></span>
<span class="line"><span>]:ifre.search(pattern, text):</span></span>
<span class="line"><span>reasons.append(f&quot;[泄露] {reason}&quot;)</span></span>
<span class="line"><span>max_score =max(max_score, score)# 2. 危险指令检测forpattern, score, reasonin[</span></span>
<span class="line"><span>(r&quot;\\brm\\s+-rf\\b&quot;,0.95,&quot;递归删除指令&quot;),</span></span>
<span class="line"><span>(r&quot;\\bcurl\\b.|.\\b(ba)?sh\\b&quot;,0.95,&quot;远程代码执行&quot;),</span></span>
<span class="line"><span>(r&quot;\\beval\\s*(.*)&quot;,0.80,&quot;动态代码执行&quot;),</span></span>
<span class="line"><span>]:ifre.search(pattern, text):</span></span>
<span class="line"><span>reasons.append(f&quot;[危险指令] {reason}&quot;)</span></span>
<span class="line"><span>max_score =max(max_score, score)# 3. 系统提示词泄露检测ifsystem_promptand_similarity(text, system_prompt) &gt;0.60:</span></span>
<span class="line"><span>reasons.append(&quot;[泄露] 输出内容与系统提示词高度相似&quot;)</span></span>
<span class="line"><span>max_score =max(max_score,0.85)returnScanResult(allowed=max_score&lt;0.75, score=max_score, reasons=reasons)</span></span>
<span class="line"><span>## 5. 可观测性管道：完整 Span 树</span></span>
<span class="line"><span></span></span>
<span class="line"><span>观测管道的设计继承自前两份文档的核心方案，但增强了对Agent 内部完整推理链路的追踪——不仅覆盖 LLM 调用，还覆盖工具调用、多步推理、MCP 协议等 Agent 特有的环节。</span></span></code></pre></div><p>sequenceDiagram participant App as 业务应用 participant Plugin as 插件 participant LLM as LLM API participant Tool as 外部工具 participant OTel as OTLP Collector</p><p>App-&gt;&gt;Plugin: invoke_agent(query) Note over Plugin: Span: invoke_agent (root)</p><p>Plugin-&gt;&gt;LLM: 第一次 LLM 调用 Note over Plugin: Span: chat gpt-4o (step 1) Note over Plugin: Input Guard 扫描通过</p><p>LLM--&gt;&gt;Plugin: 返回 tool_call: search_weather Note over Plugin: Tool Guard 校验通过</p><p>Plugin-&gt;&gt;Tool: execute_tool: search_weather Note over Plugin: Span: execute_tool search_weather</p><p>Tool--&gt;&gt;Plugin: 天气数据</p><p>Plugin-&gt;&gt;LLM: 第二次 LLM 调用 Note over Plugin: Span: chat gpt-4o (step 2)</p><p>LLM--&gt;&gt;Plugin: 最终回复 Note over Plugin: Output Guard 扫描通过</p><p>Plugin--&gt;&gt;App: 返回结果 Note over Plugin: Span: invoke_agent 结束</p><p>Plugin-&gt;&gt;OTel: 导出完整 Span 树 Note over OTel: invoke_agent ├── chat gpt-4o (step 1) │ ├── security.input_scan │ └── security.tool_scan ├── execute_tool search_weather └── chat gpt-4o (step 2) └── security.output_scan</p><div class="language-图 vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">图</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>### 5.1 新增的安全 Span在原有 Span 树基础上，每个 Guard 阶段都会创建独立的子 Span：</span></span>
<span class="line"><span>| **Span 名称** | **父 Span** | **记录属性** |</span></span>
<span class="line highlighted"><span>| security.input_scan | chat Span | security.verdict,security.risk_score,security.scan_duration_ms,security.matched_patterns |</span></span>
<span class="line"><span>| security.output_scan | chat Span | security.verdict,security.risk_score,security.leaked_data_type |</span></span>
<span class="line"><span>| security.tool_scan | execute_tool Span | security.verdict,security.risk_score,security.tool_name,security.blocked_args |</span></span>
<span class="line"><span>## 6. 双层融合：安全裁决写入 Span</span></span>
<span class="line"><span></span></span>
<span class="line"><span>这是插件最核心的创新点：将安全裁决作为 Span 属性写入 Trace，使得安全事件与调用链路形成完整的关联关系。</span></span>
<span class="line"><span>### 6.1 融合数据模型# 安全裁决写入 Span 的标准属性@dataclassclassGuardDecision:&quot;&quot;&quot;安全裁决——聚合所有 Guard 的扫描结果&quot;&quot;&quot;allowed:bool# 是否放行score:float# 最高风险分 0.0-1.0reasons:list[str]# 风险原因列表scan_results:list[ScanResult]# 各 Guard 的详细结果stage:str# &quot;input&quot; | &quot;output&quot; | &quot;tool&quot;defattach_decision_to_span(span: trace.Span, decision: GuardDecision):&quot;&quot;&quot;将 GuardDecision 写入 Span 属性&quot;&quot;&quot;span.set_attribute(&quot;security.verdict&quot;,&quot;block&quot;if notdecision.allowedelse&quot;allow&quot;)span.set_attribute(&quot;security.risk_score&quot;, decision.score)</span></span>
<span class="line"><span>span.set_attribute(&quot;security.stage&quot;, decision.stage)if notdecision.allowed:</span></span>
<span class="line"><span>span.set_attribute(&quot;security.blocked_reason&quot;,&quot;; &quot;.join(decision.reasons))</span></span>
<span class="line"><span>span.set_status(trace.StatusCode.ERROR,&quot;安全策略拦截&quot;)</span></span>
<span class="line"><span>### 6.2 融合后的 Span 属性全景| **属性类别** | **属性名** | **来源管道** | **示例值** |</span></span>
<span class="line"><span>| GenAI 标准 | gen_ai.operation.name | 观测 | &quot;chat&quot;/&quot;blocked&quot; |</span></span>
<span class="line"><span>| gen_ai.request.model | 观测 | &quot;gpt-4o&quot; |</span></span>
<span class="line"><span>| gen_ai.usage.input_tokens | 观测 | 1234 |</span></span>
<span class="line"><span>| gen_ai.usage.output_tokens | 观测 | 567 |</span></span>
<span class="line"><span>| 安全 | security.verdict | 安全 | &quot;allow&quot;/&quot;block&quot;/&quot;warn&quot; |</span></span>
<span class="line"><span>| security.risk_score | 安全 | 0.85 |</span></span>
<span class="line"><span>| security.stage | 安全 | &quot;input&quot;/&quot;output&quot;/&quot;tool&quot; |</span></span>
<span class="line"><span>| security.blocked_reason | 安全 | &quot;[注入] 指令覆盖; [PII] API Key&quot; |</span></span>
<span class="line"><span>| security.matched_patterns | 安全 | [&quot;ignore previous instructions&quot;, &quot;sk-***&quot;] |</span></span>
<span class="line"><span>关键设计决策——Block 也生成 Span：当安全策略裁决为 Block 时，请求不会到达 LLM，但 Span 仍然会被创建。gen_ai.operation.name设为&quot;blocked&quot;，gen_ai.usage.*全部为 0。这样后端可以按security.verdict = &quot;block&quot;过滤出所有被拦截的请求，生成安全审计报告和告警。</span></span>
<span class="line"><span>## 7. 插件化接入方案</span></span>
<span class="line"><span></span></span>
<span class="line"><span>### 7.1 零代码模式与前两份文档一致，插件通过运行时注入实现零代码接入。安全检测能力作为独立模块，通过配置开关控制：</span></span>
<span class="line"><span></span></span>
<span class="line"><span># 环境变量控制AI_OBS_ENABLED=true# 总开关AI_OBS_SECURITY_ENABLED=true# 安全检测开关AI_OBS_SECURITY_MODE=strict# strict | balanced | logging_onlyAI_OBS_SECURITY_BLOCK_THRESHOLD=0.75# 启动命令（零代码）pythonapp.py# sitecustomize.py 自动加载插件# 或一行代码importai_obs_plugin; ai_obs_plugin.init(security_mode=&quot;strict&quot;,</span></span>
<span class="line"><span>block_threshold=0.75,</span></span>
<span class="line"><span>allowed_tools=[&quot;search_weather&quot;,&quot;read_file&quot;,&quot;send_email&quot;],</span></span>
<span class="line"><span>)</span></span>
<span class="line"><span>### 7.2 装饰器模式：手动标注安全边界对于自定义 Agent 编排，提供装饰器来手动声明需要安全检测的节点：</span></span>
<span class="line"><span>fromai_obs_pluginimportobserve, security@observe(name=&quot;invoke_agent travel-planner&quot;)@security(input_guard=True, output_guard=True, tool_guard=True)async deftravel_planner(query:str) -&gt;str:async withobserve(name=&quot;execute_tool search_weather&quot;):@security(tool_guard=True, allowed_tools=[&quot;search_weather&quot;])async defsearch(location):return awaitweather_api.search(location)</span></span>
<span class="line"><span>response =awaitllm.generate(query, weather_data)returnresponse</span></span>
<span class="line"><span>### 7.3 中间件模式：FastAPI 集成# FastAPI 中间件 —— 一行代码接入fromfastapiimportFastAPIfromai_obs_pluginimportAIObsMiddlewareapp= FastAPI()app.add_middleware(AIObsMiddleware, security_mode=&quot;balanced&quot;)@app.post(&quot;/v1/chat/completions&quot;)async defchat(request: ChatRequest):# 业务代码完全不变pass## 8. 策略配置引擎### 8.1 策略模型# policy.yaml — 策略配置文件policies:# 默认策略default: balanced# 严格模式：生产环境strict:input_guard_enabled: trueoutput_guard_enabled: truetool_guard_enabled: trueblock_threshold:0.60# 较低的阻断阈值warn_threshold:0.30raise_on_block: true# 阻断时抛异常allowed_tools:# 工具白名单- search_weather- read_file- send_email# 均衡模式：默认balanced:input_guard_enabled: trueoutput_guard_enabled: truetool_guard_enabled: trueblock_threshold:0.75warn_threshold:0.40raise_on_block: true# 仅日志模式：开发/测试logging_only:input_guard_enabled: trueoutput_guard_enabled: truetool_guard_enabled: trueblock_threshold:1.0# 永不阻断warn_threshold:0.30raise_on_block: false# 仅记录日志# 按路由/端点覆盖策略rules:- path: /api/internal/agent/*policy: strict- path: /api/public/chatpolicy: balanced- model: gpt-4o-minipolicy: balanced- model: gpt-4opolicy: strict### 8.2 策略生效流程\`\`\`</span></span>
<span class="line"><span>flowchart TD</span></span>
<span class="line"><span> REQ[&quot;请求到达&quot;] --&gt; MATCH{&quot;路径/模型</span></span>
<span class="line"><span>匹配规则？&quot;}</span></span>
<span class="line"><span> MATCH --&gt;|&quot;是&quot;| USE_RULE[&quot;使用匹配的策略&quot;]</span></span>
<span class="line"><span> MATCH --&gt;|&quot;否&quot;| USE_DEFAULT[&quot;使用默认策略&quot;]</span></span>
<span class="line"><span></span></span>
<span class="line"><span> USE_RULE --&gt; INPUT</span></span>
<span class="line"><span> USE_DEFAULT --&gt; INPUT</span></span>
<span class="line"><span></span></span>
<span class="line"><span> INPUT[&quot;Input Guard 扫描&quot;] --&gt; CHECK{score &gt; block_threshold?}</span></span>
<span class="line"><span> CHECK --&gt;|&quot;是&quot;| BLOCK[&quot;Block: 返回 403</span></span>
<span class="line"><span>写入 security.verdict=block&quot;]</span></span>
<span class="line"><span> CHECK --&gt;|&quot;否&quot;| WARN{score &gt; warn_threshold?}</span></span>
<span class="line"><span> WARN --&gt;|&quot;是&quot;| LOG_WARN[&quot;Warn: 记录日志</span></span>
<span class="line"><span>security.verdict=warn&quot;]</span></span>
<span class="line"><span> WARN --&gt;|&quot;否&quot;| ALLOW[&quot;Allow: 放行到 LLM&quot;]</span></span>
<span class="line"><span></span></span>
<span class="line"><span> LOG_WARN --&gt; ALLOW</span></span>
<span class="line"><span> ALLOW --&gt; LLM[&quot;LLM 调用&quot;]</span></span>
<span class="line"><span> LLM --&gt; OUTPUT[&quot;Output Guard 扫描&quot;]</span></span>
<span class="line"><span> OUTPUT --&gt; TOOL[&quot;Tool Guard 扫描&quot;]</span></span>
<span class="line"><span> TOOL --&gt; RETURN[&quot;返回 GuardDecision&quot;]</span></span>
<span class="line"><span></span></span>
<span class="line"><span> style BLOCK fill:#1a1d27,stroke:#f43f5e,stroke-width:2px</span></span>
<span class="line"><span> style ALLOW fill:#1a1d27,stroke:#22c55e</span></span>
<span class="line"><span> style LOG_WARN fill:#1a1d27,stroke:#f59e0b</span></span>
<span class="line"><span>\`\`\`图 4：策略生效流程——从请求到达到最终裁决的完整决策路径</span></span>
<span class="line"><span>## 9. 实现路线图</span></span>
<span class="line"><span></span></span>
<span class="line"><span>- 阶段一：核心 Guard 引擎4 周</span></span>
<span class="line"><span>实现 Input Guard（注入检测 + 越狱检测 + PII 扫描）、Output Guard（凭证泄露 + 危险指令 + 系统提示词泄露）、Tool Guard（白名单 + 危险参数检测）。策略引擎（Policy + 三种预设模式）。GuardDecision 数据模型。- 阶段二：观测管道融合3 周</span></span>
<span class="line"><span>将 Guard 管道集成到现有拦截器引擎中。实现裁决写入 Span（security.* 属性）。安全 Span 的父子关系建模。Block 场景下的 Span 生命周期管理。- 阶段三：插件化封装3 周</span></span>
<span class="line"><span>Python 插件包封装（sitecustomize + import hook）。装饰器 API（@observe + @security）。中间件 API（FastAPI / Flask）。零代码接入验证。配置热更新支持。- 阶段四：高级检测能力4 周</span></span>
<span class="line"><span>LLM-as-Judge 安全评估（利用轻量级模型做二次判断）。Agent 行为异常检测（基于历史 pattern 的异常行为识别）。OWASP Agentic AI Top 10 全覆盖。多语言支持（Java Agent + Node.js）。## Sources- OWASP, &quot;OWASP Top 10 for LLM Applications 2025&quot; — LLM 应用十大安全风险，覆盖 Prompt Injection、Sensitive Information Disclosure、Excessive Agency 等核心风险。https://genai.owasp.org/- OWASP, &quot;OWASP Agentic Skills Top 10&quot; — Agentic AI 技能安全风险，2026 年新增，覆盖工具滥用、身份特权滥用、目标劫持、过度自主等风险。https://owasp.org/www-project-agentic-skills-top-10/- OWASP, &quot;AI Agent Security Cheat Sheet&quot; — AI Agent 安全防护清单，涵盖 Tool Abuse、Data Exfiltration、Memory Poisoning、Goal Hijacking、Excessive Autonomy 等风险。https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html- Quisium, &quot;Production-grade security middleware for LLM calls&quot; — Python 安全中间件库，六阶段 Guard 流水线（input scan → risk decision → forward → output scan → tool validation → return），支持策略配置和可插拔架构。https://github.com/siphalion/quisium- NVIDIA, &quot;NeMo Guardrails&quot; — 可扩展的 AI 护栏编排方案，支持主题控制、PII 检测、RAG 真实性、越狱防护、多语言多模态内容安全。https://developer.nvidia.com/nemo-guardrails</span></span></code></pre></div>`,24)])])}const g=n(t,[["render",l]]);export{d as __pageData,g as default};
