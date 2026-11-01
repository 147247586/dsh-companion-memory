# Companion Memory

> **会忘记、会想起、会随着关系变重的本地长期记忆。**

[![test](https://github.com/147247586/dsh-companion-memory/actions/workflows/test.yml/badge.svg)](https://github.com/147247586/dsh-companion-memory/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.1.1-blue.svg)](https://github.com/147247586/dsh-companion-memory/releases)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe)

[English](#english) | 简体中文

Companion Memory 是给 **DeepSeek Harness / WeChatAgent** 用的本地长期记忆插件。

它不把聊天记录无脑塞进向量库，而是模拟一个人怎么记、怎么忘、什么时候会突然想起来：

- 事实、偏好、事件、约定、教训分开记；
- 重要的记重一点，旧的会慢慢淡、归档；
- 每轮只注入少量相关记忆，不挤爆上下文；
- 会主动把当天值得留下的聊天沉淀成长期记忆；
- 记忆可删除、可恢复；
- 附带轻量 PAD 心情与时间段状态；
- **数据只在本机，不上传**。

## 为什么做这个

普通记忆插件大多只解决“怎么把过去找回来”。  
但长期陪伴真正难的是：

1. **什么值得记**——不是每句话都值得进档案；
2. **什么时候该忘**——全部保留会让模型被旧信息淹没；
3. **什么时候该想起**——不是等用户问“还记得吗”；
4. **怎么不把上下文撑爆**——记忆越多，注入越要克制。

Companion Memory 把这四件事放在一条链路里。

## 和普通记忆插件的区别

| 能力 | 普通记忆插件 | Companion Memory |
|---|---|---|
| 存事实/偏好 | ✅ | ✅ |
| 关键词/向量检索 | 多数只有一种 | 词法 + 时间/权重评分，无需外部向量服务 |
| 写入后处理 | 多为追加 | 合并、去重、重要度更新 |
| 遗忘 | 手动删或全保留 | 时间衰减 + 超出上限归档 |
| 每轮注入 | 有就塞 | 预算 900 字，按相关度和权重挑选 |
| 心情/时间状态 | 少见 | 轻量 PAD + 时间段，可关闭 |
| 删除/恢复 | 多数只能删 | 软删除、可恢复 |
| 自动沉淀 | 有的有 | 回复后入队，每日模型提炼 |
| 数据位置 | 云端/本地都有 | 宿主本地文档存储，零上传 |
| 隐私 | 取决于服务 | 默认不联网，只有沉淀时用当前模型 |

它不是“另一个 RAG 记忆库”，而是：

> **为长期陪伴设计的记忆生命周期。**

## 特性

### 1. 记忆分层

支持：

- `fact` 事实
- `preference` 偏好
- `event` 事件
- `promise` 约定
- `lesson` 教训
- `feeling` 感受

每条记忆带标签、重要度、情绪权重、最近访问时间和状态。

### 2. 会衰减，不是只增不减

- 时间越久，权重越低；
- 超出 `maxMemories` 后，最旧的转为 `archived`；
- 归档不是删除，仍保留在本地；
- 重要记忆可通过 `remember` 再次加强。

### 3. 有预算的召回

每轮只注入最多 `recallMaxChars`（默认 900）字符：

- 先按相关度、重要度、时间衰减排序；
- 只取最相关的几条；
- 不把整个记忆库塞进上下文；
- 闲聊不会强行回忆。

### 4. 自动沉淀

- 每轮回复后，把“对方说了什么 + 你回了什么”放进待整理队列；
- 每天 23:50（可配置）调用一次宿主模型；
- 只保留有长期价值的内容；
- 寒暄、临时状态、无法确认的猜测不记；
- 沉淀失败不会影响聊天，队列会保留。

### 5. 心情与时间感

- 轻量 PAD：愉悦 / 唤醒 / 掌控；
- 6 小时半衰期，逐渐回到基线；
- 按时间段体现精力（清晨、深夜等）；
- 只作参考，不会每轮播报“我现在心情如何”；
- 设置里可以一键关闭。

### 6. 删除与恢复

- `forget-memory` 软删除；
- `restore-memory` 恢复；
- 不会物理抹掉原始记忆；
- 对“忘掉这个”类请求更安全。

## 安装

```bash
dsh plugin --profile desktop add github:147247586/dsh-companion-memory
```

启用时授予以下权限：

| 权限 | 用途 |
|---|---|
| `storage` | 保存待整理队列和心情状态 |
| `documents` | 保存长期记忆 |
| `history_read` | 读取当天聊天用于沉淀 |
| `model_generate` | 每日沉淀时提炼记忆 |
| `schedule` | 每日定时任务 |

如果只想手动记忆、不想自动沉淀，可以关闭“自动沉淀”，只保留动作和召回。

## 用法

大部分时候不需要记命令，正常聊天即可：

- “记住我喜欢海边，讨厌吵闹。”
- “以后提到生日就想起 5 月 1 日。”
- “忘掉刚才那句话。”
- “你还记得我上次说的船上照片吗？”

模型也可以直接调用这些动作：

| 动作 | 用途 |
|---|---|
| `remember` | 写入一条长期记忆 |
| `search-memory` | 检索当前聊天的记忆 |
| `forget-memory` | 软删除一条记忆 |
| `restore-memory` | 恢复软删除/归档的记忆 |
| `list-memories` | 列出当前聊天的记忆 |
| `consolidate-memory` | 立即提炼待整理队列 |

## 工作方式

```text
用户消息
   │
   ▼
before-context
   ├─ 读取长期记忆
   ├─ 词法 + 时间/权重排序
   ├─ 注入 ≤ 900 字
   └─ 附带轻量心情/时间状态
   │
   ▼
模型回复
   │
   ▼
after-response
   ├─ 更新心情
   └─ 把本轮内容放入待整理队列
   │
   ▼
每天 23:50
   └─ 模型提炼 → 写入长期记忆
```

## 设置

| 设置 | 默认 | 说明 |
|---|---|---|
| `recallMaxChars` | 900 | 每轮记忆注入上限，建议 600–1200 |
| `maxMemories` | 400 | 最多保留条数，超出后归档最旧 |
| `consolidateAt` | 23:50 | 每日沉淀时间 |
| `autoConsolidate` | 开 | 是否自动沉淀 |
| `enableMood` | 开 | 是否启用心情/时间状态 |

## 隐私

- 记忆保存在 DSH 宿主本地文档存储；
- 插件本身不上传聊天内容；
- 只有开启自动沉淀时，会调用宿主当前模型；
- 不包含任何示例聊天、人格、账号、密钥或媒体；
- 软删除不会立即物理抹除，便于恢复。

## 兼容性

- DSH 插件 API：`apiVersion: 2`
- 宿主：`wechatagent`
- 需要能力：`actions-v1`、`documents-v1`、`model-utility-v1`、`daily-schedule-v1`
- Node.js：22+

## 限制

- 当前是**轻量词法召回**，没有向量和图关系；
- 标准插件 API 不提供图片读取，所以本仓库不含图片记忆；
- 不负责主动发微信消息；
- 本仓库不含语音发送/唱歌/入站语音；
- 自动沉淀依赖宿主模型，会产生额外 token；
- 0.x 版本接口可能调整。

## 配套：微信陪伴层

本仓库是通用记忆内核。完整的微信能力在**私有微信陪伴层**里，需要 WeChatAgent / Bridge / Hook，不能只靠标准 DSH 插件 API：

| 能力 | 微信陪伴层状态 |
|---|---|
| 图片记忆 | 已实现，Reader + 本地视觉模型 |
| 主动回忆/主动发言 | 已实现，Bridge proactive engine |
| 语音发送/唱歌 | 已实现，本机音色 worker |
| 入站语音 | 已实现，Reader + speech-recognition + 本地 SenseVoice |

入站语音链路：

```text
微信语音
  → Reader 读取本地消息库
  → speech-recognition 插件
  → 本地 ASR
  → 转写文字
  → 原模型回复
```

这部分**不公开**，原因：

- 需要登录 Bridge、微信账号和本机 token；
- 涉及私人音色参考；
- 依赖 WeChatAgent Hook 和本机路径；
- 不适合作为通用一键安装插件。

所以 GitHub 上的 `dsh-companion-memory` 仍然是“可公开分享的记忆内核”；完整鱼鱼只在私有陪伴层。

## 开发

```bash
npm test
```

测试覆盖：

- 写入与召回；
- 软删除与恢复；
- 回复后入队与每日沉淀；
- 心情状态注入与更新。

## Roadmap

- [ ] 可选本地向量召回（Ollama bge-m3）
- [ ] 日结/周结摘要
- [ ] 记忆导出/导入
- [ ] 实体/关系图
- [ ] 更细的 PAD 情绪更新
- [ ] 与微信陪伴层分离的可选扩展

## English

Companion Memory is a local-first long-term memory plugin for DeepSeek Harness / WeChatAgent.

It models memory as a lifecycle, not a dump:

- facts, preferences, events, promises, lessons and feelings;
- importance, emotional weight and time decay;
- budgeted recall instead of dumping everything into context;
- daily consolidation of valuable conversations;
- soft delete and restore;
- lightweight PAD mood and time-of-day state;
- local-only storage, no uploads.

Install:

```bash
dsh plugin --profile desktop add github:147247586/dsh-companion-memory
```

## License

MIT
