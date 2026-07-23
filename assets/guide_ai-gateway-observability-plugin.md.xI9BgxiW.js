import{_ as s,o as n,c as e,a2 as t}from"./chunks/framework.CHeM0PsO.js";const q=JSON.parse('{"title":"AI 网关层可观测性接入技术方案","description":"","frontmatter":{"title":"AI 网关层可观测性接入技术方案"},"headers":[],"relativePath":"guide/ai-gateway-observability-plugin.md","filePath":"guide/ai-gateway-observability-plugin.md","lastUpdated":1784762596000}'),p={name:"guide/ai-gateway-observability-plugin.md"};function o(l,a,i,r,u,c){return n(),e("div",null,[...a[0]||(a[0]=[t(`<h1 id="ai-网关层可观测性接入技术方案" tabindex="-1">AI 网关层可观测性接入技术方案 <a class="header-anchor" href="#ai-网关层可观测性接入技术方案" aria-label="Permalink to &quot;AI 网关层可观测性接入技术方案&quot;">​</a></h1><blockquote><p><strong>技术方案v1.0</strong> | 2026-07-19 | 受众：架构师 / 网关工程师 / 平台工程师</p></blockquote><h2 id="目录" tabindex="-1">目录 <a class="header-anchor" href="#目录" aria-label="Permalink to &quot;目录&quot;">​</a></h2><ul><li>为什么选择网关层接入</li><li>三种架构范式</li><li>方案一：LiteLLM Proxy 原生方案</li><li>方案二：Envoy AI Gateway + WASM 插件</li><li>方案三：APISIX / Kong + 自定义插件</li><li>方案四：自建网关中间件管道</li><li>Span 生成模型设计</li><li>方案对比与选型建议</li><li>实施路线图</li></ul><h2 id="_1-为什么选择网关层接入" tabindex="-1">1. 为什么选择网关层接入 <a class="header-anchor" href="#_1-为什么选择网关层接入" aria-label="Permalink to &quot;1. 为什么选择网关层接入&quot;">​</a></h2><p>在 SDK 层做可观测性插桩（上一份文档的方案）能覆盖所有 AI 调用，但有一个根本局限：每接入一个应用就要装一次插件，团队多、语言杂、版本乱时维护成本指数级增长。网关层接入则把所有 AI 流量收拢到同一个入口点，可观测性能力只需部署一次。</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>graph LR</span></span>
<span class="line"><span> subgraph &quot;SDK 层方案（N 个接入点）&quot;</span></span>
<span class="line"><span> A1[App1 + Plugin] --&gt; LLM1[LLM API]</span></span>
<span class="line"><span> A2[App2 + Plugin] --&gt; LLM2[LLM API]</span></span>
<span class="line"><span> A3[App3 + Plugin] --&gt; LLM3[LLM API]</span></span>
<span class="line"><span> end</span></span>
<span class="line"><span></span></span>
<span class="line"><span> subgraph &quot;网关层方案（1 个接入点）&quot;</span></span>
<span class="line"><span> B1[App1] --&gt; GW[AI Gateway</span></span>
<span class="line"><span>+ Obs Plugin]</span></span>
<span class="line"><span> B2[App2] --&gt; GW</span></span>
<span class="line"><span> B3[App3] --&gt; GW</span></span>
<span class="line"><span> GW --&gt; LLM4[LLM API]</span></span>
<span class="line"><span> end</span></span>
<span class="line"><span></span></span>
<span class="line"><span> style GW fill:#1a1d27,stroke:#a78bfa,stroke-width:3px</span></span>
<span class="line"><span> style A1 fill:#1a1d27,stroke:#ef4444</span></span>
<span class="line"><span> style A2 fill:#1a1d27,stroke:#ef4444</span></span>
<span class="line"><span> style A3 fill:#1a1d27,stroke:#ef4444</span></span>
<span class="line"><span>\`\`\`图 1：SDK 层 vs 网关层——一个接入点覆盖所有下游应用</span></span>
<span class="line"><span>#### 网关层优势统一入口，一次部署全局生效；与业务语言无关；集中的安全审计和成本追踪；对下游应用完全透明；天然适合做限流、路由、鉴权等网关职责。</span></span>
<span class="line"><span>#### 网关层局限无法感知 Agent 内部编排细节（多步推理、工具调用链）；只能看到网关↔LLM 这一段；对不走网关的直连流量无能为力；会成为单点瓶颈。</span></span>
<span class="line"><span>最佳实践是双层覆盖：网关层负责全局统一采集（覆盖所有应用、跨语言、成本追踪），SDK 层负责 Agent 内部的细粒度追踪（多步推理、工具调用、评估）。两者通过trace_id串联，形成完整的端到端视图。</span></span>
<span class="line"><span>## 2. 三种架构范式</span></span>
<span class="line"><span></span></span>
<span class="line"><span>网关层实现 AI 可观测性，根据网关本身的架构，分为三种范式：</span></span></code></pre></div><p>graph TB subgraph &quot;范式 A：AI 原生网关内置&quot; PA1[&quot;LiteLLM Proxy Proxy Server&quot;] --&gt; PA2[&quot;内置 OTel Callback&quot;] PA1 --&gt; PA3[&quot;内置 Middleware&quot;] PA1 --&gt; PA4[&quot;Custom Callback Hook&quot;] end</p><p>subgraph &quot;范式 B：通用网关 + 扩展&quot; PB1[&quot;Envoy / APISIX / Kong&quot;] --&gt; PB2[&quot;WASM / Lua 插件&quot;] PB1 --&gt; PB3[&quot;AI Proxy 插件&quot;] PB1 --&gt; PB4[&quot;External Processor&quot;] end</p><p>subgraph &quot;范式 C：自建中间件管道&quot; PC1[&quot;自建网关 (FastAPI / Go net/http)&quot;] --&gt; PC2[&quot;请求拦截器链&quot;] PC1 --&gt; PC3[&quot;响应解析器&quot;] PC1 --&gt; PC4[&quot;Span 构建器&quot;] end</p><p>style PA1 fill:#1a1d27,stroke:#a78bfa,stroke-width:2px style PB1 fill:#1a1d27,stroke:#34d399,stroke-width:2px style PC1 fill:#1a1d27,stroke:#f59e0b,stroke-width:2px</p><div class="language-图 vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">图</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>| **范式** | **代表方案** | **接入成本** | **灵活度** | **性能** | **适用团队** |</span></span>
<span class="line highlighted"><span>| A: AI 原生网关 | LiteLLM Proxy | 极低 | 中 | 中 | 快速落地、Python 技术栈 |</span></span>
<span class="line"><span>| B: 通用网关扩展 | Envoy / APISIX / Kong | 中 | 高 | 极高 | 已有网关基础设施、高流量 |</span></span>
<span class="line"><span>| C: 自建中间件 | 自定义网关 | 高 | 极高 | 取决于实现 | 特殊需求、深度定制 |</span></span>
<span class="line"><span>## 3. 方案一：LiteLLM Proxy 原生方案</span></span>
<span class="line"><span></span></span>
<span class="line"><span>### 3.1 架构原理LiteLLM Proxy 是目前最成熟的 AI 原生网关方案。它本身就是一个 LLM 流量的代理服务器，内置了完整的 OpenTelemetry v2 支持，一个请求的完整生命周期——HTTP 入口、鉴权、guardrails、LLM 调用、缓存/数据库操作——全部嵌套在一棵 Span 树中。[1]</span></span></code></pre></div><p>sequenceDiagram participant Client as 业务应用 participant GW as LiteLLM Proxy participant LLM as OpenAI / Anthropic participant OTel as OTLP Collector</p><p>Client-&gt;&gt;GW: POST /chat/completions Note over GW: Span: Received Proxy Server Request</p><p>GW-&gt;&gt;GW: Auth (API Key 验证) Note over GW: Span: auth</p><p>GW-&gt;&gt;GW: Guardrails (内容审查) Note over GW: Span: guardrails</p><p>GW-&gt;&gt;GW: Router (模型路由) Note over GW: Span: router</p><p>GW-&gt;&gt;LLM: POST /v1/chat/completions Note over GW: Span: chat gpt-4o</p><p>LLM--&gt;&gt;GW: Response (streaming) Note over GW: Span: 记录 token 用量、延迟</p><p>GW-&gt;&gt;GW: Cache Write Note over GW: Span: redis</p><p>GW--&gt;&gt;Client: Response Note over GW: Span: 结束, 导出到 OTel</p><p>GW-&gt;&gt;OTel: OTLP gRPC Export</p><div class="language-图 vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">图</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>### 3.2 接入方式：一行配置# litellm_config.yaml — 网关配置general_settings:master_key: os.environ/PROXY_MASTER_KEYmodel_list:-model_name: gpt-4olitellm_params:model: openai/gpt-4oapi_key: os.environ/OPENAI_API_KEY-model_name: claude-sonnetlitellm_params:model: anthropic/claude-sonnet-4-20250514api_key: os.environ/ANTHROPIC_API_KEYlitellm_settings:# 核心：一行配置开启 OpenTelemetry v2otel: True# 成功/失败回调success_callback: [&quot;otel&quot;]failure_callback: [&quot;otel&quot;]# 可选：同时发送到多个后端callbacks: [&quot;otel&quot;, &quot;langfuse&quot;, &quot;prometheus&quot;]router_settings:routing_strategy: &quot;usage-based&quot;allowed_fails: 3num_retries: 2</span></span>
<span class="line"><span># 启动命令litellm--config litellm_config.yaml --port4000# 或通过 Dockerdockerrun -p4000:4000\\-e OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4317</span></span>
<span class="line highlighted"><span>-v ./litellm_config.yaml:/app/config.yaml </span></span>
<span class="line"><span>ghcr.io/berriai/litellm:main-latest</span></span>
<span class="line"><span>### 3.3 自定义回调扩展LiteLLM 的 callback 机制允许注入自定义逻辑，是实现可观测性插件化的关键入口：</span></span>
<span class="line"><span># custom_obs_callback.pyimportlitellmfromlitellm.integrations.custom_loggerimportCustomLoggerfromopentelemetryimporttraceclassAIObservabilityCallback(CustomLogger):&quot;&quot;&quot;自定义可观测性回调——继承 LiteLLM 的 CustomLogger&quot;&quot;&quot;async defasync_log_success_event(self, kwargs, response_obj, start_time, end_time):&quot;&quot;&quot;LLM 调用成功时触发&quot;&quot;&quot;tracer = trace.get_tracer(&quot;ai-gateway-obs&quot;)withtracer.start_as_current_span(name=&quot;chat {model}&quot;.format(model=kwargs.get(&quot;model&quot;)),</span></span>
<span class="line"><span>kind=trace.SpanKind.CLIENT</span></span>
<span class="line"><span>)asspan:# 标准 GenAI 属性span.set_attribute(&quot;gen_ai.operation.name&quot;,&quot;chat&quot;)</span></span>
<span class="line"><span>span.set_attribute(&quot;gen_ai.request.model&quot;, kwargs.get(&quot;model&quot;))</span></span>
<span class="line"><span>span.set_attribute(&quot;gen_ai.usage.input_tokens&quot;, response_obj.usage.prompt_tokens)</span></span>
<span class="line"><span>span.set_attribute(&quot;gen_ai.usage.output_tokens&quot;, response_obj.usage.completion_tokens)# 业务自定义属性span.set_attribute(&quot;tenant.id&quot;, kwargs.get(&quot;user&quot;))</span></span>
<span class="line"><span>span.set_attribute(&quot;cost.total&quot;, response_obj._hidden_params.get(&quot;response_cost&quot;))async defasync_log_failure_event(self, kwargs, response_obj, start_time, end_time):&quot;&quot;&quot;LLM 调用失败时触发&quot;&quot;&quot;# 记录异常 Span，携带错误类型和消息pass# 注册回调litellm.callbacks= [AIObservabilityCallback()]</span></span>
<span class="line"><span>插件化要点：将AIObservabilityCallback打包为独立的 Python 包，通过litellm_settings.callbacks配置引用。这样可观测性能力就是一个可拔插的模块，不修改 LiteLLM 源码，不绑定特定版本。</span></span>
<span class="line"><span>### 3.4 网关层独有：请求级全链路 SpanLiteLLM OTel v2 的核心价值在于它为每个请求生成一棵完整的 Span 树，涵盖了网关层能看到的所有环节：</span></span>
<span class="line"><span>| **Span 名称** | **层级** | **记录内容** |</span></span>
<span class="line"><span>| Received Proxy Server Request | Root | HTTP 方法、路径、请求体大小、客户端 IP、user agent |</span></span>
<span class="line"><span>| auth | Child | API Key hash、认证耗时、认证结果 |</span></span>
<span class="line"><span>| guardrails | Child | 内容审查结果、是否拦截、审查耗时 |</span></span>
<span class="line"><span>| router | Child | 路由决策、选中的 deployment、fallback 次数 |</span></span>
<span class="line"><span>| chat {model} | Child | 模型名、provider、token 用量、延迟、finish_reason |</span></span>
<span class="line"><span>| redis | Child | 缓存命中/未命中、key、操作耗时 |</span></span>
<span class="line"><span>| self | Child | LiteLLM 内部处理耗时 |</span></span>
<span class="line"><span>## 4. 方案二：Envoy AI Gateway + WASM 插件</span></span>
<span class="line"><span></span></span>
<span class="line"><span>### 4.1 架构原理Envoy AI Gateway 是 CNCF 旗下的 AI 网关项目，v0.3 版本已内置 OpenTelemetry tracing 支持（基于 OpenInference 语义约定）</span></span>
<span class="line"><span></span></span>
<span class="line"><span>。它的核心优势是 C++ 级别的性能（微秒级延迟）和 WASM 插件机制带来的极致扩展性。[2]</span></span></code></pre></div><p>graph TB subgraph &quot;Envoy AI Gateway&quot; subgraph &quot;Listener Filter Chain&quot; LF[&quot;HTTP Connection Manager&quot;] end</p><p>subgraph &quot;HTTP Filter Chain&quot; F1[&quot;WASM Filter: AI Obs Plugin&quot;] F2[&quot;External Processor: PII Filter&quot;] F3[&quot;Router: AI Backend&quot;] end</p><p>subgraph &quot;WASM Plugin (Rust/Go/C++)&quot; W1[&quot;请求拦截器&quot;] W2[&quot;Span 构建器&quot;] W3[&quot;OTLP 导出器&quot;] end</p><p>subgraph &quot;Upstream&quot; U1[&quot;OpenAI&quot;] U2[&quot;Anthropic&quot;] U3[&quot;Ollama&quot;] end end</p><p>LF --&gt; F1 --&gt; F2 --&gt; F3 F1 -.-&gt; W1 W1 --&gt; W2 --&gt; W3 F3 --&gt; U1 F3 --&gt; U2 F3 --&gt; U3 W3 --&gt; OTLP[&quot;OTLP Collector&quot;]</p><p>style F1 fill:#1a1d27,stroke:#a78bfa,stroke-width:2px style W1 fill:#1a1d27,stroke:#34d399 style W2 fill:#1a1d27,stroke:#34d399 style W3 fill:#1a1d27,stroke:#34d399</p><div class="language-图 vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">图</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>### 4.2 WASM 插件实现WASM 插件运行在 Envoy 的沙箱中，可以访问请求/响应的完整内容，且性能接近原生 C++。关键实现步骤：</span></span>
<span class="line"><span>// Rust WASM 插件核心逻辑（使用 proxy-wasm SDK）useproxy_wasm::traits::;useproxy_wasm::types::;structAIObservabilityFilter{// 插件上下文context_id:u32,// Span 状态span_start_time:Option&lt;SystemTime&gt;,// 请求体缓冲区request_body:Vec&lt;u8&gt;,</span></span>
<span class="line"><span>response_body:Vec&lt;u8&gt;,</span></span>
<span class="line highlighted"><span>}implHttpContextforAIObservabilityFilter{fnon_http_request_headers(&amp;mutself, _num_headers:usize, _end_of_stream:bool) -&gt;Action{// 1. 记录请求开始时间self.span_start_time =Some(SystemTime::now());// 2. 提取或生成 trace_id（从 W3C traceparent header）if letSome(traceparent) =self.get_http_request_header(&quot;traceparent&quot;) {// 使用上游传入的 trace_id，串联分布式链路self.set_property(&quot;traceparent&quot;, traceparent);</span></span>
<span class="line"><span>}Action::Continue}fnon_http_request_body(&amp;mutself, body_size:usize, end_of_stream:bool) -&gt;Action{// 3. 缓冲请求体（用于后续提取 model / prompt 信息）if letSome(body) =self.get_http_request_body(0, body_size) {self.request_body.extend_from_slice(&amp;body);</span></span>
<span class="line"><span>}Action::Continue}fnon_http_response_headers(&amp;mutself, _num_headers:usize, _end_of_stream:bool) -&gt;Action{// 4. 检查响应状态if letSome(status) =self.get_http_response_header(&quot;:status&quot;) {self.set_property(&quot;response_status&quot;, status);</span></span>
<span class="line"><span>}Action::Continue}fnon_http_response_body(&amp;mutself, body_size:usize, end_of_stream:bool) -&gt;Action{// 5. 缓冲响应体（提取 token 用量信息）if letSome(body) =self.get_http_response_body(0, body_size) {self.response_body.extend_from_slice(&amp;body);</span></span>
<span class="line"><span>}ifend_of_stream {// 6. 流结束：构建 Span 并通过 HTTP 发送到 Collectorself.build_and_export_span();</span></span>
<span class="line"><span>}Action::Continue}</span></span>
<span class="line"><span>}implAIObservabilityFilter{fnbuild_and_export_span(&amp;self) {// 解析请求体中的 model 参数letrequest:Value=serde_json::from_slice(&amp;self.request_body).unwrap();letmodel = request[&quot;model&quot;].as_str().unwrap_or(&quot;unknown&quot;);// 解析响应体中的 usageletresponse:Value=serde_json::from_slice(&amp;self.response_body).unwrap();letusage = &amp;response[&quot;usage&quot;];// 构建 OTLP Span JSON，通过 HTTP dispatch 到 sidecar collectorletspan =json!({&quot;name&quot;:format!(&quot;chat {}&quot;, model),&quot;kind&quot;:3,// CLIENT&quot;attributes&quot;: {&quot;gen_ai.operation.name&quot;:&quot;chat&quot;,&quot;gen_ai.request.model&quot;: model,&quot;gen_ai.usage.input_tokens&quot;: usage[&quot;prompt_tokens&quot;],&quot;gen_ai.usage.output_tokens&quot;: usage[&quot;completion_tokens&quot;],</span></span>
<span class="line"><span>}</span></span>
<span class="line"><span>});self.dispatch_http_call(&quot;otel-collector&quot;, span);</span></span>
<span class="line"><span>}</span></span>
<span class="line"><span>}</span></span>
<span class="line"><span>### 4.3 部署架构# envoy-gateway-config.yamlapiVersion: gateway.networking.k8s.io/v1kind: Gatewaymetadata:name: ai-gatewayspec:gatewayClassName: envoy-ai-gatewaylisteners:-name: httpport:80protocol: HTTP</span></span>
<span class="line"><span>---apiVersion: gateway.envoyproxy.io/v1alpha1kind: AIGatewayRoutemetadata:name: llm-routespec:llmRequestCosts:# 成本追踪（内置）-metadataKey: llm_input_tokentype: InputToken</span></span>
<span class="line"><span>-metadataKey: llm_output_tokentype: OutputTokenbackendRefs:</span></span>
<span class="line"><span>-name: openai-backendweight:60-name: anthropic-backendweight:40---# WASM 插件挂载apiVersion: gateway.envoyproxy.io/v1alpha1kind: EnvoyExtensionPolicymetadata:name: ai-obs-pluginspec:wasm:</span></span>
<span class="line"><span>-name: ai-observability-pluginrootID: ai_obs_filterurl: oci://registry.example.com/ai-obs-plugin:1.0.0</span></span>
<span class="line"><span>WASM 方案的独特优势：插件编译为 WASM 字节码后通过 OCI 镜像分发，支持热加载（不中断流量）。一个 WASM 插件可以同时处理 OpenAI、Anthropic、Ollama 等多种 LLM 协议，因为网关层看到的是统一的 HTTP 请求/响应，与具体协议无关。</span></span>
<span class="line"><span>## 5. 方案三：APISIX / Kong + 自定义插件</span></span>
<span class="line"><span></span></span>
<span class="line"><span>### 5.1 APISIX 方案APISIX 通过内置的ai-proxy插件将 LLM 流量统一代理，v3.14 新增了$llm_*NGINX 变量，自动填充 LLM 请求/响应元数据，可直接在日志插件中引用而无需自定义解析。[3]再配合opentelemetry插件，即可将 LLM 调用信息写入 Span 属性。</span></span>
<span class="line"><span></span></span>
<span class="line"><span># APISIX 路由配置 — 三步实现网关层 AI 可观测性routes:-uri: /v1/chat/completionsplugins:# 第一步：代理 LLM 请求ai-proxy:provider: openaiauth:header:Authorization: &quot;Bearer ENV_OPENAI_API_KEY&quot;model:name: gpt-4ooptions:max_tokens:4096# 第二步：注入 OpenTelemetry tracingopentelemetry:sampler:name: always_onadditional_attributes:# 自定义 Span 属性-&quot;gen_ai.request.model&quot;-&quot;llm_model&quot;# 内置 LLM 变量-&quot;gen_ai.usage.input_tokens&quot;-&quot;llm_prompt_tokens&quot;# 内置 LLM 变量-&quot;gen_ai.usage.output_tokens&quot;-&quot;llm_completion_tokens&quot;# 第三步：写入结构化日志（含 LLM 字段）file-logger:path: /var/log/ai-observability.loglog_format:trace_id: &quot;opentelemetry_trace_id&quot;model: &quot;llm_model&quot;prompt_tokens: &quot;llm_prompt_tokens&quot;completion_tokens: &quot;llm_completion_tokens&quot;latency: &quot;request_time&quot;status: &quot;status&quot;| **APISIX 内置 LLM 变量** | **含义** | **对应 OTel 属性** |</span></span>
<span class="line"><span>| $llm_model | 请求的模型名 | gen_ai.request.model |</span></span>
<span class="line"><span>| $llm_prompt_tokens | prompt token 数 | gen_ai.usage.input_tokens |</span></span>
<span class="line"><span>| $llm_completion_tokens | completion token 数 | gen_ai.usage.output_tokens |</span></span>
<span class="line"><span>| $llm_total_tokens | 总 token 数 | — |</span></span>
<span class="line"><span>| $llm_provider | LLM 提供商 | gen_ai.provider.name |</span></span>
<span class="line"><span>| $llm_endpoint | 上游端点 | server.address |</span></span>
<span class="line"><span>| $llm_status | LLM 调用状态 | error.type（当失败时） |</span></span>
<span class="line"><span>### 5.2 Kong 方案Kong 的 AI Gateway 能力通过ai-proxy-advanced插件实现，支持 LLM 路由、模型别名、请求/响应转换。搭配opentelemetry插件可实现基础的可观测性，但高级 LLM 属性（token 用量、模型名）</span></span>
<span class="line"><span></span></span>
<span class="line"><span>需要自定义 Lua 插件解析响应体。</span></span>
<span class="line"><span>-- Kong 自定义 Lua 插件：AI ObservabilitylocalBasePlugin =require&quot;kong.plugins.base_plugin&quot;localcjson =require&quot;cjson&quot;localAIObsHandler= BasePlugin:extend()functionAIObsHandler:new()AIObsHandler.super.new(self,&quot;ai-observability&quot;)endfunctionAIObsHandler:access(conf)AIObsHandler.super.access(self)-- 解析请求体中的 model 参数localbody = kong.request.get_body()ifbodyandbody.modelthenkong.ctx.shared.llm_model= body.modelend-- 记录请求开始时间kong.ctx.shared.llm_start_time=ngx.now()endfunctionAIObsHandler:body_filter(conf)AIObsHandler.super.body_filter(self)-- 解析响应体中的 usage 信息ifnotkong.ctx.shared.llm_usage_parsedthenlocalresp_body = kong.response.get_raw_body()ifresp_bodythenlocalok, decoded =pcall(cjson.decode, resp_body)ifokanddecoded.usagethenkong.ctx.shared.llm_usage= decoded.usage</span></span>
<span class="line"><span>kong.ctx.shared.llm_usage_parsed=trueendendendendfunctionAIObsHandler:log(conf)AIObsHandler.super.log(self)-- 在日志阶段写入结构化日志和 Span 属性localusage = kong.ctx.shared.llm_usageor{}locallatency = (ngx.now() - kong.ctx.shared.llm_start_time) *1000kong.log.info(cjson.encode({trace_id= kong.ctx.shared.trace_id,model= kong.ctx.shared.llm_model,input_tokens= usage.prompt_tokens,output_tokens= usage.completion_tokens,latency_ms= latency,</span></span>
<span class="line"><span>}))endreturnAIObsHandler</span></span>
<span class="line"><span>## 6. 方案四：自建网关中间件管道</span></span>
<span class="line"><span></span></span>
<span class="line"><span>### 6.1 架构设计当现有网关方案无法满足需求时，可以在自建网关中实现中间件管道（Middleware Pipeline）</span></span>
<span class="line"><span></span></span>
<span class="line"><span>。核心思想是把可观测性拆成独立的中间件，与鉴权、限流、路由等其他中间件并列，通过管道编排组合。</span></span></code></pre></div><p>graph LR REQ[&quot;HTTP Request&quot;] --&gt; M1[&quot;AuthMiddleware&quot;] M1 --&gt; M2[&quot;RateLimitMiddleware&quot;] M2 --&gt; M3[&quot;ObsPreMiddleware 记录开始时间 创建 Span&quot;] M3 --&gt; M4[&quot;RouterMiddleware&quot;] M4 --&gt; M5[&quot;LLM Proxy&quot;] M5 --&gt; M6[&quot;ObsPostMiddleware 提取 token 用量 设置 Span 属性&quot;] M6 --&gt; M7[&quot;ResponseMiddleware&quot;] M7 --&gt; RES[&quot;HTTP Response&quot;]</p><p>M3 -.-&gt; OTEL[&quot;OTLP Exporter (异步导出)&quot;] M6 -.-&gt; OTEL</p><p>style M3 fill:#1a1d27,stroke:#a78bfa,stroke-width:2px style M6 fill:#1a1d27,stroke:#a78bfa,stroke-width:2px style OTEL fill:#1a1d27,stroke:#34d399,stroke-dasharray:5</p><div class="language-图 vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">图</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>### 6.2 Python 实现（FastAPI）</span></span>
<span class="line"><span></span></span>
<span class="line"><span># middleware.py — 可观测性中间件，单文件即可拔插importtime, jsonfromfastapiimportRequest, Responsefromstarlette.middleware.baseimportBaseHTTPMiddlewarefromopentelemetryimporttracefromopentelemetry.sdk.traceimportTracerProviderfromopentelemetry.exporter.otlp.proto.grpc.trace_exporterimportOTLPSpanExporterfromopentelemetry.sdk.trace.exportimportBatchSpanProcessor# 全局初始化——仅一次provider= TracerProvider()provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter())</span></span>
<span class="line"><span>)trace.set_tracer_provider(provider)tracer= trace.get_tracer(&quot;ai-gateway&quot;)classAIObservabilityMiddleware(BaseHTTPMiddleware):&quot;&quot;&quot;单文件可拔插 AI 可观测性中间件&quot;&quot;&quot;async defdispatch(self, request: Request, call_next):# 仅在 LLM 路径上启用if notrequest.url.path.startswith(&quot;/v1/chat&quot;):return awaitcall_next(request)# 读取请求体（提取 model 信息）body =awaitrequest.body()</span></span>
<span class="line highlighted"><span>request_body = json.loads(body)</span></span>
<span class="line"><span>model = request_body.get(&quot;model&quot;,&quot;unknown&quot;)# 创建 Spanwithtracer.start_as_current_span(&quot;chat {model}&quot;.format(model=model),</span></span>
<span class="line"><span>kind=trace.SpanKind.CLIENT,</span></span>
<span class="line"><span>attributes={&quot;gen_ai.operation.name&quot;:&quot;chat&quot;,&quot;gen_ai.request.model&quot;: model,&quot;gen_ai.provider.name&quot;:&quot;openai&quot;,&quot;gen_ai.request.temperature&quot;: request_body.get(&quot;temperature&quot;),</span></span>
<span class="line"><span>}</span></span>
<span class="line"><span>)asspan:</span></span>
<span class="line"><span>start = time.time()# 构造新的请求体传递到下游async defreceive():return{&quot;type&quot;:&quot;http.request&quot;,&quot;body&quot;: body}</span></span>
<span class="line"><span>request._receive = receive</span></span>
<span class="line"><span>response: Response =awaitcall_next(request)</span></span>
<span class="line"><span>latency_ms = (time.time() - start) *1000# 解析响应体中的 usage 信息ifresponse.status_code ==200:</span></span>
<span class="line"><span>resp_body = response.body.decode()try:</span></span>
<span class="line"><span>resp_data = json.loads(resp_body)</span></span>
<span class="line"><span>usage = resp_data.get(&quot;usage&quot;, {})</span></span>
<span class="line"><span>span.set_attribute(&quot;gen_ai.usage.input_tokens&quot;, usage.get(&quot;prompt_tokens&quot;,0))</span></span>
<span class="line"><span>span.set_attribute(&quot;gen_ai.usage.output_tokens&quot;, usage.get(&quot;completion_tokens&quot;,0))</span></span>
<span class="line"><span>span.set_attribute(&quot;gen_ai.response.model&quot;, resp_data.get(&quot;model&quot;))exceptjson.JSONDecodeError:passelse:</span></span>
<span class="line"><span>span.set_attribute(&quot;error.type&quot;,&quot;http_{status}&quot;.format(status=response.status_code))</span></span>
<span class="line"><span>span.set_attribute(&quot;gen_ai.client.operation.duration&quot;, latency_ms)returnresponse</span></span>
<span class="line"><span># main.py — 应用入口，一行代码拔插中间件fromfastapiimportFastAPIfrommiddlewareimportAIObservabilityMiddlewareapp= FastAPI()# 可观测性中间件：注释掉即移除，取消注释即启用app.add_middleware(AIObservabilityMiddleware)# 业务路由——完全不变@app.post(&quot;/v1/chat/completions&quot;)async defchat_completions(request: dict):# ... 业务逻辑pass</span></span>
<span class="line"><span></span></span>
<span class="line"><span>### 6.3 Go 实现（net/http）</span></span>
<span class="line"><span></span></span>
<span class="line"><span>// middleware.go — Go 标准库实现packagegatewayimport(&quot;bytes&quot;&quot;encoding/json&quot;&quot;io&quot;&quot;net/http&quot;&quot;time&quot;&quot;go.opentelemetry.io/otel&quot;&quot;go.opentelemetry.io/otel/attribute&quot;&quot;go.opentelemetry.io/otel/trace&quot;)funcAIObservabilityMiddleware(next http.Handler) http.Handler {returnhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {if!isLLMPath(r.URL.Path) {</span></span>
<span class="line"><span>next.ServeHTTP(w, r)return}// 读取请求体bodyBytes, _ := io.ReadAll(r.Body)</span></span>
<span class="line"><span>r.Body.Close()</span></span>
<span class="line"><span>r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))varreqBodymap[string]interface{}</span></span>
<span class="line"><span>json.Unmarshal(bodyBytes, &amp;reqBody)</span></span>
<span class="line"><span>model, _ := reqBody[&quot;model&quot;].(string)// 创建 Spantracer := otel.Tracer(&quot;ai-gateway&quot;)</span></span>
<span class="line"><span>ctx, span := tracer.Start(</span></span>
<span class="line"><span>r.Context(),&quot;chat &quot;+model,</span></span>
<span class="line"><span>trace.WithSpanKind(trace.SpanKindClient),</span></span>
<span class="line"><span>trace.WithAttributes(</span></span>
<span class="line"><span>attribute.String(&quot;gen_ai.operation.name&quot;,&quot;chat&quot;),</span></span>
<span class="line"><span>attribute.String(&quot;gen_ai.request.model&quot;, model),</span></span>
<span class="line"><span>),</span></span>
<span class="line"><span>)deferspan.End()</span></span>
<span class="line"><span>start := time.Now()// 包装 ResponseWriter 以捕获响应体rw := &amp;responseRecorder{ResponseWriter: w}</span></span>
<span class="line"><span>r = r.WithContext(ctx)</span></span>
<span class="line"><span>next.ServeHTTP(rw, r)// 解析响应体中的 usagevarrespBodymap[string]interface{}</span></span>
<span class="line"><span>json.Unmarshal(rw.body.Bytes(), &amp;respBody)ifusage, ok := respBody[&quot;usage&quot;].(map[string]interface{}); ok {</span></span>
<span class="line"><span>span.SetAttributes(</span></span>
<span class="line"><span>attribute.Int(&quot;gen_ai.usage.input_tokens&quot;,toInt(usage[&quot;prompt_tokens&quot;])),</span></span>
<span class="line"><span>attribute.Int(&quot;gen_ai.usage.output_tokens&quot;,toInt(usage[&quot;completion_tokens&quot;])),</span></span>
<span class="line"><span>)</span></span>
<span class="line"><span>}</span></span>
<span class="line"><span>span.SetAttributes(</span></span>
<span class="line"><span>attribute.Float64(&quot;gen_ai.client.operation.duration&quot;,float64(time.Since(start).Milliseconds())),</span></span>
<span class="line"><span>)</span></span>
<span class="line"><span>})</span></span>
<span class="line"><span>}</span></span>
<span class="line"><span>## 7. Span 生成模型设计</span></span>
<span class="line"><span></span></span>
<span class="line"><span>### 7.1 网关层 Span 树无论采用哪种方案，网关层生成的 Span 树结构是统一的。关键在于：网关层不感知 Agent 内部的 multi-step 推理，它看到的是&quot;一次 HTTP 请求 → 一次 LLM 调用&quot;的一对一映射。</span></span></code></pre></div><p>graph TD ROOT[&quot;Span: gateway.request HTTP POST /v1/chat/completions&quot;] AUTH[&quot;Span: gateway.auth API Key 验证&quot;] ROUTE[&quot;Span: gateway.route 模型路由决策&quot;] LLM[&quot;Span: chat gpt-4o CLIENT → LLM API&quot;] CACHE[&quot;Span: gateway.cache 缓存读写&quot;]</p><p>ROOT --&gt; AUTH ROOT --&gt; ROUTE ROOT --&gt; LLM ROOT --&gt; CACHE</p><p>style ROOT fill:#1a1d27,stroke:#a78bfa,stroke-width:2px style LLM fill:#1a1d27,stroke:#34d399,stroke-width:2px</p><div class="language-图 vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">图</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>### 7.2 与 SDK 层 Span 的串联当同时部署网关层和 SDK 层可观测性时，通过 W3C Trace Context 将两个维度的 Span 串联：</span></span></code></pre></div><p>sequenceDiagram participant App as 业务应用 participant SDK as SDK 层插件 participant GW as 网关层插件 participant LLM as LLM API</p><p>Note over App,LLM: trace_id = &quot;abc123&quot;（全局唯一）</p><p>App-&gt;&gt;SDK: invoke_agent (span_id=001) SDK-&gt;&gt;SDK: execute_tool (span_id=002, parent=001) SDK-&gt;&gt;GW: POST /v1/chat/completions Note over SDK,GW: Header: traceparent: 00-abc123-001-01</p><p>GW-&gt;&gt;GW: gateway.request (span_id=003, parent=001) GW-&gt;&gt;GW: gateway.auth (span_id=004, parent=003) GW-&gt;&gt;LLM: chat gpt-4o (span_id=005, parent=003)</p><p>Note over App,LLM: 最终 Span 树: invoke_agent ├── execute_tool └── gateway.request ├── gateway.auth └── chat gpt-4o</p><div class="language-图 vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">图</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>实现要点：</span></span>
<span class="line"><span>- SDK 层插件在发起 HTTP 请求时，自动将当前 Span 的traceparent注入到 HTTP Header 中- 网关层插件在收到请求时，从traceparentHeader 中提取trace_id和parent_span_id- 网关层创建的 Root Span 的 parent 指向 SDK 层传入的 Span，形成完整的父子关系- 如果请求没有携带traceparent（直连场景），网关层自行创建新的trace_id</span></span>
<span class="line"><span></span></span>
<span class="line"><span>### 7.3 流式响应的 Span 处理LLM 的流式响应（SSE / streaming）</span></span>
<span class="line"><span></span></span>
<span class="line"><span>对 Span 的结束时间提出了特殊要求：不能等到流完全结束才关闭 Span，否则 Span 时长会包含用户的阅读时间。正确做法是：</span></span>
<span class="line highlighted"><span>| **流式阶段** | **Span 操作** | **说明** |</span></span>
<span class="line"><span>| 收到第一个 chunk | 记录gen_ai.response.time_to_first_token | TTFT 是衡量用户体验的关键指标 |</span></span>
<span class="line"><span>| 收到最后一个 chunk（data: [DONE]） | 关闭 Span，记录gen_ai.usage.* | usage 信息通常在最后一个 chunk 中 |</span></span>
<span class="line"><span>| 流中断 / 客户端断开 | 关闭 Span，设置error.type=&quot;cancelled&quot; | 记录中断原因 |</span></span>
<span class="line"><span>## 8. 方案对比与选型建议</span></span>
<span class="line"><span></span></span>
<span class="line"><span>| **维度** | **LiteLLM Proxy** | **Envoy AI Gateway** | **APISIX** | **自建中间件** |</span></span>
<span class="line"><span>| 接入成本 | 极低</span></span>
<span class="line"><span>一行配置 | 中</span></span>
<span class="line"><span>WASM 开发 | 中</span></span>
<span class="line"><span>插件配置 | 高</span></span>
<span class="line"><span>从零实现 |</span></span>
<span class="line"><span>| 性能基准 | ~5ms 额外延迟 | &lt; 1ms | ~2ms 额外延迟 | 取决于实现 |</span></span>
<span class="line"><span>| LLM 协议覆盖 | 100+ 模型 | OpenAI 兼容 | OpenAI 兼容 | 按需实现 |</span></span>
<span class="line"><span>| Span 丰富度 | 完整</span></span>
<span class="line"><span>auth/router/guardrails/cache | 基础 | 基础 | 按需实现 |</span></span>
<span class="line"><span>| Token 用量获取 | 自动 | 需解析响应 | 内置变量 | 需解析响应 |</span></span>
<span class="line"><span>| 成本追踪 | 内置 | 需自行计算 | 需自行计算 | 需自行计算 |</span></span>
<span class="line"><span>| 流式支持 | 原生 | 需处理 SSE | 需处理 SSE | 需处理 SSE |</span></span>
<span class="line"><span>| WASM 扩展 | 不支持 | 支持 | 支持 | 不支持 |</span></span>
<span class="line"><span>| 运维复杂度 | 低 | 中高 | 中 | 高 |</span></span>
<span class="line"><span>### 选型决策树\`\`\`</span></span>
<span class="line"><span>flowchart TD</span></span>
<span class="line"><span> Q1{&quot;是否已有</span></span>
<span class="line"><span>API 网关？&quot;}</span></span>
<span class="line"><span> Q1 --&gt;|&quot;否，需要快速落地&quot;| R1[&quot;LiteLLM Proxy&quot;]</span></span>
<span class="line"><span> Q1 --&gt;|&quot;是，已有 Envoy&quot;| Q2{&quot;团队是否有</span></span>
<span class="line"><span>Rust/C++ 能力？&quot;}</span></span>
<span class="line"><span> Q1 --&gt;|&quot;是，已有 APISIX&quot;| R3[&quot;APISIX + ai-proxy</span></span>
<span class="line"><span>+ opentelemetry 插件&quot;]</span></span>
<span class="line"><span> Q1 --&gt;|&quot;是，已有 Kong&quot;| R4[&quot;Kong + ai-proxy-advanced</span></span>
<span class="line"><span>+ 自定义 Lua 插件&quot;]</span></span>
<span class="line"><span></span></span>
<span class="line"><span> Q2 --&gt;|&quot;是&quot;| Q3{&quot;流量规模？&quot;}</span></span>
<span class="line"><span> Q2 --&gt;|&quot;否&quot;| R1</span></span>
<span class="line"><span></span></span>
<span class="line"><span> Q3 --&gt;|&quot;&gt; 10K QPS&quot;| R2[&quot;Envoy AI Gateway</span></span>
<span class="line"><span>+ WASM 插件&quot;]</span></span>
<span class="line"><span> Q3 --&gt;|&quot;&lt; 10K QPS&quot;| R1</span></span>
<span class="line"><span></span></span>
<span class="line"><span> style R1 fill:#1a1d27,stroke:#a78bfa,stroke-width:2px</span></span>
<span class="line"><span> style R2 fill:#1a1d27,stroke:#34d399,stroke-width:2px</span></span>
<span class="line"><span> style R3 fill:#1a1d27,stroke:#a78bfa,stroke-width:2px</span></span>
<span class="line"><span> style R4 fill:#1a1d27,stroke:#f59e0b,stroke-width:2px</span></span>
<span class="line"><span>\`\`\`图 8：网关层方案选型决策树</span></span>
<span class="line"><span>推荐路径：80% 的团队应该从 LiteLLM Proxy 开始 — 接入成本最低、LLM 生态最完整、OTel v2 的 Span 覆盖度最高。当流量规模超过 10K QPS 或已有 Envoy 基础设施时，再考虑迁移到 Envoy AI Gateway + WASM 方案。</span></span>
<span class="line"><span>## 9. 实施路线图</span></span>
<span class="line"><span></span></span>
<span class="line"><span>- 第一阶段：LiteLLM Proxy 快速接入2 周</span></span>
<span class="line"><span>部署 LiteLLM Proxy 作为 AI 流量的统一入口。配置 OTel v2 callback，验证 Span 生成和 OTLP 导出。业务应用只需将 LLM API 端点指向网关地址。- 第二阶段：自定义回调与指标2 周</span></span>
<span class="line"><span>开发自定义 CustomLogger 回调，注入租户 ID、业务标签等自定义属性。配置 Prometheus metrics 采集，建立 Grafana 仪表盘（延迟、token 用量、成本、错误率）。- 第三阶段：网关层 + SDK 层双层串联3 周</span></span>
<span class="line"><span>在关键 Agent 应用中部署 SDK 层插件，通过 W3C Trace Context 与网关层 Span 串联。验证端到端 Trace 完整性：invoke_agent → execute_tool → gateway.request → chat。- 第四阶段：Envoy 高性能方案4 周</span></span>
<span class="line"><span>当流量超过 10K QPS 时，将可观测性逻辑迁移到 Envoy AI Gateway WASM 插件。LiteLLM Proxy 降级为开发/测试环境方案。## Sources- LiteLLM, &quot;OpenTelemetry v2 — Full-request tracing&quot; — LiteLLM Proxy 内置的 OTel v2 支持，一个请求的完整生命周期 Span 树，涵盖 auth、router、guardrails、LLM 调用、cache 等环节。https://docs.litellm.ai/docs/observability/opentelemetry_v2- Envoy AI Gateway, &quot;Enhancing AI Gateway Observability — OpenTelemetry Tracing Arrives in Envoy AI Gateway&quot; — v0.3 版本引入基于 OpenInference 语义约定的 OpenTelemetry tracing，支持 WASM 插件扩展。https://aigateway.envoyproxy.io/blog/openinference-for-ai-observability/- Apache APISIX, &quot;ai-proxy Plugin&quot; — 内置 LLM 代理插件，v3.14 新增 $llm_* NGINX 变量，自动填充 LLM 请求/响应元数据。https://apisix.apache.org/docs/apisix/plugins/ai-proxy/- TrueFoundry, &quot;Observability in the Dark: Logs, Tracing &amp; OpenTelemetry Across Four AI Gateways&quot; — 对比 LiteLLM、Kong、Envoy、APISIX 四种 AI 网关的可观测性能力。https://www.truefoundry.com/observability-dark</span></span></code></pre></div>`,44)])])}const g=s(p,[["render",o]]);export{q as __pageData,g as default};
