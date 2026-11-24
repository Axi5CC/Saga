'use strict'

/*  Saga's MCP server: newline-delimited JSON-RPC over stdin/stdout.

    It is started by the AI client, not by the window:
      command: <Saga.exe>
      args:    [<resources>/ai/mcp-server.js]
      env:     { ELECTRON_RUN_AS_NODE: "1" }

    Every tool takes a book folder path. Reads always work; writes refuse
    while that same book is open in the window. Nothing is printed to stdout
    except protocol messages.  */

const readline = require('node:readline')
const core = require('./book-core')
const { exportBook } = require('./export-book')
const { openInSaga } = require('./launcher')

const VERSION = '1.0.0'
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

const bookArg = {
  type: 'string',
  description: '书籍文件夹的绝对路径（包含 book.json 和 chapters/）'
}
const chapterArg = {
  type: 'string',
  description: '章节 id、标题、唯一标题片段，或从 1 开始的序号'
}

const TOOLS = [
  {
    name: 'list_books',
    description: '列出 Saga 最近打开的书，并标出当前书。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'current_book',
    description: '返回 Saga 上次/当前打开的书及章节信息。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'app_status',
    description: '查看 Saga 窗口是否正在运行，以及它打开的是哪本书。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'book_info',
    description: '读取一本书的书名、作者、总字数与全部章节列表（含 id、标题、字数）。',
    inputSchema: {
      type: 'object',
      properties: { book: bookArg },
      required: ['book'],
      additionalProperties: false
    }
  },
  {
    name: 'read_chapter',
    description: '读一章的纯文本；可选返回原始 HTML。',
    inputSchema: {
      type: 'object',
      properties: {
        book: bookArg,
        chapter: chapterArg,
        include_html: { type: 'boolean', description: '同时返回章节 HTML，默认 false' }
      },
      required: ['book', 'chapter'],
      additionalProperties: false
    }
  },
  {
    name: 'write_chapter',
    description: '改写或追加一章。默认把纯文本按行转成段落；写入前会把原文备份到书的 darlings/。',
    inputSchema: {
      type: 'object',
      properties: {
        book: bookArg,
        chapter: chapterArg,
        text: { type: 'string', description: '新的文字；mode=append 时追加到末尾' },
        mode: { type: 'string', enum: ['replace', 'append'], description: '默认 replace' },
        html: { type: 'boolean', description: 'text 已经是 HTML 时设为 true' }
      },
      required: ['book', 'chapter', 'text'],
      additionalProperties: false
    }
  },
  {
    name: 'create_chapter',
    description: '在书中新建一章，可指定类型、标题和插入位置。',
    inputSchema: {
      type: 'object',
      properties: {
        book: bookArg,
        title: { type: 'string' },
        kind: {
          type: 'string',
          enum: [...core.ALL_KINDS].sort(),
          description: '章节类型，默认 chapter'
        },
        before: { type: 'string', description: '插到这一章之前；不填则放在末尾' }
      },
      required: ['book'],
      additionalProperties: false
    }
  },
  {
    name: 'rename_chapter',
    description: '修改章节标题（只改 book.json，不动章节文字）。',
    inputSchema: {
      type: 'object',
      properties: {
        book: bookArg,
        chapter: chapterArg,
        title: { type: 'string' }
      },
      required: ['book', 'chapter', 'title'],
      additionalProperties: false
    }
  },
  {
    name: 'move_chapter',
    description: '移动章节到另一章之前；不填 before 则移到末尾。',
    inputSchema: {
      type: 'object',
      properties: {
        book: bookArg,
        chapter: chapterArg,
        before: { type: 'string', description: '目标章节；不填则移到末尾' }
      },
      required: ['book', 'chapter'],
      additionalProperties: false
    }
  },
  {
    name: 'delete_chapter',
    description: '删除一章：章节文件移入书的 darlings/，绝不硬删除。',
    inputSchema: {
      type: 'object',
      properties: { book: bookArg, chapter: chapterArg },
      required: ['book', 'chapter'],
      additionalProperties: false
    }
  },
  {
    name: 'update_book_meta',
    description: '修改书名、作者或副标题。',
    inputSchema: {
      type: 'object',
      properties: {
        book: bookArg,
        title: { type: 'string' },
        author: { type: 'string' },
        subtitle: { type: 'string' }
      },
      required: ['book'],
      additionalProperties: false
    }
  },
  {
    name: 'create_book',
    description: '在指定父文件夹里按 Saga 的模板新建一本书。',
    inputSchema: {
      type: 'object',
      properties: {
        parent: { type: 'string', description: '书籍文件夹要放在哪个文件夹里' },
        title: { type: 'string' },
        author: { type: 'string' }
      },
      required: ['parent', 'title'],
      additionalProperties: false
    }
  },
  {
    name: 'search_book',
    description: '在整本书里搜索文字，返回章节与上下文片段。',
    inputSchema: {
      type: 'object',
      properties: {
        book: bookArg,
        query: { type: 'string' },
        limit: { type: 'number', description: '最多返回多少处，默认 20' }
      },
      required: ['book', 'query'],
      additionalProperties: false
    }
  },
  {
    name: 'list_darlings',
    description: '列出书的 darlings/ 备份文件（AI 改写或删除前留下的原文）。',
    inputSchema: {
      type: 'object',
      properties: { book: bookArg },
      required: ['book'],
      additionalProperties: false
    }
  },
  {
    name: 'export_book',
    description: '导出整本书。文本/打包格式直接生成；pdf 与 kdp 会启动一个无窗口进程打印。',
    inputSchema: {
      type: 'object',
      properties: {
        book: bookArg,
        format: {
          type: 'string',
          enum: ['txt', 'md', 'html', 'epub', 'docx', 'odt', 'rtf', 'tex', 'pdf', 'kdp']
        },
        out: { type: 'string', description: '输出文件；不填则放在书文件夹旁边' },
        out_dir: { type: 'string', description: 'KDP 输出文件夹；不填则放在书文件夹旁边' },
        trim: { type: 'string', enum: Object.keys(require('./book-formats').KDP_TRIMS), description: 'KDP 开本，默认 6x9' },
        paper: { type: 'string', enum: ['white', 'cream'], description: 'KDP 纸张，默认 white' }
      },
      required: ['book', 'format'],
      additionalProperties: false
    }
  },
  {
    name: 'open_book',
    description: '在 Saga 窗口中打开这本书；窗口已开着时会切换到它。',
    inputSchema: {
      type: 'object',
      properties: { book: bookArg },
      required: ['book'],
      additionalProperties: false
    }
  }
]

