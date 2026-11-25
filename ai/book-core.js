'use strict'

/*  The book's folder, read and written without Electron.

    CLI, MCP and the window's export builders all go through this module, so a
    chapter written by an AI lands in exactly the same shape the editor makes:
    book.json holds the order and names, chapters/<id>.html holds only words.

    Nothing here opens a window. A book is a folder of plain files.  */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const MAX_RECENT = 12

const KIND_LABEL = {
  copyright: '版权', dedication: '献辞', epigraph: '题词', contents: '目录',
  opening: '卷首语', foreword: '前言', prologue: '序章', part: '部分',
  unnumbered: '未命名章节', epilogue: '尾声', extra: '番外',
  afterword: '后记', acknowledgments: '致谢', about: '关于作者'
}
const KIND_LABEL_EN = {
  copyright: 'Copyright', dedication: 'Dedication', epigraph: 'Epigraph', contents: 'Contents',
  opening: 'Opening', foreword: 'Foreword', prologue: 'Prologue', part: 'Part',
  unnumbered: 'Untitled', epilogue: 'Epilogue', extra: 'Extra',
  afterword: 'Afterword', acknowledgments: 'Acknowledgments', about: 'About the Author'
}
const CONTENTS_SKIP = ['copyright', 'dedication', 'epigraph', 'contents']
const STORY_KINDS = new Set(['chapter', 'part', 'prologue', 'unnumbered', 'epilogue', 'extra'])
// the window's word count leaves a part's page out; exports still print it
const STORY_WORD_KINDS = new Set(['chapter', 'unnumbered', 'prologue', 'epilogue', 'extra'])
const ALL_KINDS = new Set([...Object.keys(KIND_LABEL), 'chapter'])
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX']

const TEMPLATE_KINDS = [
  'copyright', 'dedication', 'epigraph', 'contents', 'opening', 'foreword',
  'prologue',
  'part', 'chapter', 'chapter', 'chapter',
  'part', 'chapter', 'chapter', 'chapter',
  'part', 'chapter', 'chapter', 'chapter',
  'unnumbered', 'unnumbered', 'unnumbered',
  'epilogue',
  'extra', 'extra', 'extra',
  'afterword', 'acknowledgments', 'about'
]

const ENTITY = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/* ---------- names and paths ---------- */

// one path segment, nothing else: no slashes, no dots that walk up
const safeName = (s) => typeof s === 'string' && s.length > 0 && s.length < 120 &&
  s !== '.' && s !== '..' && !/[\\/\0]/.test(s)

function safePath (dir, ...parts) {
  const full = path.resolve(dir, ...parts)
  const root = path.resolve(dir) + path.sep
  return full.startsWith(root) ? full : null
}

// a name that can be a folder or a file on Windows
function plainName (text, max) {
  const clean = String(text == null ? '' : text)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
  return (clean || '未命名').slice(0, max || 80)
}

function uniqueChapterId (dir, taken) {
  let id
  do {
    id = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
  } while (taken.has(id) || fs.existsSync(path.join(dir, 'chapters', id + '.html')))
  return id
}

const samePath = (a, b) => {
  try { return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() } catch { return false }
}

/* ---------- durable reads and writes ---------- */

function readJSON (file, fallback) {
  for (const f of [file, file + '.bak']) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}
  }
  return fallback
}

function writeFileDurable (file, text) {
  const tmp = file + '.tmp'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, text, 'utf8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
}

function writeJSON (file, data) {
  writeFileDurable(file, JSON.stringify(data, null, 2))
}

/* ---------- the book's shape ---------- */

const kindOfMeta = (meta, id) => (meta.chapterKinds && meta.chapterKinds[id]) || 'chapter'

function numberIn (meta, id, kind) {
  let n = 0
  for (const chId of meta.chapterOrder) {
    if (kindOfMeta(meta, chId) === kind) n++
    if (chId === id) break
  }
  return n
}

