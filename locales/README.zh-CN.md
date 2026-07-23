<p align="center">
  <img src="../assets/favicon.svg" alt="EZREVIEW logo" width="112">
</p>

<h1 align="center">EZREVIEW</h1>

<p align="center">
  配合 AIPilot 或独立使用，在浏览器中实时评审 AI 生成的 HTML 页面。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ezreview"><img src="https://img.shields.io/npm/v/ezreview" alt="npm version"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933" alt="Node.js 20 或更高版本">
</p>

<p align="center">
  <a href="../README.md">English</a> | <b>简体中文</b> | <a href="./README.ja.md">日本語</a> | <a href="./README.es.md">Español</a>
</p>

`ezreview` 是 AI 开发工作流插件 [AIPilot](https://github.com/JililiDD/aipilot) 的浏览器端评审助手，同时也支持与任意 AI Agent 配合使用。它允许你直接在 AI 生成的页面上留下具有上下文的内联批注，并将结构化反馈发送给 Agent，以便其精确定位并修改源文件中的问题。

它还可以作为任意本地 HTML 文件的独立命令行工具 (CLI)。评审服务器运行在本地机器上，绑定到 `127.0.0.1:4400`。

## 功能演示

https://github.com/user-attachments/assets/f0a7700b-70dd-41da-8b16-f2aa0bdc6f56

## 功能特性

- **精确定位问题**：点击渲染页面上的具体 DOM 元素或选中文本片段
- **提供结构化上下文**：每条批注均包含稳定 ID、CSS 选择器、相关 HTML 或带有上下文的选中文本
- **修改与答复一体化**：Agent 可以根据修改请求直接修改源码，或对提问进行答复
- **支持多轮讨论**：每条批注均支持多轮追问与答复
- **安全恢复机制**：队列中的批注反馈与 ID 在命令超时或服务器重启后依然保留
- **保护本地数据隐私**：评审服务器仅监听本地 `127.0.0.1`

## 安装 EZREVIEW

安装 [Node.js](https://nodejs.org/) 20 或更高版本，然后全局安装 `ezreview`：

```bash
npm install --global ezreview
```

确认安装是否成功：

```bash
ezreview --help
```

你也可以在无需全局安装的情况下直接运行特定版本：

```bash
npx -y ezreview@latest your_file.html
```

## 提示 Agent 运行独立评审循环

AIPilot 会自动为你管理持续评审循环。当你**不使用** AIPilot 独立运行 `ezreview` 时，请提示你的 Agent 保持会话处于活跃状态，并在每次处理完一批反馈后继续等待。

复制以下 Prompt，并将 `your_file.html` 替换为你需要评审的产物文件：

```text
使用 ezreview 打开 your_file.html。使用你管理的后台任务机制保持评审服务器运行，并使每次 ezreview wait 保持在前台阻塞挂起状态。持续等待提交的批注反馈。针对每一条批注，判断其属于修改请求还是问题提问。执行对应的源码修改或回答问题，通过 ezreview reply 针对每个批注 ID 进行回复，然后继续等待更多反馈。不要将命令超时、空输出、文件重载或已完成的反馈批次误认为是评审结束。在我点击 ezreview 中的 Approve 或在对话中明确确认评审完成之前，请勿退出循环。
```

## CLI 参考指南

### 打开评审会话

```bash
ezreview your_file.html
```

启动本地评审服务器，在浏览器中打开 HTML 产物，并在会话运行期间保持活跃。如果针对同一文件再次运行此命令，将直接返回已存在的会话 URL，而不会重复启动服务器。

### 等待反馈

```bash
ezreview wait your_file.html
```

阻塞等待直到评审者提交一批反馈（如果已有积压的批注反馈，则立即返回）。每一批次包含结构化的修改请求、提问或两者兼有。如果命令因超时中断，再次运行即可——持久化队列将返回下一个未消费的批次，不会重复处理。

### 回复批注

```bash
ezreview reply your_file.html --to a-1 "已更新标题字号。"
```

使用 `wait` 返回的 ID 向特定批注回复。对于修改请求，请在回复前先保存源文件；浏览器会自动重载产物并在对应的批注框中显示你的回复。

如需回复包含换行符（`\n`）的多行文本，请添加 `--decode-newlines` 选项：

```bash
ezreview reply your_file.html --to a-1 --decode-newlines "第一段内容\n\n第二段内容"
```

浏览器将保留真实的换行与段落间距。该转换默认关闭，以确保包含字面量 `\n` 的代码示例不受影响。

## Agent 评审循环规范

AI Agent 应当将 `ezreview wait` 作为标准的前台/阻塞命令运行，而不是使用 `&`、`nohup` 或 `disown` 将其推到后台。这能确保 Agent 阻塞等待直至收到反馈，并立即消费处理结果。

对于每一批反馈，Agent 应当执行以下步骤：

1. 读取 `ezreview wait` 返回的每条批注
2. 针对修改请求编辑源文件产物
3. 对纯提问进行解答（除非批注暗示需要修复，否则无需修改文件）
4. 针对每一个批注 ID 运行一次 `ezreview reply`
5. 重新启动一个前台挂起的 `ezreview wait`
6. 重复以上步骤，直至用户在页面中点击 **Approve** 或在聊天中确认结束

## 为什么搭配 AIPilot 使用 EZREVIEW

[AIPilot](https://github.com/JililiDD/aipilot) 通过结构化的 Markdown 文档驱动 AI 开发工作流。`ezreview` 提供了交互式的浏览器反馈循环，让你能够实时评审渲染后的 UI 预览与设计文档。

```text
AIPilot 创建文档或设计预览
                  ↓
EZREVIEW 在浏览器中打开预览
                  ↓
你在页面中圈选元素或选择精确文本并添加批注
                  ↓
Agent 收到结构化的反馈上下文
                  ↓
Agent 进行代码修改或答复，EZREVIEW 自动重载最新结果
```

你不再需要截图或在聊天框中手写描述布局位置。`ezreview` 将你的批注意见直接锚定在 AIPilot 生成的 HTML 预览页面中，为 Agent 提供精准的 DOM 元素和文本位置引用以供修改。

## 相关项目

- [AIPilot](https://github.com/JililiDD/aipilot)：使用 `ezreview` 进行浏览器端评审的文档驱动型 AI 开发工作流
- [lavish-axi](https://github.com/kunchenguid/lavish-axi)：启发了 `ezreview` 项目灵感的前身项目