async function callTool (name, args) {
  args = args || {}
  const book = args.book ? core.bookDir(args.book) : null
  switch (name) {
    case 'list_books':
      return { books: core.listBooks() }
    case 'current_book': {
      const current = core.currentBookPath()
      return current ? core.bookInfo(current) : { book: null }
    }
    case 'app_status': {
      const session = core.openSession()
      return { running: !!session, book: session ? session.dir : null }
    }
    case 'book_info':
      return core.bookInfo(book)
    case 'read_chapter': {
      const data = core.readChapter(book, args.chapter)
      if (!args.include_html) delete data.html
      return data
    }
    case 'write_chapter':
      if (typeof args.text !== 'string') throw new Error('缺少 text')
      return core.writeChapter(book, args.chapter, {
        text: args.text,
        mode: args.mode === 'append' ? 'append' : 'replace',
        html: !!args.html
      })
    case 'create_chapter':
      return core.createChapter(book, {
        title: args.title,
        kind: args.kind || 'chapter',
        before: args.before
      })
    case 'rename_chapter':
      return core.renameChapter(book, args.chapter, args.title)
    case 'move_chapter':
      return core.moveChapter(book, args.chapter, args.before || null)
    case 'delete_chapter':
      return core.deleteChapter(book, args.chapter)
    case 'update_book_meta':
      return core.updateBookMeta(book, {
        title: args.title,
        author: args.author,
        subtitle: args.subtitle
      })
    case 'create_book':
      return core.createBook(args.parent, { title: args.title, author: args.author })
    case 'search_book':
      return core.searchBook(book, args.query, args.limit)
    case 'list_darlings':
      return { darlings: core.listDarlings(book) }
    case 'export_book':
      return exportBook(book, {
        format: args.format,
        out: args.out,
        outDir: args.out_dir,
        trim: args.trim,
        paper: args.paper
      })
    case 'open_book':
      openInSaga(book)
      return { ok: true, opened: book }
    default:
      throw new Error('不认识的功能：' + name)
  }
}

/* ---------- protocol ---------- */

function send (message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function reply (id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function error (id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle (message) {
  if (!message || typeof message !== 'object' || !message.method) {
    if (message && message.id != null) error(message.id, -32600, 'Invalid Request')
    return
  }
  const id = message.id
  const isNotification = id == null
  try {
    switch (message.method) {
      case 'initialize': {
        const asked = message.params && message.params.protocolVersion
        const protocolVersion = PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0]
        if (!isNotification) {
          reply(id, {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'saga', version: VERSION }
          })
        }
        return
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return
      case 'ping':
        if (!isNotification) reply(id, {})
        return
      case 'tools/list':
        if (!isNotification) reply(id, { tools: TOOLS })
        return
      case 'tools/call': {
        if (isNotification) return
        const name = message.params && message.params.name
        const args = (message.params && message.params.arguments) || {}
        try {
          const result = await callTool(name, args)
          reply(id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: false
          })
        } catch (err) {
          reply(id, {
            content: [{ type: 'text', text: '错误：' + (err && err.message ? err.message : String(err)) }],
            isError: true
          })
        }
        return
      }
      default:
        if (!isNotification) error(id, -32601, 'Method not found: ' + message.method)
    }
  } catch (err) {
    if (!isNotification) error(id, -32603, err && err.message ? err.message : String(err))
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (text) => {
  const trimmed = text.trim()
  if (!trimmed) return
  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    error(null, -32700, 'Parse error')
    return
  }
  handle(message)
})
input.on('close', () => {
  process.exitCode = 0
})
