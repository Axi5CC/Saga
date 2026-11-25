# Saga

Saga 是一个本地写作工具：按模板新建一本书稿，安静地写，写完导出成成品。

它不是电子书阅读器。Saga 打开和创建的是**书稿文件夹**，不是 EPUB、PDF、TXT 等成品电子书。

![Saga 首页](docs/home.png?v=2)

## 特点

- **书就是文件夹**：`book.json` 记录书名、作者、章节顺序和出版信息，`chapters/` 里每一章是一个 HTML 文件，`comments.json` 存批注。没有数据库，备份、同步和版本管理都很简单。
- **按模板开始**：新建时自动生成版权、献辞、题词、目录、卷首语、前言、序章、三部分正文、尾声、番外、后记、致谢、关于作者；没有内容的页可以留空。
- **专注写作**：左侧目录、中间纸张，改动自动保存；支持章节搜索、正文查找替换、缩放、深浅两套主题。
- **八种正文字体**：宋体、黑体、楷体、仿宋、小薇、毛笔、得意黑、系统默认。PDF / KDP / EPUB 会内嵌字体，其他导出格式记录字体名。
- **章节管理**：章节之间用加号插入新页；右键可以上移、下移、删除。删除的文字会进入 `darlings/`，随时可以找回。
- **书籍信息**：书名、副标题、作者、系列、语言、ISBN、出版社、版权、简介和关键词都写在 `book.json`，EPUB、EPUB 无障碍信息、投稿稿和 KDP 封面共用；语言同时决定导出时的章节标题（中文或 English）。可以选择一张封面图片，EPUB 会把它作为正式封面写入。
- **批注**：选中正文文字添加批注，右侧出现标记；批注存在 `comments.json`，不会写进章节 HTML。可以定位、标记已解决、删除，也可以导出成 Markdown 给编辑。
- **导出成品**：TXT、Markdown、HTML、EPUB、DOCX、ODT、RTF、LaTeX、PDF、标准投稿稿（DOCX/PDF），以及 KDP 纸质书的内页 PDF + 封面。PDF 可选 A4 / Letter / A5 / 6×9、字号和行距。
- **EPUB 3 与出版**：EPUB 带语言、ISBN、系列、简介、关键词、封面图、landmarks 和 `schema:accessibility*` 无障碍元数据；导出后会提示缺失的 alt 文本。
- **KDP 封面与内页**：内页用 Paged.js 真实分页，带页码、页眉、章首右页和空白左页，书脊按最终 PDF 页数计算；封面按书名、副标题、系列、作者和简介排版，自动计算书脊、出血和条码安全区，可选裁切线。
- **示例书**：随应用附带《小城畸人》（舍伍德·安德森，公版作品），打开就能看到一份完整书稿的样子。
- **帮助与自动更新**：顶栏「帮助」显示当前版本、GitHub 仓库地址和反馈邮箱；启动后自动检查新版本，发现新版会弹窗提示，确认后下载、校验 SHA256 并安装。
- **AI 接入**：安装版自带命令行和 MCP 服务，可让 Claude Desktop、Cursor、Trae 等读写书稿；MCP 可以读取和添加批注、标记批注已解决。

![写作界面](docs/editor.png?v=2)

## 书稿文件夹

```
小城畸人/
  book.json       书名、作者、章节顺序、章节类型、出版信息、封面图片名
  chapters/       每章一个 .html 文件
  comments.json   批注（不会写进正文）
  cover-<ts>.jpg  可选的封面图片（写入 EPUB）
  darlings/       删除或 AI 改写前的原文备份（可选）
```

Saga 只认识这样的文件夹。EPUB、PDF、TXT 是导出后的成品，不是导入格式。

## 下载

安装包（`Saga-Setup-*.exe`）和便携版（`Saga-Portable-*.exe`）放在本仓库的 **Releases** 页面，当前版本 **1.4.1**。

自动更新从 GitHub 下载。国内网络如果检查或下载很慢、失败，请先打开代理再重试。

