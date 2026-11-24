'use strict'

/*  Saga's command line.

    A book is a folder, so every command works on a folder path: no window,
    no server, no database. `saga.cmd` runs this file inside Saga's own
    Electron runtime, so the installed app needs nothing else.  */

const fs = require('node:fs')
const path = require('node:path')
const core = require('./book-core')
const { openInSaga } = require('./launcher')
const { exportBook } = require('./export-book')

const VERSION = '1.0.0'

class UsageError extends Error {}

/* ---------- arguments ---------- */

function parseArgs (argv) {
  const flags = {}
  const positionals = []
  const takesValue = new Set([
    '--text', '--title', '--author', '--subtitle', '--kind', '--before',
    '--limit', '--format', '--out', '--out-dir', '--trim', '--paper'
  ])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      let key = arg
      let value = true
      const eq = arg.indexOf('=')
      if (eq > 0) {
        key = arg.slice(0, eq)
        value = arg.slice(eq + 1)
      }
      if (key === '--help' || key === '--version' || key === '--json' ||
        key === '--html' || key === '--append' || key === '--stdin') {
        flags[key.slice(2)] = true
        continue
      }
      if (!takesValue.has(key)) throw new UsageError('不认识的参数：' + key)
      if (value === true) {
        value = argv[++i]
        if (value == null || value.startsWith('--')) throw new UsageError('参数 ' + key + ' 缺少值')
      }
      flags[key.slice(2)] = value
      continue
    }
    positionals.push(arg)
  }
  return { positionals, flags }
}

function usage () {
  return `Saga ${VERSION} — 用命令行读写一本书

用法：
  saga books [--json]                     最近打开的书
  saga current [--json]                   当前（上次打开）的书
  saga info <书> [--json]                 书的资料与章节
  saga chapters <书> [--json]             只列章节
  saga read <书> <章节> [--html]          读一章
  saga write <书> <章节> (--text 文件 | --stdin) [--append] [--html]
                                          改写/追加一章（先备份到 darlings）
  saga search <书> <词> [--limit 20]      跨章搜索
  saga new <父文件夹> --title 书名 [--author 作者]
                                          按模板新建一本书
  saga add-chapter <书> [标题] [--kind chapter] [--before 章节]
  saga rename-chapter <书> <章节> <新标题>
  saga move-chapter <书> <章节> [--before 章节]
  saga delete-chapter <书> <章节>         移入 darlings，不硬删除
  saga meta <书> [--title ...] [--author ...] [--subtitle ...]
  saga export <书> --format <格式> [--out 文件 | --out-dir 文件夹]
                                          格式：txt md html epub docx odt rtf tex pdf kdp
  saga darlings <书> [--json]             列出备份文件
  saga open <书>                          在 Saga 窗口中打开
  saga mcp                                以 stdio 启动 MCP 服务
  saga unlock                             清理已退出窗口留下的会话

<书> 可以是绝对路径、. 或 current；<章节> 可以是 id、标题、唯一片段或序号。
`
}

/* ---------- output ---------- */

function write (text) {
  process.stdout.write(String(text == null ? '' : text))
}

function line (text) {
  write(String(text == null ? '' : text) + '\n')
}

function json (value) {
  line(JSON.stringify(value, null, 2))
}

function humanBook (book) {
  return '《' + book.title + '》' + (book.author ? ' · ' + book.author : '') +
    ' · ' + book.totals.words + ' 字 · ' + book.totals.chapters + ' 章'
}

/* ---------- book arguments ---------- */

function bookToken (token) {
  if (token === '.') return path.resolve('.')
  if (!token || token === 'current' || token === '-') {
    const current = core.currentBookPath()
    if (!current) throw new Error('没有当前书籍，请先给一个书籍文件夹')
    return current
  }
  return path.resolve(token)
}

