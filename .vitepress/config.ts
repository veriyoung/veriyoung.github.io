import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'AI Agent 可观测与安全',
  description: 'AI Agent 可观测性、安全防护、测试量化 — 技术文档与开源工具汇总',
  lang: 'zh-CN',
  base: '/',
  lastUpdated: true,
  head: [
    ['meta', { name: 'keywords', content: 'AI Agent,LLM 可观测性,OpenTelemetry,Langfuse,Phoenix,AI 安全,红队测试,大模型评估,AI 测试' }],
    ['meta', { name: 'author', content: 'veriyoung' }],
    ['meta', { property: 'og:title', content: 'AI Agent 可观测与安全' }],
    ['meta', { property: 'og:description', content: 'AI Agent 可观测性、安全防护、测试量化 — 技术文档与开源工具汇总' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:url', content: 'https://veriyoung.github.io' }],
  ],
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '设计文档', link: '/guide/ai-call-chain-observability' },
      { text: '研究报告', link: '/research/llm-observability-oss-2026' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'AI Agent 可观测性设计',
          items: [
            { text: 'AI 调用链路可观测性设计文档', link: '/guide/ai-call-chain-observability' },
            { text: 'AI 可拔插可观测性插件设计方案', link: '/guide/ai-pluggable-observability-plugin' },
            { text: 'AI 网关层可观测性接入技术方案', link: '/guide/ai-gateway-observability-plugin' },
            { text: 'AI 可观测性与安全一体化插件设计方案', link: '/guide/ai-observability-security-plugin' },
          ]
        },
        {
          text: '补充分析',
          items: [
            { text: 'SentinelOne 工具补充分析', link: '/guide/sentinelone-gap-analysis' },
          ]
        }
      ],
      '/redteam/': [
        {
          text: 'AI 安全测试',
          items: [
            { text: 'AI Red Team 工具介绍', link: '/redteam/ai-redteam' },
            { text: 'RedTeam 红队测试报告', link: '/redteam/redteam-report' },
            { text: 'RedTeam 越狱测试报告', link: '/redteam/redteam-pn-jailbreak' },
          ]
        }
      ],
      '/research/': [
        {
          text: '行业研究',
          items: [
            { text: '2026年 LLM 可观测性开源工具汇总', link: '/research/llm-observability-oss-2026' },
            { text: 'AI Agent 测试可量化方案分析', link: '/research/ai-agent-quantification' },
          ]
        }
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/veriyoung' }
    ],
    search: {
      provider: 'local'
    },
    footer: {
      message: '基于 VitePress 构建',
      copyright: 'Copyright © 2026 veriyoung'
    }
  }
})