// The book's language is the metadata editor's language field; an English
// book should not come out of the exporters with Chinese chapter headings.
const isChineseBook = (meta) => !meta || !meta.language || /^zh/i.test(String(meta.language))

function bookLabel (meta, id) {
  const kind = kindOfMeta(meta, id)
  const titled = String((meta.chapterTitles && meta.chapterTitles[id]) || '').trim()
  const zh = isChineseBook(meta)
  const sep = zh ? ' · ' : ' — '
  if (kind === 'chapter') {
    const n = numberIn(meta, id, 'chapter')
    const name = zh ? '第 ' + n + ' 章' : 'Chapter ' + n
    return titled ? name + sep + titled : name
  }
  if (kind === 'part') {
    const n = numberIn(meta, id, 'part')
    const name = zh ? '第 ' + (ROMAN[n] || n) + ' 部分' : 'Part ' + (ROMAN[n] || n)
    return titled ? name + sep + titled : name
  }
  if (kind === 'unnumbered') return titled || (zh ? '未命名' : 'Untitled')
  // a prologue, epilogue or extra can carry the writer's own name
  if (titled && (kind === 'prologue' || kind === 'epilogue' || kind === 'extra')) return titled
  return (zh ? KIND_LABEL : KIND_LABEL_EN)[kind] || kind
}

function contentsLines (meta) {
  return meta.chapterOrder
    .filter((id) => !CONTENTS_SKIP.includes(kindOfMeta(meta, id)))
    .map((id) => bookLabel(meta, id))
}

/* ---------- words ---------- */

function htmlText (html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
      }
      return ENTITY[code.toLowerCase()] ?? m
    })
    .replace(/\r/g, '')
    .split('\n').map((line) => line.replace(/[ \t]+$/g, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// the window counts words from a whitespace-collapsed copy, so a count here
// matches the number on the paper
function textOf (html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' '
      }
      return ENTITY[code.toLowerCase()] ?? m
    })
    .replace(/\s+/g, ' ')
    .trim()
}

// the words a reader would select, in the same order the window's
// `.chapter-body.textContent` produces: block tags add no separators, `<br>`
// adds no character.  Comment anchors use offsets into this text.
function contentText (html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
      }
      if (code.toLowerCase() === 'nbsp') return '\u00a0'
      return ENTITY[code.toLowerCase()] ?? m
    })
    .replace(/\r/g, '')
}