async function readStdin () {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/* ---------- commands ---------- */

async function main () {
  const { positionals, flags } = parseArgs(process.argv.slice(2))
  const cmd = positionals[0]

  if (!cmd || cmd === 'help' || flags.help) {
    write(usage())
    return
  }
  if (cmd === 'version' || flags.version) {
    line('Saga ' + VERSION)
    return
  }
  if (cmd === 'mcp') {
    require('./mcp-server')
    return
  }

  if (cmd === 'books') {
    const data = core.listBooks()
    if (flags.json) return json(data)
    if (!data.length) return line('还没有最近打开的书')
    for (const b of data) line((b.current ? '* ' : '  ') + '《' + b.title + '》  ' + b.dir)
    return
  }

  if (cmd === 'current') {
    const current = core.currentBookPath()
    const data = current ? core.bookInfo(current) : null
    if (flags.json) return json(data)
    if (!data) return line('没有当前书籍')
    line(humanBook(data) + '  ' + data.dir)
    return
  }

  if (cmd === 'unlock') {
    line(core.unlock())
    return
  }

  if (cmd === 'new') {
    const parent = positionals[1] ? path.resolve(positionals[1]) : path.resolve('.')
    const data = core.createBook(parent, { title: flags.title, author: flags.author })
    if (flags.json) return json({ dir: data.dir, title: data.meta.title })
    line('已新建《' + data.meta.title + '》：' + data.dir)
    return
  }

  const bookCommands = new Set([
    'info', 'chapters', 'read', 'write', 'search', 'add-chapter', 'rename-chapter',
    'move-chapter', 'delete-chapter', 'meta', 'export', 'darlings', 'open'
  ])
  if (!bookCommands.has(cmd)) throw new UsageError('不认识的命令：' + cmd)

  const bookPath = bookToken(positionals[1])
  core.bookDir(bookPath)

  if (cmd === 'info') {
    const data = core.bookInfo(bookPath)
    if (flags.json) return json(data)
    line(humanBook(data))
    line(data.dir)
    for (const ch of data.chapters) line('  ' + ch.label + '  [' + ch.id + ']  ' + ch.words + ' 字')
    return
  }

  if (cmd === 'chapters') {
    const data = core.bookInfo(bookPath).chapters
    if (flags.json) return json(data)
    for (const ch of data) line(ch.label + '  [' + ch.id + ']  ' + ch.words + ' 字')
    return
  }

  if (cmd === 'read') {
    const chapter = positionals[2]
    if (!chapter) throw new UsageError('缺少章节')
    const data = core.readChapter(bookPath, chapter)
    if (flags.json) return json(flags.html ? data : { ...data, html: undefined })
    line(flags.html ? data.html : data.text)
    return
  }

  if (cmd === 'write') {
    const chapter = positionals[2]
    if (!chapter) throw new UsageError('缺少章节')
    let text = null
    if (flags.text) text = fs.readFileSync(path.resolve(flags.text), 'utf8')
    else if (flags.stdin || !process.stdin.isTTY) text = await readStdin()
    if (text == null) throw new UsageError('用 --text 文件 或 --stdin 给出文字')
    const data = core.writeChapter(bookPath, chapter, {
      text,
      mode: flags.append ? 'append' : 'replace',
      html: !!flags.html
    })
    if (flags.json) return json(data)
    line('已写入 ' + data.label + '（' + data.words + ' 字）')
    if (data.backup) line('原文已备份：' + data.backup)
    return
  }

  if (cmd === 'search') {
    const query = positionals.slice(2).join(' ')
    if (!query) throw new UsageError('缺少搜索词')
    const data = core.searchBook(bookPath, query, flags.limit)
    if (flags.json) return json(data)
    line('找到 ' + data.total + ' 处' + (data.matches.length < data.total ? '，显示前 ' + data.matches.length + ' 处' : ''))
    for (const m of data.matches) line('  ' + m.label + '：' + m.snippet)
    return
  }

  if (cmd === 'add-chapter') {
    const data = core.createChapter(bookPath, {
      title: flags.title || positionals[2] || '',
      kind: flags.kind || 'chapter',
      before: flags.before || null
    })
    if (flags.json) return json({ id: data.id, label: data.label })
    line('已新建：' + data.label + '  [' + data.id + ']')
    return
  }

  if (cmd === 'rename-chapter') {
    const chapter = positionals[2]
    const title = positionals.slice(3).join(' ')
    if (!chapter || !title) throw new UsageError('用法：saga rename-chapter <书> <章节> <新标题>')
    const data = core.renameChapter(bookPath, chapter, title)
    if (flags.json) return json(data)
    line('已改名：' + data.label)
    return
  }

  if (cmd === 'move-chapter') {
    const chapter = positionals[2]
    if (!chapter) throw new UsageError('缺少章节')
    const data = core.moveChapter(bookPath, chapter, flags.before || null)
    if (flags.json) return json({ id: data.id, moved: data.moved })
    line(data.moved ? '已移动章节' : '章节没有移动')
    return
  }

  if (cmd === 'delete-chapter') {
    const chapter = positionals[2]
    if (!chapter) throw new UsageError('缺少章节')
    const data = core.deleteChapter(bookPath, chapter)
    if (flags.json) return json(data)
    line('已移入回收站：' + data.darlings)
    return
  }

  if (cmd === 'meta') {
    const hasUpdate = flags.title != null || flags.author != null || flags.subtitle != null
    if (hasUpdate) {
      const meta = core.updateBookMeta(bookPath, {
        title: flags.title,
        author: flags.author,
        subtitle: flags.subtitle
      })
      if (flags.json) return json(meta)
      line('已更新《' + (meta.title || '未命名') + '》')
      return
    }
    const data = core.bookInfo(bookPath)
    if (flags.json) return json(data)
    line('书名：' + (data.title || '未命名'))
    line('作者：' + (data.author || '佚名'))
    line('副标题：' + (data.subtitle || ''))
    line('文件夹：' + data.dir)
    return
  }

  if (cmd === 'export') {
    const data = await exportBook(bookPath, {
      format: flags.format,
      out: flags.out,
      outDir: flags['out-dir'],
      trim: flags.trim,
      paper: flags.paper
    })
    if (flags.json) return json(data)
    if (data.interior) {
      line('内页：' + data.interior)
      line('封面：' + data.cover)
      line(data.pages + ' 页 · 书脊 ' + data.spine + ' 英寸' + (data.warning ? '；' + data.warning : ''))
    } else {
      line('已导出：' + data.file + (data.pages ? '（' + data.pages + ' 页）' : ''))
    }
    return
  }

  if (cmd === 'darlings') {
    const data = core.listDarlings(bookPath)
    if (flags.json) return json(data)
    if (!data.length) return line('darlings 文件夹是空的')
    for (const d of data) line(d.name + '  ' + d.size + ' bytes  ' + d.modified)
    return
  }

  if (cmd === 'open') {
    openInSaga(bookPath)
    line('已在 Saga 中打开：' + bookPath)
    return
  }
}

main().catch((err) => {
  const message = err && err.message ? err.message : String(err)
  process.stderr.write('saga: ' + message + '\n')
  process.exitCode = err instanceof UsageError ? 2 : 1
  if (err instanceof UsageError) process.stderr.write('运行 saga help 查看用法\n')
})