Saga 正在申请 [SignPath Foundation](https://signpath.org/) 的免费开源代码签名。通过后，发布包由 SignPath Foundation 提供 Windows 代码签名。

## 代码签名

Saga 正在申请 [SignPath Foundation](https://signpath.org/) 的免费开源代码签名。通过后，发布包由 SignPath Foundation 签名，Windows 不再提示“未知发布者”。

在审核通过前，或者自己从源码打包时，需要一份 Windows 代码签名证书。打包前设置：

- `CSC_LINK`：`.pfx` 文件路径（也可以是 base64 或链接）
- `CSC_KEY_PASSWORD`：证书密码

electron-builder 会同时签名 `Saga.exe` 和 `Saga-Setup-*.exe`。证书需包含 Code Signing EKU。没有证书时仍可打包，但 Windows SmartScreen 会提示“未知发布者”。

便携版可以直接运行，但 AI 接入（CLI / MCP）需要安装版，因为便携版每次从临时目录启动。

## 从源码运行

需要 Node.js 20 或更新版本。

```bash
npm install
npm start
```

## 构建 Windows 安装包

需要 Node.js 22.12 或更新版本（`@electron/fuses` 的要求）。

```bash
npm install
npm run dist:win
```

产物在 `build/app/dist/`：`Saga-Setup-<版本>.exe` 和 `Saga-Portable-<版本>.exe`。构建脚本会把运行所需的文件复制到 `build/app/`，混淆 JavaScript，再由 electron-builder 打包；源码目录不会被改动。

GitHub Actions 工作流 `.github/workflows/windows-build.yml` 在 `windows-latest` 上执行同样的构建，并把安装包上传为 artifact。配置 SignPath 的 secrets 和 variables 后，同一个工作流会把安装包提交给 SignPath Foundation 签名。

## 使用

1. 点「新建书籍…」，选一个文件夹；或者打开已有的 Saga 书稿文件夹。
2. 左边点一章，直接在中间的纸上写。改动会自动保存，不需要按保存。
3. 选中正文文字可以添加批注；顶栏「书籍」填写书名、作者、系列、ISBN 和简介。
4. 写完点顶栏「导出」，选择格式。要投给出版社或编辑时选「投稿稿」。

常用快捷键：

- `Ctrl/⌘ + S`：立即把当前修改写回磁盘
- `Ctrl/⌘ + O`：打开书稿文件夹
- `Ctrl/⌘ + F`：在正文里查找替换（当前章或全书）
- `Ctrl/⌘ + Shift + F`：搜索章节标题

## CLI 与 MCP

安装版在「AI」弹窗里会按当前电脑的安装位置生成配置，直接复制即可，不需要手改：

- **MCP**：`command` 是 `Saga.exe`，`args` 指向安装目录下的 `resources/ai/mcp-server.js`，并设置 `ELECTRON_RUN_AS_NODE=1`。
- **CLI**：使用 `resources/ai/saga.cmd`。

常用命令：

```bat
saga.cmd books
saga.cmd info "<书文件夹>"
saga.cmd read "<书文件夹>" 1
saga.cmd write "<书文件夹>" 1 --text draft.txt
saga.cmd export "<书文件夹>" --format epub --out "<输出.epub>"
saga.cmd export "<书文件夹>" --format manuscript --out "<投稿稿.docx>"
saga.cmd export "<书文件夹>" --format manuscript-pdf --out "<投稿稿.pdf>"
```

运行 `saga.cmd help` 可以看到全部命令。书写入前会备份到 `darlings/`；如果这本书正在窗口里打开，写入会被拒绝——先点「← 首页」再让 AI 写。

## 项目结构

| 文件 | 作用 |
|---|---|
| `main.js` | 窗口、菜单、所有磁盘操作、导入、导出、无窗口打印 |
| `preload.js` | 渲染层唯一的 API：`window.saga` |
| `index.html` | 首页与编辑器两个视图 |
| `app.js` | 整个界面：写作、章节、目录、设置、导出、引导 |
| `styles.css` | 全部样式与主题变量 |
| `fonts/` | 七套开源中文字体（各自许可见子目录） |
| `example/` | 随应用附带的示例书稿 |
| `ai/` | 书稿读写核心、CLI、MCP 服务与导出构建器 |
| `ai/manuscript.js` | 标准投稿稿：标题页、页眉、DOCX 与 PDF 的排版模型 |
| `print/` | 投稿稿 PDF 用的 Paged.js（MIT，许可见 `LICENSE-pagedjs.txt`） |

## 隐私

Saga 是本地优先的写作工具：书稿、书名、批注和设置都保存在你自己的文件夹里，不上传到任何服务器。

- 没有账号、云同步、遥测或使用统计，也不包含广告或分析 SDK。
- 只有检查更新时，Saga 会请求 `https://api.github.com/repos/Axi5CC/Saga/releases/latest`；下载更新时访问 GitHub 的发布文件地址。请求只包含当前版本，不包含书稿内容。
- 「帮助」里的 GitHub 链接和反馈邮箱由系统浏览器或邮件客户端打开。
- CLI 和 MCP 在本机运行，只读写你指定的书稿文件夹；Saga 本身不向 AI 服务发送数据。
- 打开书稿、导入失败等本地记录写在系统的应用数据目录（`saga.log`），不会上传。

## 字体许可

字体来自各自的开源项目：Noto Serif SC、Noto Sans SC、霞鹜文楷、朱雀仿宋、站酷小薇、马善政毛笔、得意黑。许可见 `fonts/<字体名>/LICENSE`，随应用一起分发。

## 许可

代码以 [MIT](LICENSE) 许可发布。