function countWords (text) {
  const cjk = (text.match(/[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/g) || []).length
  const rest = text.replace(/[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/g, ' ')
  const latin = (rest.match(/[A-Za-z0-9À-ÖØ-öø-ÿ'’]+/g) || []).length
  return cjk + latin
}

function escapeHtml (text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// plain text in, the editor's paragraphs out: one line, one <p>
function textToHtml (text, opts) {
  const raw = String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (opts && opts.html) return raw
  const lines = raw.split('\n').map((line) => line.replace(/[ \t]+$/g, ''))
  const paragraphs = []
  for (const line of lines) {
    if (!line.trim()) continue
    paragraphs.push('<p>' + escapeHtml(line) + '</p>')
  }
  return paragraphs.length ? paragraphs.join('\n') : '<p><br></p>'
}

function appendHtml (oldHtml, newHtml) {
  const old = String(oldHtml || '').trim()
  if (!old || /^<p><br\s*\/?><\/p>$/i.test(old)) return newHtml
  const trimmed = old.replace(/(<p><br\s*\/?><\/p>\s*)+$/i, '').trim()
  return (trimmed ? trimmed + '\n' : '') + newHtml
}

/* ---------- settings and the open-book session ---------- */

function userDataDir () {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Saga')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Saga')
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Saga')
}

const settingsPath = () => path.join(userDataDir(), 'settings.json')
const sessionPath = () => path.join(userDataDir(), 'ai-session.json')

function readSettings () {
  return readJSON(settingsPath(), {}) || {}
}

function pidAlive (pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process is there, just owned by someone else
    return err && err.code === 'EPERM'
  }
}

// a session whose process is gone is not a lock
function openSession () {
  const s = readJSON(sessionPath(), null)
  if (!s || typeof s.dir !== 'string' || !Number.isInteger(s.pid)) return null
  if (pidAlive(s.pid)) return s
  try { fs.unlinkSync(sessionPath()) } catch {}
  return null
}

function clearSession () {
  try { fs.unlinkSync(sessionPath()) } catch {}
}

function assertWritable (dir) {
  const s = openSession()
  if (s && samePath(s.dir, dir)) {
    throw new Error('这本书正在 Saga 窗口中打开。请先在 Saga 里点「← 首页」再让 AI 写入，避免覆盖未保存的内容。')
  }
}

function unlock () {
  const s = readJSON(sessionPath(), null)
  if (!s) return '没有待清理的会话'
  if (Number.isInteger(s.pid) && pidAlive(s.pid)) {
    throw new Error('Saga 仍在运行（PID ' + s.pid + '），会话没有清理')
  }
  clearSession()
  return '已清理陈旧的会话'
}

function listBooks () {
  const s = readSettings()
  const current = typeof s.lastBook === 'string' ? s.lastBook : null
  const list = Array.isArray(s.recent) ? s.recent : []
  return list
    .filter((r) => r && typeof r.dir === 'string' && r.dir && fs.existsSync(path.join(r.dir, 'book.json')))
    .map((r) => ({
      dir: r.dir,
      title: r.title || path.basename(r.dir),
      current: current ? samePath(r.dir, current) : false,
      openInSaga: (() => {
        const open = openSession()
        return !!(open && samePath(open.dir, r.dir))
      })()
    }))
}

function currentBookPath () {
  const s = readSettings()
  if (typeof s.lastBook !== 'string' || !s.lastBook) return null
  if (!fs.existsSync(path.join(s.lastBook, 'book.json'))) return null
  return s.lastBook
}

/* ---------- reading a book ---------- */

const BOOK_FOLDER_HINT = 'Saga 打开的是书稿文件夹（含 book.json 和 chapters/），不是 EPUB、PDF、TXT 等成品。'

function bookDir (dir) {
  if (typeof dir !== 'string' || !dir) throw new Error('没有给出书籍文件夹')
  const full = path.resolve(dir)
  if (!fs.existsSync(path.join(full, 'book.json'))) throw new Error('这个文件夹里没有 book.json。' + BOOK_FOLDER_HINT)
  if (!fs.existsSync(path.join(full, 'chapters'))) throw new Error('这个文件夹缺少 chapters 文件夹。' + BOOK_FOLDER_HINT)
  return full
}

function readMeta (dir) {
  const meta = readJSON(path.join(dir, 'book.json'), null)
  if (!meta || !Array.isArray(meta.chapterOrder)) throw new Error('book.json 读不出来')
  return meta
}

function readBook (dir) {
  const full = bookDir(dir)
  const meta = readMeta(full)
  const chapters = {}
  for (const id of meta.chapterOrder) {
    if (!safeName(id)) continue
    const file = safePath(full, 'chapters', id + '.html')
    if (!file) continue
    try { chapters[id] = fs.readFileSync(file, 'utf8') } catch { chapters[id] = '' }
  }
  return { dir: full, name: path.basename(full), meta, chapters }
}

function writeMeta (dir, meta) {
  const file = path.join(dir, 'book.json')
  meta.modified = new Date().toISOString()
  try { fs.copyFileSync(file, file + '.bak') } catch {}
  writeJSON(file, meta)
}

function chapterFile (dir, id) {
  if (!safeName(id)) throw new Error('章节名不合法')
  const file = safePath(dir, 'chapters', id + '.html')
  if (!file) throw new Error('章节路径不合法')
  return file
}

function resolveChapter (meta, token) {
  const raw = String(token == null ? '' : token).trim()
  if (!raw) throw new Error('没有给出章节')
  if (meta.chapterOrder.includes(raw)) return raw
  const lower = raw.toLowerCase()
  const byTitle = meta.chapterOrder.filter((id) =>
    String((meta.chapterTitles && meta.chapterTitles[id]) || '').trim().toLowerCase() === lower)
  if (byTitle.length === 1) return byTitle[0]
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    if (n >= 1 && n <= meta.chapterOrder.length) return meta.chapterOrder[n - 1]
  }
  const matches = meta.chapterOrder.filter((id) => {
    const title = String((meta.chapterTitles && meta.chapterTitles[id]) || '').toLowerCase()
    return id.toLowerCase().includes(lower) || title.includes(lower) || bookLabel(meta, id).toLowerCase().includes(lower)
  })
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    throw new Error('章节「' + raw + '」有多个匹配：' +
      matches.slice(0, 6).map((id) => bookLabel(meta, id)).join('、'))
  }
  throw new Error('找不到章节「' + raw + '」')
}

function readChapter (dir, token) {
  const { meta, chapters } = readBook(dir)
  const id = resolveChapter(meta, token)
  const html = chapters[id] || ''
  return {
    id,
    title: String((meta.chapterTitles && meta.chapterTitles[id]) || ''),
    kind: kindOfMeta(meta, id),
    label: bookLabel(meta, id),
    html,
    text: htmlText(html),
    words: countWords(textOf(html)),
    file: 'chapters/' + id + '.html'
  }
}

/* ---------- changing a book ---------- */

function darlingsDir (dir) {
  const d = safePath(dir, 'darlings')
  if (!d) throw new Error('书路径不合法')
  fs.mkdirSync(d, { recursive: true })
  return d
}

function backupChapter (dir, id, html, suffix) {
  const text = String(html || '')
  if (!htmlText(text).trim()) return null
  const d = darlingsDir(dir)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  let name = stamp + '-' + id + (suffix || '') + '.html'
  if (fs.existsSync(path.join(d, name))) name = stamp + '-' + id + '-' + Math.random().toString(36).slice(2, 6) + (suffix || '') + '.html'
  writeFileDurable(path.join(d, name), text)
  return 'darlings/' + name
}

function writeChapter (dir, token, opts) {
  opts = opts || {}
  const full = bookDir(dir)
  assertWritable(full)
  const meta = readMeta(full)
  const id = resolveChapter(meta, token)
  const file = chapterFile(full, id)
  let old = ''
  try { old = fs.readFileSync(file, 'utf8') } catch {}
  const backup = backupChapter(full, id, old, '-before-ai')
  const incoming = textToHtml(opts.text == null ? '' : opts.text, { html: !!opts.html })
  const html = opts.mode === 'append' ? appendHtml(old, incoming) : incoming
  writeFileDurable(file, html)
  return {
    id,
    title: String((meta.chapterTitles && meta.chapterTitles[id]) || ''),
    label: bookLabel(meta, id),
    words: countWords(textOf(html)),
    backup,
    file: 'chapters/' + id + '.html'
  }
}

function createChapter (dir, opts) {
  opts = opts || {}
  const full = bookDir(dir)
  assertWritable(full)
  const kind = opts.kind || 'chapter'
  if (!ALL_KINDS.has(kind)) throw new Error('未知的章节类型：' + kind)
  const meta = readMeta(full)
  const order = meta.chapterOrder
  const id = uniqueChapterId(full, new Set(order))
  writeFileDurable(chapterFile(full, id), '<p><br></p>')
  const at = typeof opts.before === 'string' && order.includes(opts.before)
    ? order.indexOf(opts.before)
    : order.length
  order.splice(at, 0, id)
  if (kind !== 'chapter') {
    meta.chapterKinds = meta.chapterKinds || {}
    meta.chapterKinds[id] = kind
  }
  const title = String(opts.title == null ? '' : opts.title).replace(/\s+/g, ' ').trim()
  if (title) {
    meta.chapterTitles = meta.chapterTitles || {}
    meta.chapterTitles[id] = title
  }
  writeMeta(full, meta)
  return { id, label: bookLabel(meta, id), kind, title, meta }
}

function renameChapter (dir, token, title) {
  const full = bookDir(dir)
  assertWritable(full)
  const meta = readMeta(full)
  const id = resolveChapter(meta, token)
  const clean = String(title == null ? '' : title).replace(/\s+/g, ' ').trim()
  meta.chapterTitles = meta.chapterTitles || {}
  if (clean) meta.chapterTitles[id] = clean
  else delete meta.chapterTitles[id]
  if (!Object.keys(meta.chapterTitles).length) delete meta.chapterTitles
  writeMeta(full, meta)
  return { id, title: clean, label: bookLabel(meta, id) }
}

function moveChapter (dir, token, before) {
  const full = bookDir(dir)
  assertWritable(full)
  const meta = readMeta(full)
  const order = meta.chapterOrder
  const id = resolveChapter(meta, token)
  const beforeId = before ? (order.includes(before) ? before : resolveChapter(meta, before)) : null
  if (beforeId === id) return { id, moved: false, meta }
  const copy = order.filter((chId) => chId !== id)
  if (beforeId) copy.splice(copy.indexOf(beforeId), 0, id)
  else copy.push(id)
  meta.chapterOrder = copy
  writeMeta(full, meta)
  return { id, moved: true, meta }
}

function deleteChapter (dir, token) {
  const full = bookDir(dir)
  assertWritable(full)
  const meta = readMeta(full)
  const id = resolveChapter(meta, token)
  if (meta.chapterOrder.length <= 1) throw new Error('一本书至少要留一章')
  // the name it had in the book, before its place and title are removed
  const label = bookLabel(meta, id)
  const source = chapterFile(full, id)
  const d = darlingsDir(full)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  let name = stamp + '-' + id + '.html'
  if (fs.existsSync(path.join(d, name))) name = stamp + '-' + id + '-' + Math.random().toString(36).slice(2, 6) + '.html'
  const dest = path.join(d, name)
  if (fs.existsSync(source)) fs.renameSync(source, dest)
  else writeFileDurable(dest, '')
  meta.chapterOrder = meta.chapterOrder.filter((chId) => chId !== id)
  if (meta.chapterKinds) delete meta.chapterKinds[id]
  if (meta.chapterTitles) delete meta.chapterTitles[id]
  if (meta.chapterNotes) delete meta.chapterNotes[id]
  writeMeta(full, meta)
  return { id, darlings: 'darlings/' + name, label }
}

function updateBookMeta (dir, opts) {
  opts = opts || {}
  const full = bookDir(dir)
  assertWritable(full)
  const meta = readMeta(full)
  if (opts.title != null) {
    const title = String(opts.title).replace(/\s+/g, ' ').trim()
    if (!title) throw new Error('书名不能为空')
    meta.title = title
  }
  if (opts.author != null) meta.author = String(opts.author).replace(/\s+/g, ' ').trim()
  if (opts.subtitle != null) meta.subtitle = String(opts.subtitle).replace(/\s+/g, ' ').trim()
  // publishing metadata: what EPUB, KDP and the cover read
  for (const key of ['series', 'language', 'isbn', 'publisher', 'rights']) {
    if (opts[key] != null) meta[key] = String(opts[key]).replace(/\s+/g, ' ').trim()
  }
  if (opts.seriesIndex != null) meta.seriesIndex = String(opts.seriesIndex).trim()
  if (opts.description != null) {
    meta.description = String(opts.description).replace(/\r\n?/g, '\n').trim()
  }
  if (opts.keywords != null) {
    meta.keywords = Array.isArray(opts.keywords)
      ? opts.keywords.map((x) => String(x).trim()).filter(Boolean)
      : String(opts.keywords).split(/[,，;；\n]/).map((x) => x.trim()).filter(Boolean)
  }
  if (opts.manuscript && typeof opts.manuscript === 'object') {
    meta.manuscript = { ...(meta.manuscript || {}), ...opts.manuscript }
  }
  writeMeta(full, meta)
  return meta
}

function createBook (parent, opts) {
  opts = opts || {}
  if (typeof parent !== 'string' || !parent) throw new Error('没有给出放置书籍的文件夹')
  const root = path.resolve(parent)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('放置书籍的文件夹不存在：' + root)
  const title = String(opts.title == null ? '' : opts.title).replace(/\s+/g, ' ').trim()
  if (!title) throw new Error('书名不能为空')
  const author = String(opts.author == null ? '' : opts.author).replace(/\s+/g, ' ').trim()
  const dir = path.join(root, plainName(title, 60))
  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir).filter((name) => name !== '.DS_Store' && name !== 'Thumbs.db')
    if (entries.length) throw new Error('同名文件夹已存在，换一个书名或位置')
  }

  const order = []
  const kinds = {}
  const taken = new Set()
  const now = new Date().toISOString()
  fs.mkdirSync(path.join(dir, 'chapters'), { recursive: true })
  for (const kind of TEMPLATE_KINDS) {
    const id = uniqueChapterId(dir, taken)
    taken.add(id)
    order.push(id)
    if (kind !== 'chapter') kinds[id] = kind
    writeFileDurable(path.join(dir, 'chapters', id + '.html'), '<p><br></p>')
  }
  const meta = {
    id: 'book-' + plainName(title, 40) + '-' + Math.random().toString(36).slice(2, 6),
    title,
    subtitle: '',
    series: '',
    seriesIndex: '',
    author,
    language: 'zh-CN',
    isbn: '',
    publisher: '',
    rights: '',
    description: '',
    keywords: [],
    wordGoal: 0,
    created: now,
    modified: now,
    chapterOrder: order,
    chapterKinds: kinds,
    chapterTitles: {},
    chapterNotes: {},
    wordCount: 0,
    dailyCounts: {},
    lastPosition: { chapterId: null, scroll: 0, at: Date.now(), tab: 'manuscript' },
    coverSeed: 'book-' + title + ':' + Math.random().toString(36).slice(2, 10)
  }
  writeFileDurable(path.join(dir, 'book.json'), JSON.stringify(meta, null, 2))
  return readBook(dir)
}

