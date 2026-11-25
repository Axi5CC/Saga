# SignPath Foundation 申请与接入

本文是 Saga 申请 SignPath Foundation 免费 Windows 代码签名的准备材料。申请入口：
https://signpath.org/apply

## 一、当前资格核对

| 条件 | Saga 现状 |
|---|---|
| OSI 开源许可 | MIT，符合 |
| 公开源码仓库 | https://github.com/Axi5CC/Saga，符合 |
| 无商业双许可 | 符合 |
| 无专有组件 | 字体、Paged.js、Electron 均为开源许可；示例书为公版作品 |
| 构建系统 | GitHub Actions（`.github/workflows/windows-build.yml`），GitHub 托管 runner |
| 下载页提及 SignPath | README「下载」已说明正在申请 SignPath Foundation |
| 项目声誉 | 截至 2026-11-25：1 star、0 fork、Release 下载约 24 次；项目创建于 2026-11-24 |
| 隐私 | 本地优先，不上传书稿；只有更新检查会访问 GitHub API |

**注意：** 项目很新，声誉指标偏弱。SignPath Foundation 会审核项目是否被真实使用；如果被拒，通常需要积累更多下载、star、外部评价后再申请，或者改走 OV 代码签名证书。

## 二、申请表可直接使用的字段

**Project Name**

```text
Saga
```

如果担心 “Saga” 重名太多、Google 搜不到这个项目，可以填 `Saga (Axi5CC)`。

**Repository URL**

```text
https://github.com/Axi5CC/Saga
```

**Homepage URL**

```text
https://github.com/Axi5CC/Saga
```

**Download URL**

```text
https://github.com/Axi5CC/Saga#下载
```

README 的「下载」小节写明正在申请 SignPath Foundation，并链接到 Releases 页面。

**Privacy Policy URL**

```text
https://github.com/Axi5CC/Saga#隐私
```

**Tagline**

```text
Quiet, local-first book writing: a book is a folder, and finished manuscripts export to EPUB, standard manuscript format, and KDP paperback.
```

**Category**

```text
Productivity
```

**Description**

```text
Saga is a local-first Electron writing app for books. Each book is a plain folder of HTML chapter files, with autosave, comments, full-text find and replace, and exports for EPUB 3, standard manuscript DOCX/PDF, and KDP paperback interiors and covers. It has no account, cloud, database, or proprietary format, and includes an MCP/CLI interface for local AI tools.
```

**Reputation**

```text
Public MIT repository with active development and five published releases. GitHub Releases currently show about 24 installer downloads; the project includes a complete public-domain example book and a built-in smoke test. Repository: https://github.com/Axi5CC/Saga
```

**Maintainer Type**

```text
Individual maintainer(s)
```

如果实际是社区项目，改成 `Independent community project (no formal organization)`。

**Build System**

```text
GitHub Actions
```

**First Name / Last Name / Email**

需要维护者本人填写。邮箱可使用 `396673164@qq.com`（与帮助页一致）。

**Primary Discovery Channel**

```text
AI / LLM tools
```

如果不想这样填，可选 `Developer platforms (e.g., GitHub)`。

## 三、申请前的仓库状态

已完成：

1. **Windows 构建 workflow**
   `.github/workflows/windows-build.yml`：在 `windows-latest` 上 `npm ci`、`npm run dist:win`，再用 `actions/upload-artifact@v4` 上传 `Saga-Setup-*.exe` 和 `Saga-Portable-*.exe`。`sign` job 以 `vars.SIGNPATH_PROJECT_SLUG` 是否为空作为开关；审核通过并填好 Variables 后自动启用，之前不会失败。

2. **仓库内的打包配置**
   `electron-builder.yml`、`afterPack.js`、`scripts/build-win.js`：把运行文件复制到 `build/app/`，混淆 JavaScript，再由 electron-builder 打包。源码目录不会被改动，本地和 GitHub Actions 使用同一套构建。

3. **下载页提及 SignPath**
   README 的「下载」和「代码签名」已经写明“正在申请 SignPath Foundation 的免费开源代码签名”。

4. **隐私说明**
   README 已新增「隐私」小节：本地优先，不收集书稿和用户数据，只有更新检查会访问 GitHub API。

还没做（需要你本人操作）：

5. **提交申请**
   https://signpath.org/apply，字段见下一节。

6. **安装 SignPath GitHub App**
   审核通过后安装 https://github.com/apps/signpath，授权读取 `Axi5CC/Saga`。

