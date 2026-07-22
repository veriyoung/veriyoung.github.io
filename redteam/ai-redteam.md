---
title: AI Red Team 安全测试工具
---

# AI Red Team

> LLM Security Scanner & AI Red Teaming Toolkit — 大语言模型对抗性安全测试工具

`ai-redteam` 是一款面向 AI 应用的自动化安全测试 CLI 工具，内置 94 条 OWASP LLM Top 10 攻击探测，支持 CI/CD 集成与合规审计报告。

[GitHub 仓库](https://github.com/veriyoung/ai-redteam)

## 快速开始

```bash
git clone https://github.com/veriyoung/ai-redteam.git
cd ai-redteam
pip install -e .
ai-redteam --mock
```

## 核心能力

### 94 条内置攻击探测

覆盖 OWASP LLM Top 10 全部风险类别：

| 测试方向 | 探测数 | 覆盖场景 |
|----------|--------|----------|
| Prompt 注入 | 35 | 指令覆盖 / 编码绕过 / 多语言 / 分块投递 / Token 走私 / Unicode / 分隔数据 |
| 越狱攻击 | 10 | 人设覆盖 / Many-shot / 编码链 / 思维树 / 上下文切换 |
| PII 泄露 | 8 | 身份证 / 手机号 / 邮箱 / 信用卡 / 健康数据 / 地理位置 |
| 敏感信息泄露 | 7 | API 密钥 / 数据库凭证 / 源代码 / 内部文档 / 商业机密 |
| 有害内容生成 | 9 | 暴力 / 钓鱼 / 仇恨言论 / 自残 / CSAM / 虚假信息 / 毒品 / 黑客 |
| Agent 越权 | 6 | 命令执行 / 数据外泄 / 网络外连 / 数据库越权 / 配置投毒 |
| Agent 供应链 | 12 | MCP 投毒 / 记忆污染 / 邮件注入 / Agent 通信劫持 |

### 多模型支持

支持 OpenAI / Anthropic / DeepSeek / Qwen / 通义千问 / Ollama 本地模型，任何兼容 OpenAI API 的模型均可接入。

```bash
# OpenAI
ai-redteam --provider openai --model gpt-4o-mini --api-key sk-xxx

# DeepSeek
ai-redteam --provider openai --model deepseek-chat \
  --base-url https://api.deepseek.com/v1 --api-key sk-xxx

# Anthropic Claude
ai-redteam --provider anthropic --model claude-3-haiku-20240307 --api-key sk-xxx
```

### 对抗样本变异引擎

9 种变异算子自动生成对抗性输入，模拟真实攻击场景的多样性：

编码混淆 | 任务包装 | 角色注入 | Token 走私 | Unicode 同形字 | 多轮对话 | 分块投递 | 交叉变异 | 改写变异

### 合规审计

内置 NIST AI RMF 1.0 与 EU AI Act 控制点映射，一键生成合规审计报告：

```bash
ai-redteam --mock --formats json html compliance
```

### CI/CD 集成

输出 JUnit XML 报告，可作为安全门禁嵌入 GitHub Actions / GitLab CI / Jenkins 流水线：

```yaml
- run: |
    ai-redteam --provider openai --model $MODEL \
      --threshold 0.85 --formats junit compliance
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### 持久化与趋势分析

SQLite 存储历史测试结果，支持安全评分趋势分析和版本间 diff 对比：

```bash
ai-redteam history --limit 10
ai-redteam trend --days 30
ai-redteam diff <run-a> <run-b>
```

## 报告输出

| 格式 | 文件 | 用途 |
|------|------|------|
| JSON | `redteam-report.json` | 程序化处理、API 集成 |
| HTML | `redteam-report.html` | 人工审阅、团队分享 |
| JUnit XML | `redteam-report.junit.xml` | CI/CD 安全门禁展示 |
| Compliance | `redteam-compliance.json` | NIST AI RMF / EU AI Act 合规审计 |

## 项目结构

```
ai-redteam/
├── src/ai_redteam/
│   ├── __main__.py              # CLI 入口
│   ├── storage.py               # SQLite 持久化
│   ├── models/                   # 数据模型与多模型适配器
│   ├── probes/                   # 94 条内置 YAML 探测定制
│   │   └── presets/              # 6 大预设组
│   ├── mutators/                 # 9 种变异算子
│   ├── runners/                  # 测试运行器 / 裁判引擎 / PII 检测器
│   └── reporters/                # 报告引擎 / 合规映射
├── tests/                        # 216 条测试
└── pyproject.toml
```

## License

MIT License
