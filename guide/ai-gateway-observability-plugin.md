---
title: AI 网关层可观测性接入技术方案
---

# AI 网关层可观测性接入技术方案

# 技术方案v1.0
# AI 调用链路可观测性网关层接入技术方案
2026-07-19技术方案受众：架构师 / 网关工程师 / 平台工程师
## 目录- 为什么选择网关层接入- 三种架构范式- 方案一：LiteLLM Proxy 原生方案- 方案二：Envoy AI Gateway + WASM 插件- 方案三：APISIX / Kong + 自定义插件- 方案四：自建网关中间件管道- Span 生成模型设计- 方案对比与选型建议- 实施路线图## 1. 为什么选择网关层接入在 SDK 层做可观测性插桩（上一份文档的方案）能覆盖所有 AI 调用，但有一个根本局限：每接入一个应用就要装一次插件，团队多、语言杂、版本乱时维护成本指数级增长。网关层接入则把所有 AI 流量收拢到同一个入口点，可观测性能力只需部署一次。
```
graph LR
 subgraph "SDK 层方案（N 个接入点）"
 A1[App1 + Plugin] --> LLM1[LLM API]
 A2[App2 + Plugin] --> LLM2[LLM API]
 A3[App3 + Plugin] --> LLM3[LLM API]
 end

 subgraph "网关层方案（1 个接入点）"
 B1[App1] --> GW[AI Gateway
+ Obs Plugin]
 B2[App2] --> GW
 B3[App3] --> GW
 GW --> LLM4[LLM API]
 end

 style GW fill:#1a1d27,stroke:#a78bfa,stroke-width:3px
 style A1 fill:#1a1d27,stroke:#ef4444
 style A2 fill:#1a1d27,stroke:#ef4444
 style A3 fill:#1a1d27,stroke:#ef4444
```图 1：SDK 层 vs 网关层——一个接入点覆盖所有下游应用
#### 网关层优势统一入口，一次部署全局生效；与业务语言无关；集中的安全审计和成本追踪；对下游应用完全透明；天然适合做限流、路由、鉴权等网关职责。
#### 网关层局限无法感知 Agent 内部编排细节（多步推理、工具调用链）；只能看到网关↔LLM 这一段；对不走网关的直连流量无能为力；会成为单点瓶颈。
最佳实践是双层覆盖：网关层负责全局统一采集（覆盖所有应用、跨语言、成本追踪），SDK 层负责 Agent 内部的细粒度追踪（多步推理、工具调用、评估）。两者通过trace_id串联，形成完整的端到端视图。
## 2. 三种架构范式网关层实现 AI 可观测性，根据网关本身的架构，分为三种范式：
```
graph TB
 subgraph "范式 A：AI 原生网关内置"
 PA1["LiteLLM Proxy
Proxy Server"] --> PA2["内置 OTel Callback"]
 PA1 --> PA3["内置 Middleware"]
 PA1 --> PA4["Custom Callback Hook"]
 end

 subgraph "范式 B：通用网关 + 扩展"
 PB1["Envoy / APISIX / Kong"] --> PB2["WASM / Lua 插件"]
 PB1 --> PB3["AI Proxy 插件"]
 PB1 --> PB4["External Processor"]
 end

 subgraph "范式 C：自建中间件管道"
 PC1["自建网关
(FastAPI / Go net/http)"] --> PC2["请求拦截器链"]
 PC1 --> PC3["响应解析器"]
 PC1 --> PC4["Span 构建器"]
 end

 style PA1 fill:#1a1d27,stroke:#a78bfa,stroke-width:2px
 style PB1 fill:#1a1d27,stroke:#34d399,stroke-width:2px
 style PC1 fill:#1a1d27,stroke:#f59e0b,stroke-width:2px
```图 2：三种网关层可观测性实现范式
| **范式** | **代表方案** | **接入成本** | **灵活度** | **性能** | **适用团队** |
| A: AI 原生网关 | LiteLLM Proxy | 极低 | 中 | 中 | 快速落地、Python 技术栈 |
| B: 通用网关扩展 | Envoy / APISIX / Kong | 中 | 高 | 极高 | 已有网关基础设施、高流量 |
| C: 自建中间件 | 自定义网关 | 高 | 极高 | 取决于实现 | 特殊需求、深度定制 |
## 3. 方案一：LiteLLM Proxy 原生方案### 3.1 架构原理LiteLLM Proxy 是目前最成熟的 AI 原生网关方案。它本身就是一个 LLM 流量的代理服务器，内置了完整的 OpenTelemetry v2 支持，一个请求的完整生命周期——HTTP 入口、鉴权、guardrails、LLM 调用、缓存/数据库操作——全部嵌套在一棵 Span 树中。[1]
```
sequenceDiagram
 participant Client as 业务应用
 participant GW as LiteLLM Proxy
 participant LLM as OpenAI / Anthropic
 participant OTel as OTLP Collector

 Client->>GW: POST /chat/completions
 Note over GW: Span: Received Proxy Server Request

 GW->>GW: Auth (API Key 验证)
 Note over GW: Span: auth

 GW->>GW: Guardrails (内容审查)
 Note over GW: Span: guardrails

 GW->>GW: Router (模型路由)
 Note over GW: Span: router

 GW->>LLM: POST /v1/chat/completions
 Note over GW: Span: chat gpt-4o

 LLM-->>GW: Response (streaming)
 Note over GW: Span: 记录 token 用量、延迟

 GW->>GW: Cache Write
 Note over GW: Span: redis

 GW-->>Client: Response
 Note over GW: Span: 结束, 导出到 OTel

 GW->>OTel: OTLP gRPC Export
```图 3：LiteLLM Proxy 内置 Span 生命周期——一个请求的完整链路自动生成
### 3.2 接入方式：一行配置# litellm_config.yaml — 网关配置general_settings:master_key: os.environ/PROXY_MASTER_KEYmodel_list:-model_name: gpt-4olitellm_params:model: openai/gpt-4oapi_key: os.environ/OPENAI_API_KEY-model_name: claude-sonnetlitellm_params:model: anthropic/claude-sonnet-4-20250514api_key: os.environ/ANTHROPIC_API_KEYlitellm_settings:# 核心：一行配置开启 OpenTelemetry v2otel: True# 成功/失败回调success_callback: ["otel"]failure_callback: ["otel"]# 可选：同时发送到多个后端callbacks: ["otel", "langfuse", "prometheus"]router_settings:routing_strategy: "usage-based"allowed_fails: 3num_retries: 2
# 启动命令litellm--config litellm_config.yaml --port4000# 或通过 Dockerdockerrun -p4000:4000\-e OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4317
-v ./litellm_config.yaml:/app/config.yaml 
ghcr.io/berriai/litellm:main-latest
### 3.3 自定义回调扩展LiteLLM 的 callback 机制允许注入自定义逻辑，是实现可观测性插件化的关键入口：
# custom_obs_callback.pyimportlitellmfromlitellm.integrations.custom_loggerimportCustomLoggerfromopentelemetryimporttraceclassAIObservabilityCallback(CustomLogger):"""自定义可观测性回调——继承 LiteLLM 的 CustomLogger"""async defasync_log_success_event(self, kwargs, response_obj, start_time, end_time):"""LLM 调用成功时触发"""tracer = trace.get_tracer("ai-gateway-obs")withtracer.start_as_current_span(name="chat {model}".format(model=kwargs.get("model")),
kind=trace.SpanKind.CLIENT
)asspan:# 标准 GenAI 属性span.set_attribute("gen_ai.operation.name","chat")
span.set_attribute("gen_ai.request.model", kwargs.get("model"))
span.set_attribute("gen_ai.usage.input_tokens", response_obj.usage.prompt_tokens)
span.set_attribute("gen_ai.usage.output_tokens", response_obj.usage.completion_tokens)# 业务自定义属性span.set_attribute("tenant.id", kwargs.get("user"))
span.set_attribute("cost.total", response_obj._hidden_params.get("response_cost"))async defasync_log_failure_event(self, kwargs, response_obj, start_time, end_time):"""LLM 调用失败时触发"""# 记录异常 Span，携带错误类型和消息pass# 注册回调litellm.callbacks= [AIObservabilityCallback()]
插件化要点：将AIObservabilityCallback打包为独立的 Python 包，通过litellm_settings.callbacks配置引用。这样可观测性能力就是一个可拔插的模块，不修改 LiteLLM 源码，不绑定特定版本。
### 3.4 网关层独有：请求级全链路 SpanLiteLLM OTel v2 的核心价值在于它为每个请求生成一棵完整的 Span 树，涵盖了网关层能看到的所有环节：
| **Span 名称** | **层级** | **记录内容** |
| Received Proxy Server Request | Root | HTTP 方法、路径、请求体大小、客户端 IP、user agent |
| auth | Child | API Key hash、认证耗时、认证结果 |
| guardrails | Child | 内容审查结果、是否拦截、审查耗时 |
| router | Child | 路由决策、选中的 deployment、fallback 次数 |
| chat {model} | Child | 模型名、provider、token 用量、延迟、finish_reason |
| redis | Child | 缓存命中/未命中、key、操作耗时 |
| self | Child | LiteLLM 内部处理耗时 |
## 4. 方案二：Envoy AI Gateway + WASM 插件### 4.1 架构原理Envoy AI Gateway 是 CNCF 旗下的 AI 网关项目，v0.3 版本已内置 OpenTelemetry tracing 支持（基于 OpenInference 语义约定）。它的核心优势是 C++ 级别的性能（微秒级延迟）和 WASM 插件机制带来的极致扩展性。[2]
```
graph TB
 subgraph "Envoy AI Gateway"
 subgraph "Listener Filter Chain"
 LF["HTTP Connection Manager"]
 end

 subgraph "HTTP Filter Chain"
 F1["WASM Filter: AI Obs Plugin"]
 F2["External Processor: PII Filter"]
 F3["Router: AI Backend"]
 end

 subgraph "WASM Plugin (Rust/Go/C++)"
 W1["请求拦截器"]
 W2["Span 构建器"]
 W3["OTLP 导出器"]
 end

 subgraph "Upstream"
 U1["OpenAI"]
 U2["Anthropic"]
 U3["Ollama"]
 end
 end

 LF --> F1 --> F2 --> F3
 F1 -.-> W1
 W1 --> W2 --> W3
 F3 --> U1
 F3 --> U2
 F3 --> U3
 W3 --> OTLP["OTLP Collector"]

 style F1 fill:#1a1d27,stroke:#a78bfa,stroke-width:2px
 style W1 fill:#1a1d27,stroke:#34d399
 style W2 fill:#1a1d27,stroke:#34d399
 style W3 fill:#1a1d27,stroke:#34d399
```图 4：Envoy AI Gateway + WASM 插件架构——过滤器链中注入可观测性逻辑
### 4.2 WASM 插件实现WASM 插件运行在 Envoy 的沙箱中，可以访问请求/响应的完整内容，且性能接近原生 C++。关键实现步骤：
// Rust WASM 插件核心逻辑（使用 proxy-wasm SDK）useproxy_wasm::traits::;useproxy_wasm::types::;structAIObservabilityFilter{// 插件上下文context_id:u32,// Span 状态span_start_time:Option<SystemTime>,// 请求体缓冲区request_body:Vec<u8>,
response_body:Vec<u8>,
}implHttpContextforAIObservabilityFilter{fnon_http_request_headers(&mutself, _num_headers:usize, _end_of_stream:bool) ->Action{// 1. 记录请求开始时间self.span_start_time =Some(SystemTime::now());// 2. 提取或生成 trace_id（从 W3C traceparent header）if letSome(traceparent) =self.get_http_request_header("traceparent") {// 使用上游传入的 trace_id，串联分布式链路self.set_property("traceparent", traceparent);
}Action::Continue}fnon_http_request_body(&mutself, body_size:usize, end_of_stream:bool) ->Action{// 3. 缓冲请求体（用于后续提取 model / prompt 信息）if letSome(body) =self.get_http_request_body(0, body_size) {self.request_body.extend_from_slice(&body);
}Action::Continue}fnon_http_response_headers(&mutself, _num_headers:usize, _end_of_stream:bool) ->Action{// 4. 检查响应状态if letSome(status) =self.get_http_response_header(":status") {self.set_property("response_status", status);
}Action::Continue}fnon_http_response_body(&mutself, body_size:usize, end_of_stream:bool) ->Action{// 5. 缓冲响应体（提取 token 用量信息）if letSome(body) =self.get_http_response_body(0, body_size) {self.response_body.extend_from_slice(&body);
}ifend_of_stream {// 6. 流结束：构建 Span 并通过 HTTP 发送到 Collectorself.build_and_export_span();
}Action::Continue}
}implAIObservabilityFilter{fnbuild_and_export_span(&self) {// 解析请求体中的 model 参数letrequest:Value=serde_json::from_slice(&self.request_body).unwrap();letmodel = request["model"].as_str().unwrap_or("unknown");// 解析响应体中的 usageletresponse:Value=serde_json::from_slice(&self.response_body).unwrap();letusage = &response["usage"];// 构建 OTLP Span JSON，通过 HTTP dispatch 到 sidecar collectorletspan =json!({"name":format!("chat {}", model),"kind":3,// CLIENT"attributes": {"gen_ai.operation.name":"chat","gen_ai.request.model": model,"gen_ai.usage.input_tokens": usage["prompt_tokens"],"gen_ai.usage.output_tokens": usage["completion_tokens"],
}
});self.dispatch_http_call("otel-collector", span);
}
}
### 4.3 部署架构# envoy-gateway-config.yamlapiVersion: gateway.networking.k8s.io/v1kind: Gatewaymetadata:name: ai-gatewayspec:gatewayClassName: envoy-ai-gatewaylisteners:-name: httpport:80protocol: HTTP
---apiVersion: gateway.envoyproxy.io/v1alpha1kind: AIGatewayRoutemetadata:name: llm-routespec:llmRequestCosts:# 成本追踪（内置）-metadataKey: llm_input_tokentype: InputToken
-metadataKey: llm_output_tokentype: OutputTokenbackendRefs:
-name: openai-backendweight:60-name: anthropic-backendweight:40---# WASM 插件挂载apiVersion: gateway.envoyproxy.io/v1alpha1kind: EnvoyExtensionPolicymetadata:name: ai-obs-pluginspec:wasm:
-name: ai-observability-pluginrootID: ai_obs_filterurl: oci://registry.example.com/ai-obs-plugin:1.0.0
WASM 方案的独特优势：插件编译为 WASM 字节码后通过 OCI 镜像分发，支持热加载（不中断流量）。一个 WASM 插件可以同时处理 OpenAI、Anthropic、Ollama 等多种 LLM 协议，因为网关层看到的是统一的 HTTP 请求/响应，与具体协议无关。
## 5. 方案三：APISIX / Kong + 自定义插件### 5.1 APISIX 方案APISIX 通过内置的ai-proxy插件将 LLM 流量统一代理，v3.14 新增了$llm_*NGINX 变量，自动填充 LLM 请求/响应元数据，可直接在日志插件中引用而无需自定义解析。[3]再配合opentelemetry插件，即可将 LLM 调用信息写入 Span 属性。
# APISIX 路由配置 — 三步实现网关层 AI 可观测性routes:-uri: /v1/chat/completionsplugins:# 第一步：代理 LLM 请求ai-proxy:provider: openaiauth:header:Authorization: "Bearer ENV_OPENAI_API_KEY"model:name: gpt-4ooptions:max_tokens:4096# 第二步：注入 OpenTelemetry tracingopentelemetry:sampler:name: always_onadditional_attributes:# 自定义 Span 属性-"gen_ai.request.model"-"llm_model"# 内置 LLM 变量-"gen_ai.usage.input_tokens"-"llm_prompt_tokens"# 内置 LLM 变量-"gen_ai.usage.output_tokens"-"llm_completion_tokens"# 第三步：写入结构化日志（含 LLM 字段）file-logger:path: /var/log/ai-observability.loglog_format:trace_id: "opentelemetry_trace_id"model: "llm_model"prompt_tokens: "llm_prompt_tokens"completion_tokens: "llm_completion_tokens"latency: "request_time"status: "status"| **APISIX 内置 LLM 变量** | **含义** | **对应 OTel 属性** |
| $llm_model | 请求的模型名 | gen_ai.request.model |
| $llm_prompt_tokens | prompt token 数 | gen_ai.usage.input_tokens |
| $llm_completion_tokens | completion token 数 | gen_ai.usage.output_tokens |
| $llm_total_tokens | 总 token 数 | — |
| $llm_provider | LLM 提供商 | gen_ai.provider.name |
| $llm_endpoint | 上游端点 | server.address |
| $llm_status | LLM 调用状态 | error.type（当失败时） |
### 5.2 Kong 方案Kong 的 AI Gateway 能力通过ai-proxy-advanced插件实现，支持 LLM 路由、模型别名、请求/响应转换。搭配opentelemetry插件可实现基础的可观测性，但高级 LLM 属性（token 用量、模型名）需要自定义 Lua 插件解析响应体。
-- Kong 自定义 Lua 插件：AI ObservabilitylocalBasePlugin =require"kong.plugins.base_plugin"localcjson =require"cjson"localAIObsHandler= BasePlugin:extend()functionAIObsHandler:new()AIObsHandler.super.new(self,"ai-observability")endfunctionAIObsHandler:access(conf)AIObsHandler.super.access(self)-- 解析请求体中的 model 参数localbody = kong.request.get_body()ifbodyandbody.modelthenkong.ctx.shared.llm_model= body.modelend-- 记录请求开始时间kong.ctx.shared.llm_start_time=ngx.now()endfunctionAIObsHandler:body_filter(conf)AIObsHandler.super.body_filter(self)-- 解析响应体中的 usage 信息ifnotkong.ctx.shared.llm_usage_parsedthenlocalresp_body = kong.response.get_raw_body()ifresp_bodythenlocalok, decoded =pcall(cjson.decode, resp_body)ifokanddecoded.usagethenkong.ctx.shared.llm_usage= decoded.usage
kong.ctx.shared.llm_usage_parsed=trueendendendendfunctionAIObsHandler:log(conf)AIObsHandler.super.log(self)-- 在日志阶段写入结构化日志和 Span 属性localusage = kong.ctx.shared.llm_usageor{}locallatency = (ngx.now() - kong.ctx.shared.llm_start_time) *1000kong.log.info(cjson.encode({trace_id= kong.ctx.shared.trace_id,model= kong.ctx.shared.llm_model,input_tokens= usage.prompt_tokens,output_tokens= usage.completion_tokens,latency_ms= latency,
}))endreturnAIObsHandler
## 6. 方案四：自建网关中间件管道### 6.1 架构设计当现有网关方案无法满足需求时，可以在自建网关中实现中间件管道（Middleware Pipeline）。核心思想是把可观测性拆成独立的中间件，与鉴权、限流、路由等其他中间件并列，通过管道编排组合。
```
graph LR
 REQ["HTTP Request"] --> M1["AuthMiddleware"]
 M1 --> M2["RateLimitMiddleware"]
 M2 --> M3["ObsPreMiddleware
记录开始时间
创建 Span"]
 M3 --> M4["RouterMiddleware"]
 M4 --> M5["LLM Proxy"]
 M5 --> M6["ObsPostMiddleware
提取 token 用量
设置 Span 属性"]
 M6 --> M7["ResponseMiddleware"]
 M7 --> RES["HTTP Response"]

 M3 -.-> OTEL["OTLP Exporter
(异步导出)"]
 M6 -.-> OTEL

 style M3 fill:#1a1d27,stroke:#a78bfa,stroke-width:2px
 style M6 fill:#1a1d27,stroke:#a78bfa,stroke-width:2px
 style OTEL fill:#1a1d27,stroke:#34d399,stroke-dasharray:5
```图 5：自建网关中间件管道——可观测性作为两个独立中间件插入管道
### 6.2 Python 实现（FastAPI）# middleware.py — 可观测性中间件，单文件即可拔插importtime, jsonfromfastapiimportRequest, Responsefromstarlette.middleware.baseimportBaseHTTPMiddlewarefromopentelemetryimporttracefromopentelemetry.sdk.traceimportTracerProviderfromopentelemetry.exporter.otlp.proto.grpc.trace_exporterimportOTLPSpanExporterfromopentelemetry.sdk.trace.exportimportBatchSpanProcessor# 全局初始化——仅一次provider= TracerProvider()provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter())
)trace.set_tracer_provider(provider)tracer= trace.get_tracer("ai-gateway")classAIObservabilityMiddleware(BaseHTTPMiddleware):"""单文件可拔插 AI 可观测性中间件"""async defdispatch(self, request: Request, call_next):# 仅在 LLM 路径上启用if notrequest.url.path.startswith("/v1/chat"):return awaitcall_next(request)# 读取请求体（提取 model 信息）body =awaitrequest.body()
request_body = json.loads(body)
model = request_body.get("model","unknown")# 创建 Spanwithtracer.start_as_current_span("chat {model}".format(model=model),
kind=trace.SpanKind.CLIENT,
attributes={"gen_ai.operation.name":"chat","gen_ai.request.model": model,"gen_ai.provider.name":"openai","gen_ai.request.temperature": request_body.get("temperature"),
}
)asspan:
start = time.time()# 构造新的请求体传递到下游async defreceive():return{"type":"http.request","body": body}
request._receive = receive
response: Response =awaitcall_next(request)
latency_ms = (time.time() - start) *1000# 解析响应体中的 usage 信息ifresponse.status_code ==200:
resp_body = response.body.decode()try:
resp_data = json.loads(resp_body)
usage = resp_data.get("usage", {})
span.set_attribute("gen_ai.usage.input_tokens", usage.get("prompt_tokens",0))
span.set_attribute("gen_ai.usage.output_tokens", usage.get("completion_tokens",0))
span.set_attribute("gen_ai.response.model", resp_data.get("model"))exceptjson.JSONDecodeError:passelse:
span.set_attribute("error.type","http_{status}".format(status=response.status_code))
span.set_attribute("gen_ai.client.operation.duration", latency_ms)returnresponse
# main.py — 应用入口，一行代码拔插中间件fromfastapiimportFastAPIfrommiddlewareimportAIObservabilityMiddlewareapp= FastAPI()# 可观测性中间件：注释掉即移除，取消注释即启用app.add_middleware(AIObservabilityMiddleware)# 业务路由——完全不变@app.post("/v1/chat/completions")async defchat_completions(request: dict):# ... 业务逻辑pass### 6.3 Go 实现（net/http）// middleware.go — Go 标准库实现packagegatewayimport("bytes""encoding/json""io""net/http""time""go.opentelemetry.io/otel""go.opentelemetry.io/otel/attribute""go.opentelemetry.io/otel/trace")funcAIObservabilityMiddleware(next http.Handler) http.Handler {returnhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {if!isLLMPath(r.URL.Path) {
next.ServeHTTP(w, r)return}// 读取请求体bodyBytes, _ := io.ReadAll(r.Body)
r.Body.Close()
r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))varreqBodymap[string]interface{}
json.Unmarshal(bodyBytes, &reqBody)
model, _ := reqBody["model"].(string)// 创建 Spantracer := otel.Tracer("ai-gateway")
ctx, span := tracer.Start(
r.Context(),"chat "+model,
trace.WithSpanKind(trace.SpanKindClient),
trace.WithAttributes(
attribute.String("gen_ai.operation.name","chat"),
attribute.String("gen_ai.request.model", model),
),
)deferspan.End()
start := time.Now()// 包装 ResponseWriter 以捕获响应体rw := &responseRecorder{ResponseWriter: w}
r = r.WithContext(ctx)
next.ServeHTTP(rw, r)// 解析响应体中的 usagevarrespBodymap[string]interface{}
json.Unmarshal(rw.body.Bytes(), &respBody)ifusage, ok := respBody["usage"].(map[string]interface{}); ok {
span.SetAttributes(
attribute.Int("gen_ai.usage.input_tokens",toInt(usage["prompt_tokens"])),
attribute.Int("gen_ai.usage.output_tokens",toInt(usage["completion_tokens"])),
)
}
span.SetAttributes(
attribute.Float64("gen_ai.client.operation.duration",float64(time.Since(start).Milliseconds())),
)
})
}
## 7. Span 生成模型设计### 7.1 网关层 Span 树无论采用哪种方案，网关层生成的 Span 树结构是统一的。关键在于：网关层不感知 Agent 内部的 multi-step 推理，它看到的是"一次 HTTP 请求 → 一次 LLM 调用"的一对一映射。
```
graph TD
 ROOT["Span: gateway.request
HTTP POST /v1/chat/completions"]
 AUTH["Span: gateway.auth
API Key 验证"]
 ROUTE["Span: gateway.route
模型路由决策"]
 LLM["Span: chat gpt-4o
CLIENT → LLM API"]
 CACHE["Span: gateway.cache
缓存读写"]

 ROOT --> AUTH
 ROOT --> ROUTE
 ROOT --> LLM
 ROOT --> CACHE

 style ROOT fill:#1a1d27,stroke:#a78bfa,stroke-width:2px
 style LLM fill:#1a1d27,stroke:#34d399,stroke-width:2px
```图 6：网关层标准 Span 树——一个 HTTP 请求对应一棵树
### 7.2 与 SDK 层 Span 的串联当同时部署网关层和 SDK 层可观测性时，通过 W3C Trace Context 将两个维度的 Span 串联：
```
sequenceDiagram
 participant App as 业务应用
 participant SDK as SDK 层插件
 participant GW as 网关层插件
 participant LLM as LLM API

 Note over App,LLM: trace_id = "abc123"（全局唯一）

 App->>SDK: invoke_agent (span_id=001)
 SDK->>SDK: execute_tool (span_id=002, parent=001)
 SDK->>GW: POST /v1/chat/completions
 Note over SDK,GW: Header: traceparent: 00-abc123-001-01

 GW->>GW: gateway.request (span_id=003, parent=001)
 GW->>GW: gateway.auth (span_id=004, parent=003)
 GW->>LLM: chat gpt-4o (span_id=005, parent=003)

 Note over App,LLM: 最终 Span 树:
invoke_agent
├── execute_tool
└── gateway.request
├── gateway.auth
└── chat gpt-4o
```图 7：双层 Span 串联——通过 traceparent header 将网关层和 SDK 层 Span 合并为一棵树
实现要点：
- SDK 层插件在发起 HTTP 请求时，自动将当前 Span 的traceparent注入到 HTTP Header 中- 网关层插件在收到请求时，从traceparentHeader 中提取trace_id和parent_span_id- 网关层创建的 Root Span 的 parent 指向 SDK 层传入的 Span，形成完整的父子关系- 如果请求没有携带traceparent（直连场景），网关层自行创建新的trace_id### 7.3 流式响应的 Span 处理LLM 的流式响应（SSE / streaming）对 Span 的结束时间提出了特殊要求：不能等到流完全结束才关闭 Span，否则 Span 时长会包含用户的阅读时间。正确做法是：
| **流式阶段** | **Span 操作** | **说明** |
| 收到第一个 chunk | 记录gen_ai.response.time_to_first_token | TTFT 是衡量用户体验的关键指标 |
| 收到最后一个 chunk（data: [DONE]） | 关闭 Span，记录gen_ai.usage.* | usage 信息通常在最后一个 chunk 中 |
| 流中断 / 客户端断开 | 关闭 Span，设置error.type="cancelled" | 记录中断原因 |
## 8. 方案对比与选型建议| **维度** | **LiteLLM Proxy** | **Envoy AI Gateway** | **APISIX** | **自建中间件** |
| 接入成本 | 极低
一行配置 | 中
WASM 开发 | 中
插件配置 | 高
从零实现 |
| 性能基准 | ~5ms 额外延迟 | < 1ms | ~2ms 额外延迟 | 取决于实现 |
| LLM 协议覆盖 | 100+ 模型 | OpenAI 兼容 | OpenAI 兼容 | 按需实现 |
| Span 丰富度 | 完整
auth/router/guardrails/cache | 基础 | 基础 | 按需实现 |
| Token 用量获取 | 自动 | 需解析响应 | 内置变量 | 需解析响应 |
| 成本追踪 | 内置 | 需自行计算 | 需自行计算 | 需自行计算 |
| 流式支持 | 原生 | 需处理 SSE | 需处理 SSE | 需处理 SSE |
| WASM 扩展 | 不支持 | 支持 | 支持 | 不支持 |
| 运维复杂度 | 低 | 中高 | 中 | 高 |
### 选型决策树```
flowchart TD
 Q1{"是否已有
API 网关？"}
 Q1 -->|"否，需要快速落地"| R1["LiteLLM Proxy"]
 Q1 -->|"是，已有 Envoy"| Q2{"团队是否有
Rust/C++ 能力？"}
 Q1 -->|"是，已有 APISIX"| R3["APISIX + ai-proxy
+ opentelemetry 插件"]
 Q1 -->|"是，已有 Kong"| R4["Kong + ai-proxy-advanced
+ 自定义 Lua 插件"]

 Q2 -->|"是"| Q3{"流量规模？"}
 Q2 -->|"否"| R1

 Q3 -->|"> 10K QPS"| R2["Envoy AI Gateway
+ WASM 插件"]
 Q3 -->|"< 10K QPS"| R1

 style R1 fill:#1a1d27,stroke:#a78bfa,stroke-width:2px
 style R2 fill:#1a1d27,stroke:#34d399,stroke-width:2px
 style R3 fill:#1a1d27,stroke:#a78bfa,stroke-width:2px
 style R4 fill:#1a1d27,stroke:#f59e0b,stroke-width:2px
```图 8：网关层方案选型决策树
推荐路径：80% 的团队应该从 LiteLLM Proxy 开始 — 接入成本最低、LLM 生态最完整、OTel v2 的 Span 覆盖度最高。当流量规模超过 10K QPS 或已有 Envoy 基础设施时，再考虑迁移到 Envoy AI Gateway + WASM 方案。
## 9. 实施路线图- 第一阶段：LiteLLM Proxy 快速接入2 周
部署 LiteLLM Proxy 作为 AI 流量的统一入口。配置 OTel v2 callback，验证 Span 生成和 OTLP 导出。业务应用只需将 LLM API 端点指向网关地址。- 第二阶段：自定义回调与指标2 周
开发自定义 CustomLogger 回调，注入租户 ID、业务标签等自定义属性。配置 Prometheus metrics 采集，建立 Grafana 仪表盘（延迟、token 用量、成本、错误率）。- 第三阶段：网关层 + SDK 层双层串联3 周
在关键 Agent 应用中部署 SDK 层插件，通过 W3C Trace Context 与网关层 Span 串联。验证端到端 Trace 完整性：invoke_agent → execute_tool → gateway.request → chat。- 第四阶段：Envoy 高性能方案4 周
当流量超过 10K QPS 时，将可观测性逻辑迁移到 Envoy AI Gateway WASM 插件。LiteLLM Proxy 降级为开发/测试环境方案。## Sources- LiteLLM, "OpenTelemetry v2 — Full-request tracing" — LiteLLM Proxy 内置的 OTel v2 支持，一个请求的完整生命周期 Span 树，涵盖 auth、router、guardrails、LLM 调用、cache 等环节。https://docs.litellm.ai/docs/observability/opentelemetry_v2- Envoy AI Gateway, "Enhancing AI Gateway Observability — OpenTelemetry Tracing Arrives in Envoy AI Gateway" — v0.3 版本引入基于 OpenInference 语义约定的 OpenTelemetry tracing，支持 WASM 插件扩展。https://aigateway.envoyproxy.io/blog/openinference-for-ai-observability/- Apache APISIX, "ai-proxy Plugin" — 内置 LLM 代理插件，v3.14 新增 $llm_* NGINX 变量，自动填充 LLM 请求/响应元数据。https://apisix.apache.org/docs/apisix/plugins/ai-proxy/- TrueFoundry, "Observability in the Dark: Logs, Tracing & OpenTelemetry Across Four AI Gateways" — 对比 LiteLLM、Kong、Envoy、APISIX 四种 AI 网关的可观测性能力。https://www.truefoundry.com/observability-dark