## 四、审核通过后的配置

SignPath 审核通过后会给出：

- Organization ID
- Project slug
- Signing policy slug（例如 `release-signing`）
- Artifact configuration slug（例如 `saga-windows-installers`）

GitHub 仓库需要配置：

| 类型 | 名称 | 用途 |
|---|---|---|
| Secret | `SIGNPATH_API_TOKEN` | SignPath API token，需要 submitter 权限 |
| Variable | `SIGNPATH_ORGANIZATION_ID` | SignPath 组织 ID |
| Variable | `SIGNPATH_PROJECT_SLUG` | 项目 slug |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | 签名策略 slug |
| Variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | 制品配置 slug |

GitHub Actions 的接入已经写在 `.github/workflows/windows-build.yml` 的 `sign` job 里；只有 `vars.SIGNPATH_PROJECT_SLUG` 非空时才会运行：

```yaml
- name: Upload unsigned installers
  id: upload
  uses: actions/upload-artifact@v4
  with:
    name: saga-windows-unsigned
    path: |
      build/app/dist/Saga-Setup-*.exe
      build/app/dist/Saga-Portable-*.exe

- name: Submit signing request
  uses: signpath/github-action-submit-signing-request@v3
  with:
    api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
    organization-id: ${{ vars.SIGNPATH_ORGANIZATION_ID }}
    project-slug: ${{ vars.SIGNPATH_PROJECT_SLUG }}
    signing-policy-slug: ${{ vars.SIGNPATH_SIGNING_POLICY_SLUG }}
    artifact-configuration-slug: ${{ vars.SIGNPATH_ARTIFACT_CONFIGURATION_SLUG }}
    github-artifact-id: ${{ needs.build.outputs.artifact-id }}
    wait-for-completion: true
    wait-for-completion-timeout-in-seconds: 1800
    output-artifact-directory: signed
```

`SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` 在 workflow 里会直接传给 SignPath，所以审核通过后必须创建好 Artifact Configuration 并填这个 Variable。

## 五、Artifact Configuration 草稿

`actions/upload-artifact` 会把文件打成 ZIP，因此根节点用 `<zip-file>`：

```xml
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <pe-file path="Saga-Setup-*.exe" max-matches="unbounded">
      <authenticode-sign/>
    </pe-file>
    <pe-file path="Saga-Portable-*.exe" max-matches="unbounded">
      <authenticode-sign/>
    </pe-file>
  </zip-file>
</artifact-configuration>
```

**已确认：** SignPath 的 Deep signing 支持 MSI、CAB、APPX/MSIX 等复合格式，**不支持 NSIS**。`Saga-Setup-*.exe` 和 `Saga-Portable-*.exe` 只能签外层，安装包内部的 `Saga.exe` 不会一并签名。

当前 workflow 先签外层安装器，保证用户下载和运行安装程序时不再提示“未知发布者”。要连主程序一起签，审核通过后改成两阶段构建：

1. `electron-builder --dir` 产出 `build/app/dist/win-unpacked`，把整个目录上传给 SignPath，签其中的 `Saga.exe`（以及需要的 DLL）；
2. 下载签名后的目录，放回 `win-unpacked`，用 `electron-builder --prepackaged <目录>` 重新生成 Setup / Portable；
3. 把新的外层安装器再次提交 SignPath 签名。

注意：`@electron/fuses` 必须在签名**之前**执行；第二阶段用 `--prepackaged` 时要避免再次执行 `afterPack`，否则会改坏已经签好的 `Saga.exe`。

## 六、接下来怎么做

1. 在 https://signpath.org/apply 提交申请。First Name / Last Name / Email 填你本人的，其余字段直接复制第二节。
2. 审核通过后，在 SignPath 里创建 Project、Signing Policy 和 Artifact Configuration（用第五节的 XML），并安装 SignPath GitHub App。
3. 在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置第四节列出的 1 个 Secret 和 4 个 Variables。
4. 手动触发一次 `Windows build` workflow，在 SignPath 里批准签名请求，确认签名后的安装包能下载。
5. 用 `signtool verify /pa /v` 验证外层安装器；安装后再验证 `Saga.exe`。
6. 再决定发布 1.4.1 或 1.4.2 的签名安装包；如果要连主程序一起签，按第五节的两阶段构建改造 workflow。

如果申请因项目太新被拒，现实方案是先用 OV 代码签名证书，等下载量和社区使用量上来后再申请 SignPath Foundation。