/* ---------- looking through a book ---------- */

function searchBook (dir, query, limit) {
  const q = String(query == null ? '' : query).trim()
  if (!q) throw new Error('搜索词不能为空')
  const max = Math.min(Math.max(Number(limit) || 20, 1), 200)
  const { meta, chapters } = readBook(dir)
  const lower = q.toLowerCase()
  const matches = []
  let total = 0
  for (const id of meta.chapterOrder) {
    const text = htmlText(chapters[id] || '')
    const hay = text.toLowerCase()
    let at = hay.indexOf(lower)
    while (at >= 0) {
      total++
      if (matches.length < max) {
        const start = Math.max(0, at - 40)
        const end = Math.min(text.length, at + q.length + 40)
        matches.push({
          chapterId: id,
          label: bookLabel(meta, id),
          snippet: (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : ''),
          at
        })
      }
      at = hay.indexOf(lower, at + Math.max(q.length, 1))
    }
  }
  return { query: q, total, matches }
}

function chapterInfo (meta, id, html) {
  const text = textOf(html || '')
  const full = htmlText(html || '')
  return {
    id,
    title: String((meta.chapterTitles && meta.chapterTitles[id]) || ''),
    kind: kindOfMeta(meta, id),
    label: bookLabel(meta, id),
    words: countWords(text),
    chars: full.length,
    file: 'chapters/' + id + '.html'
  }
}

