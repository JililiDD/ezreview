# Handoff：本地 HTML Artifact 人机协作评审工具

> 本文档是一份完整的项目交接说明，供 AI 助手直接据此开工。所有架构决策已由项目所有者（Jili）确认，不需要重新论证；如遇文档未覆盖的决策点，先询问再实现。

## 1. 项目背景与目标

构建一个类似 [lavish-axi](https://github.com/kunchenguid/lavish-axi)（MIT 许可）的 local-first CLI 工具，解决的问题：**agent 擅长生成 HTML artifact，但人对 artifact 的反馈回路很差**。

核心闭环：

```
Agent 写出 HTML 文件
  → CLI 启动本地服务器、打开浏览器展示
  → 人在页面上做批注（点选元素 / 划词），批量提交
  → agent 侧的 wait 命令解除阻塞，反馈以结构化文本输出到 stdout
  → agent 用 Edit 定点修改 HTML 文件
  → 服务器检测到文件变化，SSE 推送 reload，浏览器刷新 iframe
  → 循环
```

## 2. 已确认的关键决策

| 决策点 | 结论 |
|---|---|
| 仓库 | **全新独立 repo**（不放进任何现有项目）。作为 npm 包发布，可 `npx` 运行 |
| 技术栈 | Node.js + TypeScript + pnpm，尽量零/少运行时依赖，Node 原生 test runner |
| 与 lavish 的关系 | **重写架构，外科手术式搬运成熟模块**。lavish 是 MIT——可逐文件复制其批注层代码（如 CSS selector 生成器），文件头保留版权声明。不 fork |
| 会话标识 | **文件路径即会话 ID**，无 opaque ID。会话状态存 `~/.<tool-name>/` 下按文件路径哈希的目录 |
| 实时通信 | **单一 SSE 端点 `/events`**，用 `event:` 字段区分事件类型，服务器无差别广播、客户端各自过滤 |
| 反馈语义 | **即发即弃（fire-and-forget）**：批注提交后即消费，不做跨刷新持久化、不做锚点恢复 |
| agent 接口 | 纯 shell 命令，零协议依赖：`<tool> <file.html>`（打开）+ `<tool> wait <file>`（阻塞等反馈） |
| agent 集成方式 | repo 内自带 `skills/` 目录，放一份 markdown 教 agent 使用流程（Claude Code / Codex 等 host 通用） |

## 3. 架构

```
┌─────────────┐   POST /feedback    ┌──────────────────┐
│ 浏览器外壳页 │ ──────────────────→ │  本地 HTTP 服务器 │
│ (iframe 包裹 │ ←────────────────── │                  │
│  artifact)  │   SSE: reload 事件   │  - 静态服务 HTML  │
└─────────────┘                     │  - fs 监听文件    │
                                    │  - 会话目录读写   │
┌─────────────┐   SSE: feedback事件  │                  │
│ wait 命令   │ ←────────────────── └──────────────────┘
│ (agent 运行)│
└─────────────┘
```

### 3.1 SSE 事件设计

- 端点：`GET /events`（可选 `?file=` 参数，多会话时过滤；MVP 单会话可忽略）
- 事件类型：
  - `reload`：artifact 文件变化时推给浏览器。浏览器只刷新 iframe 的 `src`（加 `?t=时间戳` 破缓存），**不刷新外壳页**（保留工具栏状态）
  - `feedback`：收到批注提交时推给 `wait` 命令
- 服务器不识别客户端身份，广播所有事件，客户端按 `event:` 名过滤

### 3.2 文件监听（reload 通道）

- `fs.watch` 或 500ms 轮询 mtime 均可
- **必须去抖 200–300ms**：agent 写文件非原子，不去抖会刷出半个文件

### 3.3 反馈落盘（feedback 通道）

- **catch-up then subscribe** 模式：批注先写入会话目录的 JSON 队列文件，再推 SSE
- `wait` 命令启动时先读文件补漏（防止服务器/CLI 错过事件），再订阅增量
- `wait` 收到反馈后：将批注渲染为结构化文本打印到 stdout，然后退出（exit 0）

## 4. 批注交互（浏览器端，工作量最大的部分）

两种批注姿势，**MVP 都要**：

### 4.1 元素批注（点选）

- 工具栏切换"选元素"模式 → 铺一层透明 overlay 拦截所有点击（避免和页面自身交互冲突）→ hover 高亮、点击选中 → 弹评论框
- 高亮：**绝对定位的框盖上去，不修改目标元素样式**（不污染 artifact）；`getBoundingClientRect` + scroll/resize 跟随；注意 iframe 内外坐标换算
- Selector 生成：有 id 用 id，否则沿父链拼 `nth-of-type`。**优先移植 lavish-axi 的实现**（处理过 SVG、shadow DOM、重复 class 等边界）

### 4.2 划词批注（选中文字）

- **不用 overlay、不用模式切换**：直接监听 iframe 文档的 `mouseup`，有选区时在旁边浮出"添加评论"按钮（Medium / Google Docs 式交互）
- 高亮渲染：`range.getClientRects()` 逐矩形画框；或用 CSS Custom Highlight API（`CSS.highlights`，仅现代浏览器，不动 DOM，更干净）
- **不需要 Range 序列化 / XPath / 字符偏移**——即发即弃语义下无锚点恢复需求

### 4.3 批量提交

- 批注进入队列（侧边栏可见、可删除），用户点"发送"才一次性提交全部
- 目的：减少 agent 迭代轮次（每轮有固定 token 开销）

## 5. 反馈数据格式（为 agent 的 Edit 操作优化——这是本工具的核心差异化）

设计原则：**反馈越精确，agent 越能用 Edit 定点修改而非全文重写 HTML，输出 token 成本差 20–30 倍**。

元素批注：

```json
{
  "type": "element-annotation",
  "selector": "#chart > .legend > span:nth-of-type(2)",
  "outerHTML": "<span class=\"label\">…截断到 ~500 字符…</span>",
  "comment": "颜色太浅了"
}
```

划词批注：

```json
{
  "type": "text-annotation",
  "selectedText": "被选中的文字",
  "context": { "before": "前50字符", "after": "后50字符" },
  "nearestSelector": "选区共同祖先元素的 selector",
  "comment": "这段说明不准确"
}
```

- `outerHTML` 片段让 agent 常可直接构造 Edit 的 old_string，免于重读文件
- 划词的定位策略是"为 grep 优化"：精确匹配 selectedText → context 消歧 → nearestSelector 兜底
- `wait` 输出到 stdout 时渲染为可读文本，例如：
  `用户选中了 #chart > .legend（<span class="label">…</span>），评论：颜色太浅了`

## 6. Agent 侧 HTML 书写规范（写进 skills/ 文档）

skill 文档除了教 agent 用命令，还要规定 artifact 写法（保证 Edit 可用）：

1. 多行格式化，禁止压成单行（否则 Edit 字符串匹配无法定位）
2. 数据与标记分离：数据放 `<script type="application/json">` 块，改数据不碰标记
3. 不内联 base64 大资源
4. 修改时优先用 Edit 定点替换，禁止无必要的全文重写

## 7. MVP 范围（明确砍掉的）

**做**：CLI、本地服务器、SSE 双事件、live-reload、元素批注、划词批注、批量提交、`wait` 命令、skills 文档。

**不做**（v2 再说）：

- Mermaid/Excalidraw 嵌入编辑
- Layout 自动审计
- 云端分享/导出
- 批注跨刷新持久化 / 锚点恢复
- 跨 iframe 选区、SVG/canvas 内文字选区（选区中途页面刷新 → 提示用户重选）
- 多会话并发（架构上留 `?file=` 参数即可，实现推后）

## 8. 实施顺序与估算

| 阶段 | 内容 | 估算 |
|---|---|---|
| 1 | CLI + 静态服务器 + 外壳页(iframe) + 会话目录 | 1–2 天 |
| 2 | SSE `/events` + fs 监听 + live-reload（含去抖） | 1 天 |
| 3 | 元素批注（overlay、高亮、selector 生成——移植 lavish） | 3–4 天 |
| 4 | 划词批注（mouseup + 浮动按钮 + 选区序列化） | 2–4 天 |
| 5 | 批注队列 + 提交 + `wait` 命令 + stdout 渲染 | 1–2 天 |
| 6 | skills/ 文档 + 端到端自测（真实 agent 走完闭环） | 1–2 天 |

每阶段完成后应可独立验证（阶段 2 结束就能演示"改文件→浏览器自动刷新"）。

## 9. 参考资料

- lavish-axi 源码（架构参考 + 可搬运模块）：https://github.com/kunchenguid/lavish-axi （MIT，搬运时保留版权声明）
- 其 skill 用法可参考 `skills/lavish` 目录
- CSS Custom Highlight API：https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API

## 10. 开工前需要向所有者确认的事项

1. 工具/包命名（本文档用 `<tool>` 占位）
2. 目标浏览器范围（是否只支持现代 Chromium/Firefox/Safari——影响是否可用 CSS Custom Highlight API）
3. `wait` 命令收到反馈后是退出（当前设计）还是长驻循环输出
