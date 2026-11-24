'use strict'

/*  Saga — a book is a folder of plain files.

    The window never touches the disk. Everything goes through the handlers
    below, reached from the page through preload.js:

        index.html + app.js  →  preload.js (window.saga)  →  main.js  →  the book's folder

    Reads: book.json, then chapters/<id>.html. Writes: one chapter at a time,
    written to a .tmp file, fsynced, then renamed into place, so a power cut
    can never leave half a chapter behind. Saves are debounced in the window
    and flushed on switch, blur, and close.

    Electron 43, contextIsolation on, nodeIntegration off. No bundler.  */

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, clipboard } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')
const resourcesAi = process.resourcesPath ? path.join(process.resourcesPath, 'ai') : ''
const aiDir = resourcesAi && fs.existsSync(path.join(resourcesAi, 'book-formats.js'))
  ? resourcesAi
  : path.join(__dirname, 'ai')
const {
  fontOf, bookText, bookMarkdown, makeZip, epubFiles, docxFiles, htmlBook,
  rtfBook, odtFiles, latexBook, printHtml,
  KDP_TRIMS, KDP_PAPER, kdpInteriorHtml, kdpEstimateScript, kdpCoverHtml, pdfPageCount
} = require(path.join(aiDir, 'book-formats'))

let win = null
let currentDir = null      // the opened book's folder; the only folder we ever write in
let currentMeta = null
let closeReady = false

// the app's own faces, used by the print page and carried inside EPUBs
function fontsRoot () {
  return path.join(__dirname, 'fonts')
}

function fontsCssUrl () {
  return pathToFileURL(path.join(fontsRoot(), 'fonts.css')).href
}

function epubFontPack (fontKey) {
  const font = fontOf(fontKey)
  if (!font.dir) return {}
  const dir = path.join(fontsRoot(), font.dir)
  const cssFile = path.join(dir, font.css)
  const filesDir = path.join(dir, font.filesDir)
  if (!fs.existsSync(cssFile) || !fs.existsSync(filesDir)) return {}
  const fontEntries = fs.readdirSync(filesDir)
    .filter((name) => name.endsWith('.woff2'))
    .map((name) => ({
      name: 'fonts/' + font.dir + '/' + font.filesDir + '/' + name,
      data: fs.readFileSync(path.join(filesDir, name))
    }))
  return {
    font: fontKey,
    fontCss: fs.readFileSync(cssFile, 'utf8'),
    fontHref: 'fonts/' + font.dir + '/' + font.css,
    fontEntries
  }
}

// a second, windowless process prints a PDF/KDP pair for the CLI; it must not
// fight the window's single-instance lock or share its Chromium profile
const HEADLESS_EXPORT = process.argv.includes('--headless-export')
if (HEADLESS_EXPORT) {
  app.disableHardwareAcceleration()
  app.setPath('userData', path.join(os.tmpdir(), 'saga-headless-' + process.pid))
}

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
const sessionFile = () => path.join(app.getPath('userData'), 'ai-session.json')

// the open book, as the AI tools see it: a heartbeat, not a promise
let sessionTimer = null
function markSession (dir) {
  if (HEADLESS_EXPORT) return
  const beat = () => {
    try { writeJSON(sessionFile(), { pid: process.pid, dir, at: Date.now() }) } catch {}
  }
  beat()
  if (sessionTimer) clearInterval(sessionTimer)
  sessionTimer = setInterval(beat, 20000)
  if (sessionTimer.unref) sessionTimer.unref()
}

function stopSession () {
  if (sessionTimer) {
    clearInterval(sessionTimer)
    sessionTimer = null
  }
  try { fs.unlinkSync(sessionFile()) } catch {}
}

// the books opened here, newest first: enough to find yesterday's work,
// not so many that the list becomes a shelf
const MAX_RECENT = 12

// a book opened is a book remembered; its folder is the identity
function rememberBook (settings, dir, title) {
  const list = Array.isArray(settings.recent)
    ? settings.recent.filter((r) => r && typeof r.dir === 'string' && r.dir)
    : []
  return {
    ...settings,
    lastBook: dir,
    recent: [
      { dir, title: String(title || path.basename(dir)), at: Date.now() },
      ...list.filter((r) => r.dir !== dir)
    ].slice(0, MAX_RECENT)
  }
}

// the room follows the writer's choice: light unless night was chosen
const savedTheme = () => (readJSON(settingsFile(), {}).theme === 'dark' ? 'dark' : 'light')
const roomColor = (theme) => (theme === 'light' ? '#efede8' : '#191919')

// a plain trail in userData, so a failed import can be read after the fact
function logLine (text) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'saga.log'),
      new Date().toISOString() + ' ' + text + '\n')
  } catch {}
}

function readJSON (file, fallback) {
  for (const f of [file, file + '.bak']) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}
  }
  return fallback
}

function writeJSON (file, data) {
  const tmp = file + '.tmp'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2))
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
}

// one path segment, nothing else: no slashes, no dots that walk up
const safeName = (s) => typeof s === 'string' && s.length > 0 && s.length < 120 &&
  s !== '.' && s !== '..' && !/[\\/\0]/.test(s)

function safePath (dir, ...parts) {
  const full = path.resolve(dir, ...parts)
  const root = path.resolve(dir) + path.sep
  return full.startsWith(root) ? full : null
}