function bookInfo (dir) {
  const { dir: full, name, meta, chapters } = readBook(dir)
  const list = meta.chapterOrder.map((id) => chapterInfo(meta, id, chapters[id]))
  let words = 0
  let chapterCount = 0
  for (const id of meta.chapterOrder) {
    const kind = kindOfMeta(meta, id)
    if (kind === 'chapter') chapterCount++
    if (STORY_WORD_KINDS.has(kind)) words += countWords(textOf(chapters[id] || ''))
  }
  const open = openSession()
  return {
    dir: full,
    name,
    title: meta.title || name,
    subtitle: meta.subtitle || '',
    series: meta.series || '',
    author: meta.author || '',
    wordGoal: meta.wordGoal || 0,
    created: meta.created || '',
    modified: meta.modified || '',
    openInSaga: !!(open && samePath(open.dir, full)),
    totals: { words, chapters: chapterCount, allChapters: list.length },
    chapters: list
  }
}

function listDarlings (dir) {
  const full = bookDir(dir)
  const d = path.join(full, 'darlings')
  if (!fs.existsSync(d)) return []
  return fs.readdirSync(d)
    .filter((name) => name.toLowerCase().endsWith('.html'))
    .map((name) => {
      const st = fs.statSync(path.join(d, name))
      return { name, size: st.size, modified: st.mtime.toISOString() }
    })
    .sort((a, b) => b.modified.localeCompare(a.modified))
}

