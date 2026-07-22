---
title: AI 可拔插可观测性插件设计方案
---

# AI 可拔插可观测性插件设计方案

# 技术设计文档v1.0
# AI 调用链路可观测性可拔插插件设计方案
2026-07-19技术设计受众：架构师 / 平台工程师 / 后端工程师
## 目录- 背景与目标- 设计原则- 插件架构总览- 核心模块设计- 多语言接入方案- 应用层集成方式- 插件接口规范- 配置与动态开关- 性能与安全- 实现路线图## 1. 背景与目标上一份设计文档建立了 AI 调用链路可观测性的完整数据模型和架构方案。但实际落地时面临一个核心矛盾：每接入一个 AI 应用，就需要在代码中嵌入 OTel SDK、配置 Exporter、管理 Span 生命周期——侵入性高、迁移成本大、团队抵触强。
可拔插插件方案的目标是让可观测性能力像"插头"一样：
零代码
接入成本
即插即用
部署模式
热拔卸
移除方式
具体而言，插件需要满足四个核心能力：
零侵入接入。通过启动参数、环境变量或配置文件声明插件，无需修改业务代码。移除插件后应用行为完全不变。
多框架自适应。自动识别 OpenAI SDK、LangChain、LlamaIndex、Anthropic SDK、AWS Bedrock 等主流 AI 库，注入对应的拦截逻辑。
动态可控。运行时通过配置中心调整采样率、内容捕获开关、导出目标，无需重启应用。
性能无损。所有数据采集在独立线程/协程中异步执行，Span 构建和导出不阻塞主业务链路。插件自身开销控制在 < 1% CPU 和 < 5MB 内存。
## 2. 设计原则#### 非侵入优先优先使用运行时字节码增强、猴子补丁、eBPF 等零代码技术。仅在无法自动拦截时提供声明式注解/装饰器作为降级方案。
#### 标准协议输出所有 Span 和 Metrics 遵循 OTel GenAI 语义约定，通过 OTLP 协议导出。不绑定任何后端平台，可同时输出到多个目标。
#### 渐进式增强默认只采集基础 Span 和 Metrics（延迟、token 用量），内容捕获和质量评估按需开启。插件能力分层，用户按需加载。
#### 故障隔离插件任何模块的异常（拦截失败、导出超时、配置错误）不得影响业务主流程。拦截层和导出层均设有独立的异常熔断和超时控制。
## 3. 插件架构总览```
graph TB
 subgraph "应用进程"
 A1["AI 应用代码
(OpenAI / LangChain / ...)"]
 A2["插件加载入口
(sitecustomize / -javaagent / --require)"]
 end

 subgraph "插件核心 (Plugin Core)"
 B1["插件生命周期管理器
PluginManager"]
 B2["拦截引擎
InterceptorEngine"]
 B3["Span 构建器
SpanBuilder"]
 B4["配置管理器
ConfigManager"]
 B5["导出器链
ExporterChain"]
 end

 subgraph "拦截器注册表 (Interceptor Registry)"
 C1["OpenAI Interceptor"]
 C2["Anthropic Interceptor"]
 C3["LangChain Interceptor"]
 C4["LlamaIndex Interceptor"]
 C5["MCP Interceptor"]
 C6["自定义 Interceptor"]
 end

 subgraph "导出后端"
 D1["OTLP Collector"]
 D2["ClickHouse"]
 D3["Prometheus"]
 D4["S3 / MinIO"]
 end

 A1 -->|"运行时拦截"| A2
 A2 --> B1
 B1 --> B2
 B1 --> B4
 B2 --> C1
 B2 --> C2
 B2 --> C3
 B2 --> C4
 B2 --> C5
 B2 --> C6
 B2 --> B3
 B3 --> B5
 B5 --> D1
 B5 --> D2
 B5 --> D3
 B5 --> D4
 B4 -.->|"动态配置"| B2
 B4 -.->|"动态配置"| B5

 style A1 fill:#1a1d27,stroke:#f59e0b
 style A2 fill:#1a1d27,stroke:#38bdf8
 style B1 fill:#1a1d27,stroke:#f59e0b,stroke-width:2px
 style B2 fill:#1a1d27,stroke:#f59e0b,stroke-width:2px
 style B3 fill:#1a1d27,stroke:#f59e0b,stroke-width:2px
 style B4 fill:#1a1d27,stroke:#38bdf8,stroke-dasharray:5
 style B5 fill:#1a1d27,stroke:#f59e0b,stroke-width:2px
```图 1：插件整体架构——加载入口、核心引擎、拦截器注册表、导出后端四层结构
架构的核心思想是将拦截逻辑与业务代码完全解耦。插件通过运行时注入机制（monkey-patch / bytecode / eBPF）在 AI SDK 的调用路径上插入拦截点，业务代码完全感知不到插件的存在。
## 4. 核心模块设计### 4.1 插件生命周期管理器PluginManager 是插件的"大脑"，负责协调所有模块的初始化、运行时状态和销毁。
```
stateDiagram-v2
 [*] --> UNLOADED
 UNLOADED --> LOADING : load()
 LOADING --> LOADED : 拦截器注册完成
 LOADED --> STARTING : start()
 STARTING --> RUNNING : 导出器连接就绪
 RUNNING --> PAUSED : pause()
 PAUSED --> RUNNING : resume()
 RUNNING --> STOPPING : stop()
 PAUSED --> STOPPING : stop()
 STOPPING --> UNLOADED : 资源释放完成
 RUNNING --> RUNNING : 配置热更新
 PAUSED --> PAUSED : 配置热更新

 state LOADING {
 [*] --> 扫描拦截器
 扫描拦截器 --> 注册拦截器
 注册拦截器 --> 注入Hook点
 注入Hook点 --> [*]
 }

 state STARTING {
 [*] --> 连接导出器
 连接导出器 --> 启动缓冲区
 启动缓冲区 --> [*]
 }
```图 2：插件生命周期状态机——从加载到销毁的完整状态流转
| **生命周期阶段** | **触发方式** | **核心操作** |
| LOADING | 进程启动自动 / 手动调用 | 扫描 classpath/module 中的拦截器实现，通过 SPI 注册到 InterceptorRegistry，在目标库的调用路径上注入 Hook 点 |
| LOADED | 拦截器注册完成 | 所有拦截器就位但尚未开始采集数据，Span 缓冲区未分配 |
| STARTING | 自动 / 手动调用 | 初始化 Span 构建器和导出器链，建立与 OTLP Collector 的 gRPC 连接，启动异步导出协程 |
| RUNNING | 导出器就绪 | 正常采集和导出状态。支持热更新配置：采样率、导出目标、内容捕获开关均可动态调整 |
| PAUSED | 运行时暂停 | 拦截器继续执行但 Span 不入队，已在队列中的数据继续导出。用于故障排查或压力测试场景 |
| STOPPING | 进程退出 / 手动停止 | 等待缓冲区排空（最多 5s），关闭 gRPC 连接，释放内存，卸载 Hook 点 |
### 4.2 拦截引擎InterceptorEngine 是整个插件最核心的模块，负责在 AI SDK 的调用路径上注入可观测性 Hook。不同语言的拦截机制完全不同，但都遵循统一的拦截器接口。
```
flowchart LR
 subgraph "拦截点"
 P1["openai.chat.completions.create()"]
 P2["anthropic.messages.create()"]
 P3["langchain.Chain.invoke()"]
 P4["llama_index.QueryEngine.query()"]
 P5["mcp.Client.call_tool()"]
 end

 subgraph "拦截器链"
 I1["PreHook
记录开始时间
注入 trace_id"]
 I2["SpanBuilder
构建 Span
填充属性"]
 I3["PostHook
记录结束时间
提取 token 用量"]
 I4["ErrorHook
捕获异常
设置 error 状态"]
 I5["EvalHook
可选：LLM-as-Judge
质量评分"]
 end

 P1 --> I1
 P2 --> I1
 P3 --> I1
 P4 --> I1
 P5 --> I1
 I1 --> I2 --> I3
 I1 --> I4
 I3 --> I5

 style P1 fill:#1a1d27,stroke:#38bdf8
 style P2 fill:#1a1d27,stroke:#38bdf8
 style P3 fill:#1a1d27,stroke:#38bdf8
 style P4 fill:#1a1d27,stroke:#38bdf8
 style P5 fill:#1a1d27,stroke:#38bdf8
 style I1 fill:#1a1d27,stroke:#f59e0b
 style I2 fill:#1a1d27,stroke:#f59e0b
 style I3 fill:#1a1d27,stroke:#f59e0b
 style I4 fill:#1a1d27,stroke:#ef4444
 style I5 fill:#1a1d27,stroke:#38bdf8,stroke-dasharray:5
```图 3：拦截引擎数据流——从拦截点到拦截器链的完整处理路径
每个拦截器实现一个标准接口，包含五个钩子：
| **钩子** | **触发时机** | **职责** |
| pre_hook(ctx, call_args) | 方法调用前 | 创建 Span，记录开始时间，注入/提取 trace context |
| post_hook(ctx, result) | 方法返回后 | 记录结束时间，提取 token 用量、model 信息，设置 Span 状态 |
| error_hook(ctx, exception) | 方法抛出异常时 | 记录异常类型和消息，设置 Span 为 error 状态 |
| content_hook(ctx, prompt, completion) | 内容捕获启用时 | 将 prompt/completion 写入外部存储，Span 仅记录引用 URL |
| eval_hook(ctx, span) | 评估启用时 | 对 Span 执行 LLM-as-Judge 评估，将评分作为 Span 属性 |
### 4.3 Span 构建器SpanBuilder 负责将拦截器捕获的原始数据转换为符合 OTel GenAI 语义约定的 Span 对象。它不直接依赖 OTel SDK，而是生成中间表示，再由适配层转换为具体的 Span 实现。
| **输入数据** | **转换逻辑** | **输出 Span 属性** |
| call_args.model | 直接映射 | gen_ai.request.model |
| result.model | 直接映射 | gen_ai.response.model |
| result.usage.prompt_tokens | 直接映射 | gen_ai.usage.input_tokens |
| result.usage.completion_tokens | 直接映射 | gen_ai.usage.output_tokens |
| call_args中的 SDK 类型 | SDK → Provider 映射表 | gen_ai.provider.name |
| call_args中的操作类型 | 操作类型推断 | gen_ai.operation.name+ Span 名称 |
| context.trace_id | W3C Trace Context 传播 | trace_id+parent_span_id |
中间表示设计。SpanBuilder 产出的是语言无关的 Span IR（Intermediate Representation），而非直接写入 OTel API。这种解耦使得同一套拦截逻辑可以输出到 OTel、LangFuse、Datadog 等多种后端，也便于单元测试。
### 4.4 导出器链ExporterChain 采用责任链模式，支持将 Span 数据同时输出到多个后端。每个导出器独立运行，一个导出器的失败不影响其他导出器。
| **导出器** | **协议** | **用途** | **缓冲策略** |
| OTLP gRPC | OTLP | 标准 Trace/Metrics 导出 | Batch + 重试 |
| OTLP HTTP | OTLP | 防火墙友好场景 | Batch + 重试 |
| File Exporter | JSON Lines | 本地调试、离线分析 | 即时写入 |
| Stdout Exporter | JSON | 开发环境、容器日志 | 即时写入 |
| Content Exporter | S3/MinIO | prompt/completion 内容存储 | 异步上传 |
### 4.5 配置管理器ConfigManager 设计了四级配置优先级（从高到低）：
- 运行时配置中心（如 Consul / etcd / Nacos）— 支持热更新- 环境变量—OTEL_*标准变量 + 插件自定义变量- 配置文件—observability-plugin.yaml放在应用根目录- 默认值— 插件内置的安全默认值## 5. 多语言接入方案插件的核心能力跨语言一致，但接入机制必须适配各语言的运行时特性。以下设计覆盖 Python、Java、Node.js 和 Go 四种主流语言。
### 5.1 Python#### 方案 A：sitecustomize.py零代码在 Python 路径中放置sitecustomize.py，Python 解释器启动时自动加载。在其中 import 并初始化插件，利用 monkey-patch 替换openai.ChatCompletion.create等关键方法。
#### 方案 B：import hook零代码注册sys.meta_path上的 import hook，在目标模块（openai、anthropic、langchain）被 import 时自动包裹其关键函数。比 monkey-patch 更精确，不依赖执行时序。
# sitecustomize.py — 放入 PYTHONPATH 或 site-packagesimportosimportsysfromai_obs_pluginimportPluginManager, ConfigManager# 1. 加载配置config= ConfigManager.from_env()# 2. 仅在启用时加载ifconfig.enabled:plugin= PluginManager(config)plugin.load()# 扫描并注册拦截器，注入 import hookplugin.start()# 连接导出器，开始采集# 3. 注册进程退出时的优雅关闭importatexitatexit.register(lambda:plugin.stop())拔插操作：设置AI_OBS_ENABLED=false环境变量即可完全禁用插件，无需删除文件或修改代码。移除sitecustomize.py文件则彻底卸载。
### 5.2 Java#### 方案 A：Java Agent零代码启动时加-javaagent:ai-obs-plugin.jar。利用 ByteBuddy / ASM 在类加载时修改目标类的字节码，在OpenAiService.createChatCompletion等方法前后插入拦截逻辑。
#### 方案 B：Spring Boot Starter一行依赖添加 Maven/Gradle 依赖，利用 Spring AutoConfiguration 自动装配拦截器 Bean。适合已有 Spring 生态的项目。
// 启动命令java -javaagent:ai-obs-plugin-1.0.0.jar 
-Dotel.service.name=my-ai-app 
-Dotel.exporter.otlp.endpoint=http://localhost:4317
-jar my-ai-app.jar// 或在 META-INF/services 中注册 SPI 扩展// io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProviderpublic classAiObsCustomizerimplementsAutoConfigurationCustomizerProvider{public voidcustomize(AutoConfigurationCustomizer customizer) {
customizer.addTracerProviderCustomizer((tp, config) -> {// 注册 AI 拦截器AiInterceptorRegistry.registerAll(tp);returntp;
});
}
}
拔插操作：去掉启动参数中的-javaagent即可完全移除，或通过环境变量OTEL_JAVAAGENT_ENABLED=false禁用。
### 5.3 Node.js#### 方案 A：--require 预加载零代码启动时加node --require ai-obs-plugin/register app.js。利用 Node.js 的 Module 系统在目标模块加载时包裹其导出函数。
#### 方案 B：Middleware 模式少量代码在 Express/Koa/Fastify 等框架中作为中间件引入。适合已有 HTTP 框架的 AI 服务。
// 零代码启动node --require ai-obs-plugin/register app.js// 或一行代码接入// app.js 第一行require('ai-obs-plugin').init({serviceName:'my-ai-app'});// 插件内部实现：Module 劫持constModule =require('module');constoriginalLoad = Module._load;
Module._load=function(request, parent, isMain) {constexports =originalLoad(request, parent, isMain);if(request ==='openai') {wrapOpenAI(exports);// 包裹 chat.completions.create 等方法}returnexports;
};
### 5.4 Go#### 方案 A：eBPF 自动插桩零代码利用 OTel Go eBPF Auto-Instrumentation，在内核层面拦截网络调用和系统调用，不修改任何 Go 二进制文件。当前支持库有限。
#### 方案 B：blank import一行导入在main.go中添加import _ "ai-obs-plugin"，利用init()函数自动初始化。适用于编译型语言的最小侵入模式。
// 一行导入接入（Go）packagemainimport("github.com/openai/openai-go"_"github.com/yourorg/ai-obs-plugin"// 仅此一行)funcmain() {// 业务代码完全不变client := openai.NewClient()// ...}
| **语言** | **零代码方案** | **一行代码方案** | **成熟度** |
| Python | sitecustomize.py+ import hook | Traceloop.init() | 成熟 |
| Java | -javaagent+ 字节码增强 | Spring Boot Starter | 成熟 |
| Node.js | --require+ Module 劫持 | require('ai-obs-plugin').init() | 发展中 |
| Go | eBPF 自动插桩 | import _ "..." | 早期 |
## 6. 应用层集成方式根据应用架构的不同，插件提供四种集成模式，从最轻量的零代码到最灵活的手动控制。
### 6.1 模式对比| **模式** | **代码侵入** | **适用场景** | **拦截范围** |
| 零代码模式 | 无 | 已有 AI 应用快速接入、CI/CD 流水线自动注入 | 所有 LLM SDK 调用 |
| 一行代码模式 | 1 行 | 需要指定 service name / 自定义导出目标 | 所有 LLM SDK 调用 |
| 中间件模式 | 3-5 行 | Web 框架（FastAPI / Express / Spring） | HTTP 请求 + LLM 调用 |
| 装饰器/注解模式 | 按需 | 自定义 Agent 编排、工作流 | 指定函数/方法 |
### 6.2 零代码模式推荐的默认接入方式。通过启动参数注入，不需要修改任何代码：
# PythonAI_OBS_ENABLED=true pip install ai-obs-plugin# 将 sitecustomize.py 放入 PYTHONPATHpython app.py# Javajava -javaagent:ai-obs-plugin.jar -jar app.jar# Node.jsnode --require ai-obs-plugin/register app.js### 6.3 一行代码模式当需要自定义 service name、导出端点或采样率时，在应用入口添加一行初始化：
# Pythonimportai_obs_plugin; ai_obs_plugin.init(service_name="my-gateway", sample_rate=0.1)// Node.jsrequire('ai-obs-plugin').init({serviceName:'my-gateway',sampleRate:0.1});### 6.4 装饰器/注解模式对于自定义 Agent 编排逻辑，使用装饰器手动创建 Span：
# Python 装饰器fromai_obs_pluginimportobserve@observe(name="invoke_agent my-custom-agent", kind="INTERNAL")async defmy_custom_agent(query: str) -> str:async withobserve(name="execute_tool web_search"):results =awaitsearch(query)
response =awaitllm.generate(query, results)returnresponse
## 7. 插件接口规范为了让第三方开发者可以扩展新的拦截器，插件定义了一套标准的 SPI（Service Provider Interface）。
### 7.1 Interceptor 接口# Python SPI 接口定义fromabcimportABC, abstractmethodfromtypingimportAny, Optionalfromdataclassesimportdataclass@dataclassclassInterceptorContext:trace_id: str
span_id: str
parent_span_id: Optional[str]
service_name: str
config: dictclassAIInterceptor(ABC):"""AI 调用拦截器基类——所有语言共享此接口语义"""@property@abstractmethoddeftarget_module(self) -> str:"""目标模块/包名，如 'openai'、'anthropic'"""...@property@abstractmethoddeftarget_methods(self) -> list[str]:"""需要拦截的方法列表，如 ['chat.completions.create']"""...@abstractmethoddefpre_hook(self, ctx: InterceptorContext, args: dict) -> dict:"""方法调用前：返回 Span 元数据"""...@abstractmethoddefpost_hook(self, ctx: InterceptorContext, result: Any, span_meta: dict) -> None:"""方法调用后：填充 Span 属性"""...deferror_hook(self, ctx: InterceptorContext, error: Exception) -> None:"""异常处理：默认记录 error 状态"""passdefcontent_hook(self, ctx, prompt, completion) -> Optional[str]:"""内容捕获：返回内容引用 URL"""returnNone
### 7.2 拦截器注册与发现| **语言** | **发现机制** | **注册方式** |
| Python | importlib.metadata.entry_points(group='ai_obs.interceptors') | pyproject.toml中声明 entry point |
| Java | ServiceLoader.load(AIInterceptor.class) | META-INF/services/文件 |
| Node.js | require('ai-obs-plugin/interceptors/*') | package.json中声明导出 |
| Go | init()中调用registry.Register() | import _触发init() |
扩展性设计。第三方开发者只需实现AIInterceptor接口，在包描述文件中声明 entry point，插件框架即可自动发现并加载。整个过程无需修改插件核心代码。
## 8. 配置与动态开关### 8.1 完整配置项| **配置项** | **类型** | **默认值** | **说明** |
| ai_obs.enabled | bool | true | 总开关 |
| ai_obs.service_name | string | auto | 服务名称，自动从 OTEL_SERVICE_NAME 读取 |
| ai_obs.sample_rate | float | 1.0 | 采样率 0.0-1.0 |
| ai_obs.capture_content | bool | false | 是否捕获 prompt/completion 内容 |
| ai_obs.content_storage | string | s3://... | 内容存储路径 |
| ai_obs.enable_eval | bool | false | 是否启用 LLM-as-Judge 评估 |
| ai_obs.eval_sample_rate | float | 0.05 | 评估采样率（仅对已采样的 Span 生效） |
| ai_obs.interceptors | string[] | ["openai","anthropic","langchain"] | 启用的拦截器列表 |
| ai_obs.exporter.otlp.endpoint | string | http://localhost:4317 | OTLP gRPC 端点 |
| ai_obs.exporter.otlp.protocol | string | grpc | grpc 或 http |
| ai_obs.buffer.max_spans | int | 2048 | Span 缓冲区大小 |
| ai_obs.buffer.flush_interval_ms | int | 5000 | 缓冲区刷新间隔（毫秒） |
| ai_obs.buffer.max_export_timeout_ms | int | 30000 | 单次导出超时（毫秒） |
### 8.2 动态开关机制所有配置项均支持运行时热更新，无需重启应用。实现方式：
```
sequenceDiagram
 participant App as 应用进程
 participant CM as ConfigManager
 participant CC as 配置中心 (Consul/etcd)
 participant IE as InterceptorEngine
 participant EC as ExporterChain

 App->>CM: 启动时加载配置
 CM->>CC: Watch 配置变更
 Note over CM,CC: 长连接监听

 CC-->>CM: ai_obs.sample_rate: 0.1
 CM->>IE: 更新采样率
 IE->>IE: 热切换 Sampler 实例

 CC-->>CM: ai_obs.capture_content: true
 CM->>IE: 启用内容捕获钩子
 IE->>IE: 注册 content_hook

 CC-->>CM: ai_obs.enabled: false
 CM->>IE: 暂停拦截
 CM->>EC: 排空缓冲区后关闭
 IE->>IE: 卸载所有 Hook 点
```图 4：配置热更新时序——从配置中心到引擎的动态切换
## 9. 性能与安全### 9.1 性能设计< 1%
CPU 额外开销
< 5MB
内存增量
< 50μs
单次拦截延迟
实现性能目标的四个关键策略：
- 无锁环形缓冲区— Span 写入和导出使用 SPSC（Single Producer Single Consumer）无锁队列，避免锁竞争- 批量导出— Span 在缓冲区中聚合，每 5 秒或达到 2048 条时批量发送，减少网络往返- 零拷贝数据传递— 拦截器捕获的原始数据直接写入预分配的 Span 对象，避免中间序列化- 采样降载— 高负载时自动降低采样率：当缓冲区使用率超过 75% 时，采样率自动减半；超过 90% 时降至 10%### 9.2 安全设计| **安全维度** | **措施** |
| 敏感数据过滤 | 内置 PII 检测规则，自动脱敏 API Key、手机号、身份证号、邮箱。支持自定义正则规则 |
| 内容捕获授权 | 内容捕获默认关闭，需显式配置 + 审批流程才能开启。捕获的内容使用独立 IAM 控制访问 |
| 导出传输加密 | OTLP gRPC 强制使用 TLS 1.3，支持 mTLS 双向认证 |
| 配置安全 | 敏感配置项（如 API Key、存储凭证）从环境变量或 Secret Manager 读取，不写入配置文件 |
## 10. 实现路线图### 10.1 分阶段交付- 阶段一：Python 插件 MVP8 周
实现 PluginManager、InterceptorEngine、SpanBuilder、ExporterChain 核心模块。支持 OpenAI + Anthropic 自动拦截，OTLP gRPC 导出。零代码模式（sitecustomize.py）和一行代码模式。- 阶段二：生态扩展6 周
新增 LangChain、LlamaIndex、MCP 拦截器。支持内容捕获（S3 存储）。实现配置热更新和 LLM-as-Judge 评估引擎。自定义拦截器 SPI 和 SDK。- 阶段三：多语言支持10 周
Java Agent（字节码增强 + Spring Boot Starter）。Node.js（--require + Module 劫持）。Go（blank import + eBPF 初步支持）。跨语言 API 一致性验证。- 阶段四：生产级增强6 周
自适应采样、PII 自动脱敏、多租户隔离、大规模压测（10K QPS 验证）。性能基准测试和优化。与主流可观测性平台的集成认证。### 10.2 技术选型| **模块** | **Python** | **Java** | **Node.js** | **Go** |
| 拦截机制 | import hook + monkey-patch | ByteBuddy | Module._load 劫持 | eBPF / blank import |
| OTel SDK | opentelemetry-api | opentelemetry-api | @opentelemetry/api | go.opentelemetry.io/otel |
| 导出协议 | opentelemetry-exporter-otlp | opentelemetry-exporter-otlp | @opentelemetry/exporter-otlp | otel.exporters.otlp |
| 配置管理 | environs + watchfiles | MicroProfile Config | dotenv + chokidar | viper + fsnotify |
| 缓冲区 | collections.deque | Disruptor / ArrayBlockingQueue | ring-buffer-ts | channel (buffered) |
核心原则：不重新发明轮子。所有 Span 和 Metrics 的构建、导出、采样均复用 OpenTelemetry 官方 SDK。插件只做两件事——在正确的时机创建正确的 Span，以及把 Span 数据以正确的格式送到正确的地方。
## Sources- OpenTelemetry, "Zero-code Instrumentation" — 官方零代码插桩文档，涵盖 Java Agent、Python auto-instrumentation、Node.js --require 和 Go eBPF 等多种零代码方案。https://opentelemetry.io/docs/zero-code/- Traceloop, "OpenLLMetry — OpenTelemetry-native LLM Observability" — 基于 OTel 的 LLM 可观测性库，一行代码接入，支持 OpenAI、Anthropic、LangChain 等主流框架。https://www.traceloop.com/openllmetry- FutureAGI, "Best LLM Instrumentation Libraries in 2026: 5 Compared" — 对比了 OpenLLMetry、OpenInference、OpenLIT、traceAI、AgentTrace 五种 LLM 插桩库的插拔方式、覆盖框架和性能特征。https://futureagi.com/blog/best-llm-instrumentation-libraries-2026/- OpenTelemetry, "Java Agent Extensions" — Java Agent SPI 扩展机制，通过 AutoConfigurationCustomizerProvider 实现自定义拦截器注册。https://opentelemetry.io/docs/zero-code/java/agent/extensions/