async function writeFileDurable (file, text) {
  const tmp = file + '.tmp'
  const fh = await fsp.open(tmp, 'w')
  try {
    await fh.writeFile(text, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fsp.rename(tmp, file)
}

// the app opens a book folder made by Saga, not a finished ebook
const BOOK_FOLDER_HINT = 'Saga 打开的是书稿文件夹（含 book.json 和 chapters/），不是 EPUB、PDF、TXT 等成品。'

async function loadBook (dir) {
  const metaFile = path.join(dir, 'book.json')
  const meta = readJSON(metaFile, null)
  if (!meta || !Array.isArray(meta.chapterOrder)) throw new Error('这个文件夹里没有 book.json。' + BOOK_FOLDER_HINT)
  if (!fs.existsSync(path.join(dir, 'chapters'))) throw new Error('这个文件夹缺少 chapters 文件夹。' + BOOK_FOLDER_HINT)
  const chapters = {}
  await Promise.all(meta.chapterOrder.map(async (chId) => {
    if (!safeName(chId)) return
    const file = safePath(dir, 'chapters', chId + '.html')
    if (!file) return
    try { chapters[chId] = await fsp.readFile(file, 'utf8') } catch { chapters[chId] = '' }
  }))
  return { dir, name: path.basename(dir), meta, chapters }
}

async function openBook (dir) {
  try {
    const data = await loadBook(dir)
    currentDir = dir
    currentMeta = data.meta
    const s = readJSON(settingsFile(), {})
    writeJSON(settingsFile(), rememberBook(s, dir, data.meta.title || data.name))
    markSession(dir)
    logLine('opened ' + dir + ' (' + data.meta.chapterOrder.length + ' chapters)')
    return data
  } catch (err) {
    logLine('open failed ' + dir + ': ' + (err && err.message ? err.message : err))
    throw err
  }
}

// the page turns on either the reply or this announcement, whichever lands
function announce (data) {
  if (!win || win.isDestroyed()) return
  win.webContents.send('book:opened', data)
  setTimeout(async () => {
    try {
      const st = await win.webContents.executeJavaScript(`({
        editor: !document.querySelector('#editor').hidden,
        welcome: !document.querySelector('#welcome').hidden,
        chapters: document.querySelectorAll('.chapter-item').length
      })`)
      logLine('ui after open: ' + JSON.stringify(st))
    } catch (err) {
      logLine('ui probe failed: ' + (err && err.message ? err.message : err))
    }
  }, 1200)
}

function createWindow () {
  const theme = savedTheme()
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: roomColor(theme),
    title: 'Saga',
    icon: path.join(__dirname, 'saga.ico'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win.show())
  // no menu bar at all: not ours, not Electron's default File/Edit/View/Window
  win.removeMenu()
  win.loadFile(path.join(__dirname, 'index.html'), { query: { theme } })
  // a window that never says it is ready still shows up (a slow GPU, a
  // driver that skips the event): never leave the writer with nothing
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show()
  }, 2000)
  win.webContents.on('render-process-gone', (_e, details) => {
    logLine('renderer gone: ' + JSON.stringify(details))
  })
  win.on('unresponsive', () => logLine('window unresponsive'))
  win.webContents.on('console-message', (event, level, message) => {
    const text = (event && typeof event === 'object' && 'message' in event) ? event.message : message
    if (text) logLine('console: ' + text)
  })

  // flush the chapter being typed before the window goes away
  win.on('close', (e) => {
    if (closeReady) return
    e.preventDefault()
    win.webContents.send('app:flush')
    const timer = setTimeout(() => { closeReady = true; win.destroy() }, 1200)
    ipcMain.once('ui:flushed', () => {
      clearTimeout(timer)
      closeReady = true
      win.destroy()
    })
  })
}

/*  Saga's own smoke test: `electron . --smoke <book folder>` copies the
    book to a temp folder, opens it, types into the first story chapter and
    checks the words reached the disk. The book itself is never touched.  */
function smokeArg () {
  const i = process.argv.indexOf('--smoke')
  if (i < 0) return null
  return process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null
}

// `--open <book folder>` goes in without the file dialog: the same code the
// dialog ends in, so a folder that opens here opens from the button too
function openDirFromArgv (argv) {
  const i = argv.indexOf('--open')
  if (i < 0) return null
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}

function openArg () {
  return openDirFromArgv(process.argv)
}

// `--pick-test <book folder>` answers the file dialog with that folder, then
// presses the import button and checks the editor came up: the button's whole
// path, everything but the OS dialog itself
function pickTestArg () {
  const i = process.argv.indexOf('--pick-test')
  if (i < 0) return null
  return process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null
}

function checkEditor (tag) {
  setTimeout(async () => {
    const info = await win.webContents.executeJavaScript(`({
      chapters: document.querySelectorAll('.nav-item').length,
      title: document.querySelector('#tp-title').textContent,
      shown: !document.querySelector('#editor').hidden,
      error: document.querySelector('#welcome-error').hidden ? '' : document.querySelector('#welcome-error').textContent
    })`)
    const ok = info.shown && info.chapters > 0
    console.log(tag + ' ' + (ok ? 'PASS' : 'FAIL') + ' chapters=' + info.chapters +
      ' title=' + info.title + ' error=' + JSON.stringify(info.error))
    app.exit(ok ? 0 : 1)
  }, 1400)
}

function runPickTest (dir) {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  win.webContents.once('did-finish-load', async () => {
    await win.webContents.executeJavaScript(`document.querySelector('#import-btn').click()`)
    checkEditor('PICKTEST')
  })
}