/* ---------- comments ---------- */

const COVER_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif'
}

// the cover the writer picked, ready for the EPUB package; null when there is
// none or the file is gone
function coverPack (dir, meta) {
  const name = String((meta && meta.cover) || '').trim()
  if (!safeName(name)) return null
  const file = safePath(dir, name)
  if (!file || !fs.existsSync(file)) return null
  const mediaType = COVER_TYPES[path.extname(name).toLowerCase()]
  if (!mediaType) return null
  try {
    const st = fs.statSync(file)
    if (!st.isFile() || st.size > 40 * 1024 * 1024) return null
    return { name, data: fs.readFileSync(file), mediaType }
  } catch {
    return null
  }
}

function cleanComment (item) {
  if (!item || typeof item !== 'object') return null
  const chapterId = String(item.chapterId || '')
  if (!safeName(chapterId)) return null
  const quote = String(item.quote || '').slice(0, 2000)
  const note = String(item.note || '').slice(0, 5000)
  if (!quote.trim() || !note.trim()) return null
  return {
    id: String(item.id || '').slice(0, 80) || 'c-' + crypto.randomUUID(),
    chapterId,
    quote,
    prefix: String(item.prefix || '').slice(0, 80),
    suffix: String(item.suffix || '').slice(0, 80),
    start: Math.max(0, Number(item.start) || 0),
    end: Math.max(0, Number(item.end) || 0),
    note,
    resolved: !!item.resolved,
    createdAt: String(item.createdAt || new Date().toISOString())
  }
}