function runSmoke (sourceDir) {
  const copy = path.join(app.getPath('temp'), 'saga-smoke-' + Date.now())
  fs.cpSync(sourceDir, copy, { recursive: true })
  // the test goes the way a reader's second morning does: the folder is
  // remembered in settings, and the window asks for the last book
  const previous = readJSON(settingsFile(), {})
  writeJSON(settingsFile(), { ...previous, lastBook: copy })
  const started = Date.now()
  win.webContents.once('did-finish-load', () => {
    ipcMain.once('ui:ready', async (_e, info) => {
      const kinds = (readJSON(path.join(copy, 'book.json'), {}) || {}).chapterKinds || {}
      const order = (readJSON(path.join(copy, 'book.json'), {}) || {}).chapterOrder || []
      const story = new Set(['chapter', 'unnumbered', 'prologue', 'epilogue', 'extra'])
      const first = order.find((id) => story.has(kinds[id] || 'chapter'))
      await win.webContents.executeJavaScript(`(() => {
        const item = document.querySelector('#nav-list .nav-item[data-id="${first}"]')
        if (item) item.click()
        const body = document.querySelector('.chapter-body[data-id="${first}"]')
        body.focus()
        body.innerHTML = '<p>冒烟测试</p>'
        body.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      setTimeout(async () => {
        const saved = await fsp.readFile(path.join(copy, 'chapters', first + '.html'), 'utf8').catch(() => '')
        const ok = saved.includes('冒烟测试') && info.chapters === order.length
        console.log('SMOKE ' + (ok ? 'PASS' : 'FAIL') +
          ' chapters=' + info.chapters + ' ms=' + (Date.now() - started) +
          ' saved=' + JSON.stringify(saved.slice(0, 30)))
        writeJSON(settingsFile(), previous)
        fs.rmSync(copy, { recursive: true, force: true })
        app.exit(ok ? 0 : 1)
      }, 1400)
    })
  })
}

/*  A windowless export for the CLI: one process, no window on screen, the
    same print path the window uses. The request and its answer are JSON files
    in the temp folder, so Chinese paths and long titles never touch a command
    line.  */
function headlessArg (flag) {
  const i = process.argv.indexOf(flag)
  if (i < 0) return null
  return process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null
}

async function runHeadlessExport () {
  const reqFile = headlessArg('--headless-export')
  const resultFile = headlessArg('--headless-result')
  let result = { ok: false, error: '没有导出请求' }
  try {
    if (!reqFile) throw new Error('没有导出请求')
    const req = JSON.parse(fs.readFileSync(reqFile, 'utf8'))
    const data = await loadBook(req.book)

    if (req.kind === 'pdf') {
      if (!req.out) throw new Error('没有给出 PDF 输出路径')
      fs.mkdirSync(path.dirname(req.out), { recursive: true })
      const pdf = await htmlToPdf(printHtml(data.meta, data.chapters, {
        font: req.font,
        fontCss: fontsCssUrl()
      }), {
        print: {
          printBackground: true,
          pageSize: 'A4',
          margins: { top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 },
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#777;"><span class="pageNumber"></span></div>'
        }
      })
      await fsp.writeFile(req.out, pdf.buffer)
      result = { ok: true, file: req.out, pages: pdfPageCount(pdf.buffer) || null }
    } else if (req.kind === 'kdp') {
      if (!req.outDir) throw new Error('没有给出 KDP 输出文件夹')
      fs.mkdirSync(req.outDir, { recursive: true })
      const trim = KDP_TRIMS[req.trim] || KDP_TRIMS['6x9']
      const paper = req.paper === 'cream' ? 'cream' : 'white'
      const base = plainName(data.meta.title || '未命名')
      const interiorFile = path.join(req.outDir, base + '-内页.pdf')
      const coverFile = path.join(req.outDir, base + '-封面模板.pdf')

      const interior = await htmlToPdf(kdpInteriorHtml(data.meta, data.chapters, {
        font: req.font,
        fontCss: fontsCssUrl()
      }), {
        measure: kdpEstimateScript(trim),
        print: {
          printBackground: true,
          // Electron 43 reads a custom page size in inches, not microns
          pageSize: { width: trim.w, height: trim.h },
          margins: { top: 0.75, bottom: 0.75, left: 0.875, right: 0.875 },
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#555;"><span class="pageNumber"></span></div>'
        }
      })
      await fsp.writeFile(interiorFile, interior.buffer)
      const pages = pdfPageCount(interior.buffer) || interior.estimate || 1
      const spine = Math.round(pages * KDP_PAPER[paper] * 1000) / 1000

      const cover = await htmlToPdf(kdpCoverHtml(data.meta, pages, spine, trim), {
        print: {
          printBackground: true,
          preferCSSPageSize: true,
          margins: { top: 0, bottom: 0, left: 0, right: 0 }
        }
      })
      await fsp.writeFile(coverFile, cover.buffer)
      const warning = pages > 828
        ? '超过 KDP 单册 828 页上限'
        : pages < 24
          ? '少于 KDP 最少 24 页'
          : ''
      result = { ok: true, interior: interiorFile, cover: coverFile, pages, spine, warning }
    } else {
      throw new Error('未知的导出类型：' + req.kind)
    }
  } catch (err) {
    result = { ok: false, error: err && err.message ? err.message : String(err) }
  }
  if (resultFile) {
    try { writeJSON(resultFile, result) } catch {}
  }
  // Chromium still holds its profile while this process lives; a short-lived
  // Node child removes the temp folder once the locks are gone
  cleanHeadlessProfileLater()
  app.exit(result.ok ? 0 : 1)
}

function cleanHeadlessProfileLater () {
  const dir = app.getPath('userData')
  const code = 'setTimeout(() => { try { require("node:fs").rmSync(process.argv[process.argv.length - 1], { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch {} }, 1500)'
  try {
    const child = spawn(process.execPath, ['-e', code, dir], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    child.unref()
  } catch {}
}

// one window, not a pile of them: a second double-click brings the window
// back to the front instead of doing nothing visible
if (!HEADLESS_EXPORT) {
  if (!app.requestSingleInstanceLock()) {
    app.exit(0)
  } else {
    app.on('second-instance', (_event, argv) => {
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      const dir = openDirFromArgv(argv)
      if (dir) {
        openBook(dir).then(announce).catch((err) => {
          logLine('second open failed ' + dir + ': ' + (err && err.message ? err.message : err))
        })
      }
    })
  }
}

app.whenReady().then(() => {
  if (HEADLESS_EXPORT) {
    runHeadlessExport()
    return
  }
  // no menu bar: the window is the book. 设置 and 简介 live in the page.
  Menu.setApplicationMenu(null)
  nativeTheme.themeSource = savedTheme()
  const source = smokeArg()
  const openDir = openArg()
  const pickDir = pickTestArg()
  if (source) {
    if (!fs.existsSync(path.join(source, 'book.json'))) {
      console.log('SMOKE FAIL no book.json in ' + source)
      app.exit(1)
      return
    }
    createWindow()
    runSmoke(source)
  } else if (pickDir) {
    createWindow()
    runPickTest(pickDir)
  } else if (openDir) {
    createWindow()
    win.webContents.once('did-finish-load', async () => {
      try {
        const data = await openBook(openDir)
        win.webContents.send('book:opened', data)
        setTimeout(async () => {
          const info = await win.webContents.executeJavaScript(`({
            chapters: document.querySelectorAll('.nav-item').length,
            title: document.querySelector('#tp-title').textContent,
            shown: !document.querySelector('#editor').hidden
          })`)
          const ok = info.shown && info.chapters === data.meta.chapterOrder.length
          console.log('OPEN ' + (ok ? 'OK' : 'FAIL') + ' chapters=' + info.chapters +
            ' title=' + info.title + ' welcome=' + !info.shown)
          app.exit(ok ? 0 : 1)
        }, 700)
      } catch (err) {
        console.log('OPEN FAIL ' + err.message)
        app.exit(1)
      }
    })
  } else {
    createWindow()
  }
})

app.on('window-all-closed', () => {
  if (HEADLESS_EXPORT) return
  stopSession()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', stopSession)

app.on('will-quit', () => {
  if (!HEADLESS_EXPORT) return
  try {
    fs.rmSync(app.getPath('userData'), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch {}
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.on('ui:log', (_e, text) => logLine('ui: ' + text))

ipcMain.handle('clipboard:write', async (_e, text) => {
  clipboard.writeText(String(text == null ? '' : text))
  return true
})

ipcMain.handle('book:pick', async () => {
  win.focus()
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '打开 Saga 书稿文件夹',
      message: '选择包含 book.json 和 chapters/ 的 Saga 书稿文件夹。EPUB、PDF、TXT 等成品不能直接打开。',
      buttonLabel: '打开',
      properties: ['openDirectory']
    })
    console.log('[saga] pick canceled=' + canceled + ' paths=' + JSON.stringify(filePaths))
    logLine('pick canceled=' + canceled + ' paths=' + JSON.stringify(filePaths))
    if (canceled || !filePaths.length) return null
    const data = await openBook(filePaths[0])
    announce(data)
    return data
  } catch (err) {
    console.log('[saga] pick failed: ' + (err && err.stack ? err.stack : err))
    logLine('pick failed: ' + (err && err.message ? err.message : err))
    dialog.showMessageBox(win, {
      type: 'warning',
      message: '无法打开这个文件夹',
      detail: String(err && err.message ? err.message : err)
    })
    return null
  }
})

// a folder dropped on the window comes in the same way the dialog's choice does
ipcMain.handle('book:openPath', async (_e, dir) => {
  if (typeof dir !== 'string' || !dir) throw new Error('没有给出文件夹')
  const data = await openBook(dir)
  announce(data)
  return data
})

// the example book travels with the app; the first open copies it where the
// writer can edit it, then opens that copy
ipcMain.handle('example:open', async () => {
  const packaged = process.resourcesPath
    ? path.join(process.resourcesPath, 'example', '小城畸人')
    : ''
  const bundled = packaged && fs.existsSync(path.join(packaged, 'book.json'))
    ? packaged
    : path.join(__dirname, 'example', '小城畸人')
  if (!fs.existsSync(path.join(bundled, 'book.json'))) throw new Error('示例书没有随应用找到')
  const root = path.join(app.getPath('documents'), 'Saga 示例')
  const dest = path.join(root, '小城畸人')
  const valid = fs.existsSync(path.join(dest, 'book.json')) && fs.existsSync(path.join(dest, 'chapters'))
  if (!valid) {
    try { fs.rmSync(dest, { recursive: true, force: true }) } catch {}
    fs.mkdirSync(root, { recursive: true })
    fs.cpSync(bundled, dest, { recursive: true })
  }
  const data = await openBook(dest)
  return data
})

ipcMain.handle('book:last', async () => {
  const s = readJSON(settingsFile(), {})
  if (!s.lastBook || typeof s.lastBook !== 'string') { logLine('last: none remembered'); return null }
  if (!fs.existsSync(path.join(s.lastBook, 'book.json'))) {
    logLine('last: missing ' + s.lastBook)
    return null
  }
  try {
    const data = await loadBook(s.lastBook)
    // a book remembered from last time is as open as one just picked
    currentDir = s.lastBook
    currentMeta = data.meta
    markSession(s.lastBook)
    // keep its name in the list fresh (and a book remembered from before
    // the list existed enters it now), without a write when nothing changed
    const title = data.meta.title || data.name
    const entry = (Array.isArray(s.recent) ? s.recent : []).find((r) => r && r.dir === s.lastBook)
    if (!entry || entry.title !== title) {
      writeJSON(settingsFile(), rememberBook(s, s.lastBook, title))
    }
    logLine('last: opened ' + s.lastBook + ' (' + data.meta.chapterOrder.length + ')')
    return data
  } catch (err) {
    logLine('last: failed ' + s.lastBook + ' — ' + (err && err.message ? err.message : err))
    return null
  }
})

// the editor's back button is a real close: the AI tools may write again
ipcMain.handle('book:close', async () => {
  currentDir = null
  currentMeta = null
  stopSession()
  return true
})

// what the AI dialog shows: paths the user can copy into a client
ipcMain.handle('ai:info', async () => {
  const packaged = !!(process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'ai', 'book-formats.js')))
  const portable = !!process.env.PORTABLE_EXECUTABLE_DIR
  const cliScript = path.join(aiDir, 'cli.js')
  const cliCmd = process.platform === 'win32' ? path.join(aiDir, 'saga.cmd') : cliScript
  const invoke = process.platform === 'win32' && packaged
    ? '"' + cliCmd + '"'
    : 'node "' + cliScript + '"'
  const mcpPath = path.join(aiDir, 'mcp-server.js')
  const mcpConfig = {
    mcpServers: {
      saga: {
        command: process.execPath,
        args: [mcpPath],
        env: { ELECTRON_RUN_AS_NODE: '1' }
      }
    }
  }
  return {
    version: app.getVersion(),
    packaged,
    portable,
    appPath: process.execPath,
    aiDir,
    cliPath: cliScript,
    cliCmd,
    mcpPath,
    mcpConfig,
    mcpJson: JSON.stringify(mcpConfig, null, 2),
    examples: [
      invoke + ' books',
      invoke + ' info "<书文件夹>"',
      invoke + ' read "<书文件夹>" 1',
      invoke + ' write "<书文件夹>" 1 --text draft.txt',
      invoke + ' export "<书文件夹>" --format epub --out "<输出.epub>"'
    ]
  }
})

// the welcome page's list: books that are still where they were left
ipcMain.handle('books:recent', async () => {
  const s = readJSON(settingsFile(), {})
  const list = Array.isArray(s.recent) ? s.recent : []
  return list
    .filter((r) => r && typeof r.dir === 'string' && r.dir && fs.existsSync(path.join(r.dir, 'book.json')))
    .map((r) => ({ dir: r.dir, title: r.title || path.basename(r.dir) }))
})

// forgetting a record never touches the book's folder: the list only lets
// go of the way back, and the next book becomes the one to reopen
ipcMain.handle('book:forget', async (_e, dir) => {
  const s = readJSON(settingsFile(), {})
  const list = Array.isArray(s.recent)
    ? s.recent.filter((r) => r && typeof r.dir === 'string' && r.dir)
    : []
  if (typeof dir === 'string' && dir) {
    s.recent = list.filter((r) => r.dir !== dir)
    if (s.lastBook === dir) {
      if (s.recent.length) s.lastBook = s.recent[0].dir
      else delete s.lastBook
    }
  } else {
    s.recent = []
    delete s.lastBook
  }
  writeJSON(settingsFile(), s)
  logLine('recent: record cleared')
  return true
})

// a chapter's name lives in book.json's chapterTitles; the chapter file
// itself holds only its words
ipcMain.handle('book:title', async (_e, chId, title) => {
  if (!currentDir || !currentMeta) throw new Error('没有打开的书')
  if (!safeName(chId)) throw new Error('章节名不合法')
  if (!currentMeta.chapterOrder.includes(chId)) throw new Error('章节不在书里')
  const file = safePath(currentDir, 'book.json')
  if (!file) throw new Error('书路径不合法')
  const meta = readJSON(file, null)
  if (!meta || !Array.isArray(meta.chapterOrder)) throw new Error('book.json 读不出来')
  const clean = String(title == null ? '' : title).replace(/\s+/g, ' ').trim()
  meta.chapterTitles = meta.chapterTitles || {}
  const before = meta.chapterTitles[chId] || ''
  if (before === clean) {
    currentMeta = meta
    return true
  }
  if (clean) meta.chapterTitles[chId] = clean
  else delete meta.chapterTitles[chId]
  if (!Object.keys(meta.chapterTitles).length) delete meta.chapterTitles
  // keep the last whole book.json beside it, as every library write does
  try { fs.copyFileSync(file, file + '.bak') } catch {}
  await writeFileDurable(file, JSON.stringify(meta, null, 2))
  currentMeta = meta
  return true
})

// the room's light or dark, kept for the next launch: the window's own
// frame follows it too, so a light page never opens under a night window
ipcMain.handle('app:theme', async (_e, theme) => {
  const t = theme === 'light' ? 'light' : 'dark'
  nativeTheme.themeSource = t
  if (win && !win.isDestroyed()) win.setBackgroundColor(roomColor(t))
  const s = readJSON(settingsFile(), {})
  if (s.theme !== t) {
    s.theme = t
    writeJSON(settingsFile(), s)
  }
  return t
})

ipcMain.handle('chapter:write', async (_e, chId, html) => {
  if (!currentDir || !currentMeta) throw new Error('没有打开的书')
  if (!safeName(chId)) throw new Error('章节名不合法')
  if (!currentMeta.chapterOrder.includes(chId)) throw new Error('章节不在书里')
  const file = safePath(currentDir, 'chapters', chId + '.html')
  if (!file) throw new Error('章节路径不合法')
  await writeFileDurable(file, String(html == null ? '' : html))
  return true
})

/* ---------- the book's shape ---------- */

const KIND_LABEL = {
  copyright: '版权', dedication: '献辞', epigraph: '题词', contents: '目录',
  opening: '卷首语', foreword: '前言', prologue: '序章', part: '部分',
  unnumbered: '未命名章节', epilogue: '尾声', extra: '番外',
  afterword: '后记', acknowledgments: '致谢', about: '关于作者'
}
const CONTENTS_SKIP = ['copyright', 'dedication', 'epigraph', 'contents']
const STORY_KINDS = new Set(['chapter', 'part', 'prologue', 'unnumbered', 'epilogue', 'extra'])
const ALL_KINDS = new Set([...Object.keys(KIND_LABEL), 'chapter'])
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX']

// the shelf the template keeps: front pages, three parts of three chapters,
// three unnumbered pieces, extras, and the closing pages
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

function requireBook () {
  if (!currentDir || !currentMeta) throw new Error('没有打开的书')
}

function readMeta () {
  requireBook()
  const meta = readJSON(path.join(currentDir, 'book.json'), null)
  if (!meta || !Array.isArray(meta.chapterOrder)) throw new Error('book.json 读不出来')
  return meta
}

async function writeMeta (meta) {
  const file = path.join(currentDir, 'book.json')
  meta.modified = new Date().toISOString()
  try { fs.copyFileSync(file, file + '.bak') } catch {}
  await writeFileDurable(file, JSON.stringify(meta, null, 2))
  currentMeta = meta
}

const kindOfMeta = (meta, id) => (meta.chapterKinds && meta.chapterKinds[id]) || 'chapter'

function numberIn (meta, id, kind) {
  let n = 0
  for (const chId of meta.chapterOrder) {
    if (kindOfMeta(meta, chId) === kind) n++
    if (chId === id) break
  }
  return n
}

function bookLabel (meta, id) {
  const kind = kindOfMeta(meta, id)
  const titled = String((meta.chapterTitles && meta.chapterTitles[id]) || '').trim()
  if (kind === 'chapter') {
    const n = numberIn(meta, id, 'chapter')
    return titled ? '第 ' + n + ' 章 · ' + titled : '第 ' + n + ' 章'
  }
  if (kind === 'part') {
    const n = numberIn(meta, id, 'part')
    const name = '第 ' + (ROMAN[n] || n) + ' 部分'
    return titled ? name + ' · ' + titled : name
  }
  if (kind === 'unnumbered') return titled || '未命名'
  return KIND_LABEL[kind] || kind
}

// one fresh chapter name, its file never in the way
function uniqueChapterId (dir, taken) {
  let id
  do {
    id = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
  } while (taken.has(id) || fs.existsSync(path.join(dir, 'chapters', id + '.html')))
  return id
}

// a name that can be a folder or a file on Windows
function plainName (text, max) {
  const clean = String(text == null ? '' : text)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
  return (clean || '未命名').slice(0, max || 80)
}

ipcMain.handle('chapter:create', async (_e, kind, beforeId) => {
  requireBook()
  if (!ALL_KINDS.has(kind)) throw new Error('未知的章节类型')
  const meta = readMeta()
  const order = meta.chapterOrder
  const id = uniqueChapterId(currentDir, new Set(order))
  const file = safePath(currentDir, 'chapters', id + '.html')
  if (!file) throw new Error('章节路径不合法')
  await writeFileDurable(file, '<p><br></p>')

  // the page goes exactly where the pane's plus stands; no plus, the end
  const at = typeof beforeId === 'string' && order.includes(beforeId)
    ? order.indexOf(beforeId)
    : order.length
  order.splice(at, 0, id)
  if (kind !== 'chapter') {
    meta.chapterKinds = meta.chapterKinds || {}
    meta.chapterKinds[id] = kind
  }
  meta.modified = new Date().toISOString()
  await writeMeta(meta)
  return { id, meta }
})

ipcMain.handle('chapter:delete', async (_e, chId) => {
  requireBook()
  if (!safeName(chId)) throw new Error('章节名不合法')
  const meta = readMeta()
  if (!meta.chapterOrder.includes(chId)) throw new Error('章节不在书里')
  if (meta.chapterOrder.length <= 1) throw new Error('一本书至少要留一章')
  const source = safePath(currentDir, 'chapters', chId + '.html')
  if (!source) throw new Error('章节路径不合法')

  // the words leave the book, never the folder: they wait in darlings/
  const darlings = safePath(currentDir, 'darlings')
  if (!darlings) throw new Error('书路径不合法')
  fs.mkdirSync(darlings, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = safePath(currentDir, 'darlings', stamp + '-' + chId + '.html')
  if (!dest) throw new Error('回收路径不合法')
  if (fs.existsSync(source)) fs.renameSync(source, dest)
  else await writeFileDurable(dest, '')

  meta.chapterOrder = meta.chapterOrder.filter((id) => id !== chId)
  if (meta.chapterKinds) delete meta.chapterKinds[chId]
  if (meta.chapterTitles) delete meta.chapterTitles[chId]
  if (meta.chapterNotes) delete meta.chapterNotes[chId]
  meta.modified = new Date().toISOString()
  await writeMeta(meta)
  return { meta, darlings: 'darlings/' + path.basename(dest) }
})

ipcMain.handle('chapter:move', async (_e, chId, beforeId) => {
  requireBook()
  if (!safeName(chId)) throw new Error('章节名不合法')
  const meta = readMeta()
  const order = meta.chapterOrder
  if (!order.includes(chId)) throw new Error('章节不在书里')
  if (beforeId && !order.includes(beforeId)) throw new Error('目标章节不在书里')
  if (beforeId === chId) return meta
  const from = order.indexOf(chId)
  const copy = order.slice()
  copy.splice(from, 1)
  const at = beforeId ? copy.indexOf(beforeId) : copy.length
  copy.splice(at, 0, chId)
  meta.chapterOrder = copy
  meta.modified = new Date().toISOString()
  await writeMeta(meta)
  return meta
})

/* ---------- a new book, shaped like the template ---------- */

ipcMain.handle('book:create', async (_e, opts) => {
  const title = String((opts && opts.title) || '').replace(/\s+/g, ' ').trim()
  if (!title) throw new Error('书名不能为空')
  const author = String((opts && opts.author) || '').replace(/\s+/g, ' ').trim()
  const picked = await dialog.showOpenDialog(win, {
    title: '选择这本书放在哪里',
    message: '会在所选文件夹里按 Saga 模板新建一个书稿文件夹',
    buttonLabel: '在这里新建',
    properties: ['openDirectory', 'createDirectory']
  })
  if (picked.canceled || !picked.filePaths.length) return null
  const dir = path.join(picked.filePaths[0], plainName(title, 60))
  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir).filter((name) => name !== '.DS_Store' && name !== 'Thumbs.db')
    if (entries.length) throw new Error('同名文件夹已存在，换一个书名或位置')
  }

  const order = []
  const kinds = {}
  const taken = new Set()
  const now = new Date().toISOString()
  try {
    fs.mkdirSync(path.join(dir, 'chapters'), { recursive: true })
    for (const kind of TEMPLATE_KINDS) {
      const id = uniqueChapterId(dir, taken)
      taken.add(id)
      order.push(id)
      if (kind !== 'chapter') kinds[id] = kind
      await writeFileDurable(path.join(dir, 'chapters', id + '.html'), '<p><br></p>')
    }
    const meta = {
      id: 'book-' + plainName(title, 40) + '-' + Math.random().toString(36).slice(2, 6),
      title,
      subtitle: '',
      series: '',
      author,
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
    await writeFileDurable(path.join(dir, 'book.json'), JSON.stringify(meta, null, 2))
  } catch (err) {
    logLine('create failed ' + dir + ': ' + (err && err.message ? err.message : err))
    throw err
  }

  const data = await loadBook(dir)
  currentDir = dir
  currentMeta = data.meta
  markSession(dir)
  const s = readJSON(settingsFile(), {})
  writeJSON(settingsFile(), rememberBook(s, dir, data.meta.title || data.name))
  logLine('created ' + dir + ' (' + order.length + ' chapters)')
  return data
})

/* ---------- taking the book out ---------- */

function readBookFromDisk () {
  const meta = readMeta()
  const chapters = {}
  for (const id of meta.chapterOrder) {
    if (!safeName(id)) continue
    const file = safePath(currentDir, 'chapters', id + '.html')
    if (!file) continue
    try { chapters[id] = fs.readFileSync(file, 'utf8') } catch { chapters[id] = '' }
  }
  return { meta, chapters }
}

async function htmlToPdf (html, options) {
  const tmp = path.join(app.getPath('temp'), 'saga-print-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.html')
  await fsp.writeFile(tmp, html, 'utf8')
  const printWin = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false }
  })
  try {
    await printWin.loadFile(tmp)
    await new Promise((resolve) => setTimeout(resolve, 250))
    let estimate = null
    if (options.measure) estimate = await printWin.webContents.executeJavaScript(options.measure)
    const pdf = await printWin.webContents.printToPDF(options.print)
    return { buffer: pdf, estimate }
  } finally {
    try { printWin.destroy() } catch {}
    try { fs.unlinkSync(tmp) } catch {}
  }
}

ipcMain.handle('export:kdp', async (_e, opts) => {
  requireBook()
  const trim = KDP_TRIMS[opts && opts.trim] || KDP_TRIMS['6x9']
  const paper = opts && opts.paper === 'cream' ? 'cream' : 'white'
  const { meta, chapters } = readBookFromDisk()
  const base = plainName(meta.title || '未命名')
  const interiorFile = await askExportPath(base + '-内页', '.pdf', 'PDF')
  if (!interiorFile) return { canceled: true }
  const coverFile = await askExportPath(base + '-封面模板', '.pdf', 'PDF')
  if (!coverFile) return { canceled: true }

  const interior = await htmlToPdf(kdpInteriorHtml(meta, chapters, {
    font: opts && opts.font,
    fontCss: fontsCssUrl()
  }), {
    measure: kdpEstimateScript(trim),
    print: {
      printBackground: true,
      // Electron 43 reads a custom page size in inches, not microns
      pageSize: { width: trim.w, height: trim.h },
      margins: { top: 0.75, bottom: 0.75, left: 0.875, right: 0.875 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#555;"><span class="pageNumber"></span></div>'
    }
  })
  await fsp.writeFile(interiorFile, interior.buffer)
  const pages = pdfPageCount(interior.buffer) || interior.estimate || 1
  const spine = Math.round(pages * KDP_PAPER[paper] * 1000) / 1000

  const cover = await htmlToPdf(kdpCoverHtml(meta, pages, spine, trim), {
    print: {
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    }
  })
  await fsp.writeFile(coverFile, cover.buffer)
  rememberExportDir(interiorFile)
  const warning = pages > 828
    ? '超过 KDP 单册 828 页上限'
    : pages < 24
      ? '少于 KDP 最少 24 页'
      : ''
  return { interior: interiorFile, cover: coverFile, pages, spine, warning }
})

function exportDirDefault () {
  const s = readJSON(settingsFile(), {})
  return typeof s.exportDir === 'string' && fs.existsSync(s.exportDir) ? s.exportDir : app.getPath('documents')
}

async function askExportPath (name, ext, filterName) {
  const picked = await dialog.showSaveDialog(win, {
    title: '导出',
    defaultPath: path.join(exportDirDefault(), name + ext),
    filters: [{ name: filterName, extensions: [ext.slice(1)] }]
  })
  if (picked.canceled || !picked.filePath) return null
  let file = picked.filePath
  if (!file.toLowerCase().endsWith(ext)) file += ext
  return file
}

function rememberExportDir (file) {
  const s = readJSON(settingsFile(), {})
  s.exportDir = path.dirname(file)
  writeJSON(settingsFile(), s)
}

ipcMain.handle('export:text', async (_e, format) => {
  requireBook()
  const { meta, chapters } = readBookFromDisk()
  const md = format === 'md'
  const text = md ? bookMarkdown(meta, chapters) : bookText(meta, chapters)
  const file = await askExportPath(plainName(meta.title || '未命名'), md ? '.md' : '.txt', md ? 'Markdown' : '文本')
  if (!file) return { canceled: true }
  await fsp.writeFile(file, text, 'utf8')
  rememberExportDir(file)
  return { file }
})

ipcMain.handle('export:epub', async (_e, opts = {}) => {
  requireBook()
  const { meta, chapters } = readBookFromDisk()
  const file = await askExportPath(plainName(meta.title || '未命名'), '.epub', 'EPUB')
  if (!file) return { canceled: true }
  await fsp.writeFile(file, makeZip(epubFiles(meta, chapters, epubFontPack(opts.font))))
  rememberExportDir(file)
  return { file }
})

ipcMain.handle('export:docx', async (_e, opts = {}) => {
  requireBook()
  const { meta, chapters } = readBookFromDisk()
  const file = await askExportPath(plainName(meta.title || '未命名'), '.docx', 'Word')
  if (!file) return { canceled: true }
  await fsp.writeFile(file, makeZip(docxFiles(meta, chapters, opts.font)))
  rememberExportDir(file)
  return { file }
})

ipcMain.handle('export:html', async (_e, opts = {}) => {
  requireBook()
  const { meta, chapters } = readBookFromDisk()
  const file = await askExportPath(plainName(meta.title || '未命名'), '.html', '网页')
  if (!file) return { canceled: true }
  await fsp.writeFile(file, htmlBook(meta, chapters, opts.font), 'utf8')
  rememberExportDir(file)
  return { file }
})

ipcMain.handle('export:rtf', async (_e, opts = {}) => {
  requireBook()
  const { meta, chapters } = readBookFromDisk()
  const file = await askExportPath(plainName(meta.title || '未命名'), '.rtf', 'RTF')
  if (!file) return { canceled: true }
  await fsp.writeFile(file, rtfBook(meta, chapters, opts.font), 'utf8')
  rememberExportDir(file)
  return { file }
})

ipcMain.handle('export:odt', async (_e, opts = {}) => {
  requireBook()
  const { meta, chapters } = readBookFromDisk()
  const file = await askExportPath(plainName(meta.title || '未命名'), '.odt', 'ODT')
  if (!file) return { canceled: true }
  await fsp.writeFile(file, makeZip(odtFiles(meta, chapters, opts.font)))
  rememberExportDir(file)
  return { file }
})

ipcMain.handle('export:latex', async (_e, opts = {}) => {
  requireBook()
  const { meta, chapters } = readBookFromDisk()
  const file = await askExportPath(plainName(meta.title || '未命名'), '.tex', 'LaTeX')
  if (!file) return { canceled: true }
  await fsp.writeFile(file, latexBook(meta, chapters, opts.font), 'utf8')
  rememberExportDir(file)
  return { file }
})

ipcMain.handle('export:pdf', async (_e, opts = {}) => {
  requireBook()
  const { meta, chapters } = readBookFromDisk()
  const file = await askExportPath(plainName(meta.title || '未命名'), '.pdf', 'PDF')
  if (!file) return { canceled: true }
  const html = printHtml(meta, chapters, { font: opts.font, fontCss: fontsCssUrl() })
  const tmp = path.join(app.getPath('temp'), 'saga-print-' + Date.now() + '.html')
  await fsp.writeFile(tmp, html, 'utf8')
  const printWin = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false }
  })
  try {
    await printWin.loadFile(tmp)
    await new Promise((resolve) => setTimeout(resolve, 250))
    const pdf = await printWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#777;"><span class="pageNumber"></span></div>'
    })
    await fsp.writeFile(file, pdf)
    rememberExportDir(file)
    return { file }
  } finally {
    try { printWin.destroy() } catch {}
    try { fs.unlinkSync(tmp) } catch {}
  }
})