function readComments (dir) {
  const file = safePath(dir, 'comments.json')
  const data = file ? readJSON(file, null) : null
  return Array.isArray(data && data.items) ? data.items.map(cleanComment).filter(Boolean) : []
}

function writeCommentsFile (dir, items) {
  const file = safePath(dir, 'comments.json')
  if (!file) throw new Error('书路径不合法')
  const clean = items.map(cleanComment).filter(Boolean).slice(0, 5000)
  try { fs.copyFileSync(file, file + '.bak') } catch {}
  writeJSON(file, { version: 1, items: clean })
  return clean
}

function listComments (dir, chapterToken) {
  const full = bookDir(dir)
  const meta = readMeta(full)
  let items = readComments(full)
  if (chapterToken != null && String(chapterToken).trim()) {
    const chapterId = resolveChapter(meta, chapterToken)
    items = items.filter((c) => c.chapterId === chapterId)
  }
  const order = meta.chapterOrder
  items.sort((a, b) =>
    (order.indexOf(a.chapterId) < 0 ? 9999 : order.indexOf(a.chapterId)) -
    (order.indexOf(b.chapterId) < 0 ? 9999 : order.indexOf(b.chapterId)) ||
    (a.start || 0) - (b.start || 0))
  return {
    total: items.length,
    unresolved: items.filter((c) => !c.resolved).length,
    comments: items.map((c) => ({ ...c, chapterLabel: bookLabel(meta, c.chapterId) }))
  }
}

// an AI can add a note to a quote the writer can see; the anchor is worked out
// here, never written into the chapter file
function addComment (dir, opts) {
  opts = opts || {}
  const full = bookDir(dir)
  assertWritable(full)
  const meta = readMeta(full)
  const chapterId = resolveChapter(meta, opts.chapter)
  const file = chapterFile(full, chapterId)
  let html = ''
  try { html = fs.readFileSync(file, 'utf8') } catch {}
  const quote = String(opts.quote || '').trim()
  const note = String(opts.note || '').trim()
  if (!quote) throw new Error('缺少要批注的原文 quote')
  if (!note) throw new Error('缺少批注内容 note')
  const text = contentText(html)
  let start = -1
  const hinted = Number.isInteger(opts.start) ? opts.start : -1
  if (hinted >= 0 && text.startsWith(quote, hinted)) start = hinted
  if (start < 0) start = text.indexOf(quote)
  if (start < 0) throw new Error('这一章里找不到这段原文，请给一段更短、完全一致的 quote')
  const end = start + quote.length
  const comment = cleanComment({
    id: 'c-' + crypto.randomUUID(),
    chapterId,
    quote,
    prefix: text.slice(Math.max(0, start - 40), start),
    suffix: text.slice(end, end + 40),
    start,
    end,
    note,
    resolved: false,
    createdAt: new Date().toISOString()
  })
  const items = readComments(full)
  items.push(comment)
  writeCommentsFile(full, items)
  return { comment, chapter: bookLabel(meta, chapterId), total: items.length }
}

function setCommentResolved (dir, id, resolved) {
  const full = bookDir(dir)
  assertWritable(full)
  const items = readComments(full)
  const comment = items.find((c) => c.id === String(id))
  if (!comment) throw new Error('找不到这条批注')
  comment.resolved = resolved === undefined ? true : !!resolved
  writeCommentsFile(full, items)
  return { comment, total: items.length, unresolved: items.filter((c) => !c.resolved).length }
}

module.exports = {
  MAX_RECENT,
  KIND_LABEL,
  CONTENTS_SKIP,
  STORY_KINDS,
  STORY_WORD_KINDS,
  ALL_KINDS,
  ROMAN,
  TEMPLATE_KINDS,
  safeName,
  safePath,
  plainName,
  uniqueChapterId,
  samePath,
  readJSON,
  writeJSON,
  writeFileDurable,
  kindOfMeta,
  numberIn,
  bookLabel,
  contentsLines,
  htmlText,
  textOf,
  contentText,
  countWords,
  escapeHtml,
  textToHtml,
  appendHtml,
  userDataDir,
  settingsPath,
  sessionPath,
  readSettings,
  pidAlive,
  openSession,
  clearSession,
  assertWritable,
  unlock,
  listBooks,
  currentBookPath,
  bookDir,
  readMeta,
  readBook,
  writeMeta,
  resolveChapter,
  readChapter,
  backupChapter,
  writeChapter,
  createChapter,
  renameChapter,
  moveChapter,
  deleteChapter,
  updateBookMeta,
  createBook,
  searchBook,
  bookInfo,
  listDarlings,
  coverPack,
  readComments,
  writeCommentsFile,
  listComments,
  addComment,
  setCommentResolved
}
