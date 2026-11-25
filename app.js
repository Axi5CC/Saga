'use strict'

/*  The window's half of the editor: one long manuscript (the title page,
    then every chapter as a sheet), a left pane that lists the book and jumps
    through it, and a bar of the day's numbers. The window never touches the
    disk; it asks window.saga.  */

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)

/* ---------- the room's theme ---------- */

// the main process keeps the choice in settings.json and hands it in with
// the page's URL, so the first paint is already the right room
function initialTheme () {
  return new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light'
}

function applyTheme (theme) {
  const t = theme === 'dark' ? 'dark' : 'light'
  document.documentElement.dataset.theme = t
  for (const b of $$('#theme-choice .theme-opt')) b.classList.toggle('on', b.dataset.theme === t)
  // the window's own frame follows, and the choice is kept for next launch
  if (window.saga && window.saga.setTheme) window.saga.setTheme(t).catch(() => {})
}

applyTheme(initialTheme())

/* ---------- the paper's typeface ---------- */

const FONT_STACKS = {
  serif: '"Noto Serif SC", Georgia, "Times New Roman", "Songti SC", "SimSun", serif',
  sans: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Helvetica Neue", sans-serif',
  kai: '"LXGW WenKai Lite", "KaiTi", "STKaiti", "Songti SC", serif',
  fangsong: '"Zhuque Fangsong", "FangSong", "STFangsong", "Songti SC", serif',
  xiaowei: '"ZCOOL XiaoWei", "Songti SC", "SimSun", serif',
  brush: '"Ma Shan Zheng", "KaiTi", "STKaiti", cursive',
  smiley: '"Smiley Sans", "Microsoft YaHei", "PingFang SC", sans-serif',
  system: 'Georgia, "Times New Roman", "Songti SC", "SimSun", serif'
}

let currentFont = 'serif'

// pages are observed as they come near the viewport; a font change only
// repaints what is on screen, and the next pages pick it up as they approach
const fontObserver = new IntersectionObserver((entries) => {
  const stack = FONT_STACKS[currentFont]
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    if (entry.target.style.getPropertyValue('--book-font') !== stack) {
      entry.target.style.setProperty('--book-font', stack)
    }
  }
}, { root: $('#stage'), rootMargin: '100% 0px' })

function applyFont (name) {
  const font = FONT_STACKS[name] ? name : 'serif'
  const stack = FONT_STACKS[font]
  currentFont = font
  document.documentElement.dataset.font = font
  try { localStorage.setItem('saga.font', font) } catch {}
  for (const btn of $$('#font-choice .font-opt')) {
    btn.classList.toggle('on', btn.dataset.font === font)
  }

  // the whole manuscript is in the DOM; only repaint the pages near the
  // viewport, the observer handles the rest as they are scrolled toward
  const chapters = $$('#chapters .chapter')
  const vh = window.innerHeight
  for (const el of chapters) {
    const r = el.getBoundingClientRect()
    if (r.bottom > -vh && r.top < vh * 2) el.style.setProperty('--book-font', stack)
  }
}

applyFont(localStorage.getItem('saga.font') || 'serif')
for (const btn of $$('#font-choice .font-opt')) {
  btn.addEventListener('click', () => applyFont(btn.dataset.font))
}

const KIND_NAME = {
  chapter: '章节',
  copyright: '版权',
  dedication: '献辞',
  epigraph: '题词',
  contents: '目录',
  opening: '卷首语',
  foreword: '前言',
  prologue: '序章',
  part: '部分',
  unnumbered: '未编号章节',
  epilogue: '尾声',
  extra: '番外',
  afterword: '后记',
  acknowledgments: '致谢',
  about: '关于作者'
}

const STORY = new Set(['chapter', 'unnumbered', 'prologue', 'epilogue', 'extra'])
const FRONT_PAGES = new Set(['copyright', 'dedication', 'epigraph', 'contents'])
const BACK_PAGES = new Set(['epilogue', 'afterword', 'acknowledgments', 'about'])
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX']

// what a blank page says before the writer writes on it
const GHOST = {
  copyright: '',
  dedication: '献给…',
  epigraph: '一句引语，出处',
  opening: '卷首语…',
  foreword: '前言…',
  prologue: '序章…',
  part: '这一部分的标题',
  chapter: '这里写些什么…',
  unnumbered: '这里写些什么…',
  epilogue: '尾声…',
  extra: '番外…',
  afterword: '后记…',
  acknowledgments: '致谢…',
  about: '关于作者…'
}

const state = {
  dir: null,
  name: '',
  meta: null,
  chapters: {},
  comments: [],
  currentId: null,
  dirty: new Set(),
  saveTimer: null
}

// 批注: the anchor is a quote plus its place in the chapter's text, never
// markup in the chapter file.  Ranges are rebuilt from the words each time.
let commentSelection = null
let commentSaveTimer = null
let commentsDirty = false
const commentRanges = new Map()
let activeCommentId = null

// a jump across a long book goes at once, not through every chapter between;
// a short one slides, and the picked chapter stays current until it lands
let jumpTop = null
let jumpUntil = 0

/* ---------- chapter names ---------- */

// a name is written to book.json shortly after the typing stops, and on
// leaving the page, like the words themselves
const dirtyTitles = new Set()
const titleTimers = new Map()

function scheduleTitleSave (id) {
  dirtyTitles.add(id)
  clearTimeout(titleTimers.get(id))
  titleTimers.set(id, setTimeout(() => { flushTitle(id) }, 600))
}

async function flushTitle (id) {
  clearTimeout(titleTimers.get(id))
  titleTimers.delete(id)
  if (!dirtyTitles.has(id)) return
  const title = titleOf(id)
  try {
    await window.saga.writeTitle(id, title)
    // an edit made while the write was on its way keeps its own turn
    if (titleOf(id) === title) dirtyTitles.delete(id)
  } catch (err) {
    toast('章节名保存失败：' + cleanError(err))
  }
}

async function flushTitles () {
  for (const id of [...dirtyTitles]) await flushTitle(id)
}

/* ---------- the book's shape ---------- */

const kindOf = (id) => (state.meta.chapterKinds && state.meta.chapterKinds[id]) || 'chapter'
const isStory = (id) => STORY.has(kindOf(id))

function numberAt (id) {
  let n = 0
  for (const chId of state.meta.chapterOrder) {
    if (kindOf(chId) === 'chapter') n++
    if (chId === id) break
  }
  return n
}

function partNumberAt (id) {
  let n = 0
  for (const chId of state.meta.chapterOrder) {
    if (kindOf(chId) === 'part') n++
    if (chId === id) break
  }
  return n
}

// a chapter's own title, as kept in book.json
const titleOf = (id) => ((state.meta && state.meta.chapterTitles && state.meta.chapterTitles[id]) || '').trim()

// the name a chapter goes by in the pane: a number and its title
function labelOf (id) {
  const kind = kindOf(id)
  const titled = titleOf(id)
  if (kind === 'chapter') return titled ? numberAt(id) + ' · ' + titled : '第 ' + numberAt(id) + ' 章'
  if (kind === 'part') {
    const name = '第 ' + (ROMAN[partNumberAt(id)] || partNumberAt(id)) + ' 部分'
    return titled ? name + ' · ' + titled : name
  }
  if (kind === 'unnumbered') return titled || '未命名'
  return KIND_NAME[kind] || kind
}

/* ---------- words ---------- */

// the words of a chapter, read straight from its HTML: no DOM is built for
// every chapter just to count them (a long book opens much faster)
const ENTITY = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
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

function countWords (text) {
  const cjk = (text.match(/[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/g) || []).length
  const rest = text.replace(/[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/g, ' ')
  const latin = (rest.match(/[A-Za-z0-9À-ÖØ-öø-ÿ'’]+/g) || []).length
  return cjk + latin
}

// a count as a reader reads it: 2,294, not 2294
const fmtNum = (n) => Number(n || 0).toLocaleString('zh-CN')

const wordCache = new Map()
const textCache = new Map()

function textFor (id) {
  if (!textCache.has(id)) textCache.set(id, textOf(state.chapters[id] || ''))
  return textCache.get(id)
}

function wordsOf (id) {
  if (!wordCache.has(id)) wordCache.set(id, countWords(textFor(id)))
  return wordCache.get(id)
}

function firstLine (id) {
  const t = textFor(id)
  if (!t) return ''
  return t.length > 30 ? t.slice(0, 29) + '…' : t
}

function bookTotals () {
  let words = 0
  let chapters = 0
  for (const id of state.meta.chapterOrder) {
    if (kindOf(id) === 'chapter') chapters++
    if (isStory(id)) words += wordsOf(id)
  }
  return { words, chapters }
}

/* ---------- the pane on the left ---------- */

// a long book needs a way to find a name in the list
let navQuery = ''

function applyNavFilter () {
  const q = navQuery.trim().toLowerCase()
  let shown = 0
  for (const item of $$('.nav-item')) {
    const id = item.dataset.id
    const hay = (labelOf(id) + ' ' + firstLine(id) + ' ' + (KIND_NAME[kindOf(id)] || '')).toLowerCase()
    const on = !q || hay.includes(q)
    item.hidden = !on
    if (on) shown++
  }
  const empty = $('#nav-empty')
  if (empty) empty.hidden = !q || shown > 0
  const first = $('.insert-first')
  if (first) first.hidden = !!q
}

function clearNavSearch () {
  const input = $('#nav-search-input')
  if (!input) return
  if (input.value) {
    input.value = ''
    navQuery = ''
    applyNavFilter()
  }
}

// the plus that waits between two chapters: a dashed line with a circle in
// the middle, the way a new page is slipped into place
function insertControl (className, beforeId, title) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = className
  btn.title = title
  const left = document.createElement('i')
  const plus = document.createElement('b')
  plus.textContent = '+'
  const right = document.createElement('i')
  btn.append(left, plus, right)
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    openAddMenu(btn, beforeId)
  })
  return btn
}

function buildNav () {
  const list = $('#nav-list')
  list.textContent = ''
  const order = state.meta.chapterOrder
  list.appendChild(insertControl('insert-first', order[0] || null, '在最前面插入新页面'))
  const frag = document.createDocumentFragment()
  let inPart = false
  for (let index = 0; index < order.length; index++) {
    const id = order[index]
    const kind = kindOf(id)
    if (kind === 'part') inPart = true
    else if (BACK_PAGES.has(kind)) inPart = false

    const item = document.createElement('div')
    item.className = 'nav-item kind-' + kind +
      (isStory(id) ? '' : ' nav-page') +
      (inPart && kind !== 'part' ? ' in-part' : '')
    item.dataset.id = id

    const row = document.createElement('div')
    row.className = 'n-row'
    const label = document.createElement('span')
    label.className = 'n-label'
    label.textContent = labelOf(id)
    row.appendChild(label)
    if (isStory(id)) {
      const words = document.createElement('span')
      words.className = 'n-words'
      words.textContent = fmtNum(wordsOf(id))
      row.appendChild(words)
    }

    const note = document.createElement('div')
    note.className = 'nav-note'
    note.textContent = firstLine(id)
    // the "write something" prompt belongs to the story; a page with nothing
    // on it simply reads empty, as a book page does
    if (!isStory(id)) note.classList.add('no-ph')

    item.append(row, note)
    item.appendChild(insertControl('insert-after', order[index + 1] || null, '在这后面插入新页面'))
    item.addEventListener('click', () => scrollToChapter(id))
    item.tabIndex = 0
    item.setAttribute('role', 'button')
    item.addEventListener('keydown', (e) => {
      if (e.target.closest('.insert-after')) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        scrollToChapter(id)
      }
    })
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      closePopmenu()
      showRowMenu(id, item)
    })
    makeDraggable(item, id)
    frag.appendChild(item)
  }
  list.appendChild(frag)
  applyNavFilter()
}

function refreshNav (id) {
  const item = document.querySelector(`.nav-item[data-id="${id}"]`)
  if (!item) return
  item.querySelector('.n-label').textContent = labelOf(id)
  item.querySelector('.nav-note').textContent = firstLine(id)
  const words = item.querySelector('.n-words')
  if (words) words.textContent = fmtNum(wordsOf(id))
  if (navQuery) applyNavFilter()
}

function markCurrent (id) {
  for (const item of $$('.nav-item')) item.classList.toggle('current', item.dataset.id === id)
}

// a long book opens where it was left: the list should show that place too
function revealCurrent () {
  const item = document.querySelector('.nav-item.current')
  if (!item || item.hidden) return
  const pane = $('#nav-pane')
  const ir = item.getBoundingClientRect()
  const pr = pane.getBoundingClientRect()
  if (ir.top < pr.top + 40 || ir.bottom > pr.bottom - 16) {
    pane.scrollTop += ir.top - pr.top - pane.clientHeight / 2
  }
}

/* ---------- chapters made, moved, and set aside ---------- */

// the numbers live in the head of each chapter, so a chapter added or taken
// out renumbers the ones after it
function refreshHeads () {
  for (const sec of $$('.chapter')) {
    const id = sec.dataset.id
    const kind = kindOf(id)
    const head = sec.querySelector('.chapter-head')
    if (!head) continue
    if (kind !== 'chapter' && kind !== 'part' && kind !== 'unnumbered') {
      head.textContent = labelOf(id)
      continue
    }
    const nameEl = head.querySelector('.ch-name')
    if (nameEl) {
      nameEl.textContent = kind === 'chapter'
        ? '第 ' + numberAt(id) + ' 章'
        : kind === 'part'
          ? '第 ' + (ROMAN[partNumberAt(id)] || partNumberAt(id)) + ' 部分'
          : ''
    }
    const titleEl = head.querySelector('.ch-title')
    if (titleEl) {
      titleEl.textContent = titleOf(id)
      titleEl.classList.toggle('is-empty', !titleOf(id))
    }
  }
}

function refreshContents () {
  for (const sec of $$('.chapter.kind-contents')) {
    const body = sec.querySelector('.chapter-body')
    if (!body) continue
    body.textContent = ''
    body.appendChild(contentsList())
  }
}

function insertSection (id) {
  const sec = buildChapter(id)
  const index = state.meta.chapterOrder.indexOf(id)
  const nextId = state.meta.chapterOrder[index + 1]
  const next = nextId ? document.querySelector(`.chapter[data-id="${nextId}"]`) : null
  if (next) next.before(sec)
  else $('#chapters').appendChild(sec)
}

// after the book's shape changes, keep the pane, the numbers, the contents
// page and the bar all saying the same thing
function syncStructure () {
  buildIds = state.meta.chapterOrder
  builtCount = buildIds.length
  const pane = $('#nav-pane')
  const navScroll = pane.scrollTop
  buildNav()
  pane.scrollTop = navScroll
  refreshHeads()
  refreshContents()
  markCurrent(state.currentId)
  revealCurrent()
  updateStats()
  queueProgress()
  renderComments()
}

async function addChapter (kind, beforeId) {
  try {
    await flush()
    finishManuscript()
    const res = await window.saga.createChapter(kind, beforeId)
    if (!res || !res.id) return
    state.meta = res.meta
    state.chapters[res.id] = '<p><br></p>'
    wordCache.delete(res.id)
    textCache.delete(res.id)
    navQuery = ''
    $('#nav-search-input').value = ''
    insertSection(res.id)
    syncStructure()
    scrollToChapter(res.id)
    toast('已添加' + (KIND_NAME[kind] || '章节'))
  } catch (err) {
    toast('添加失败：' + cleanError(err))
  }
}

async function deleteChapter (id) {
  const ok = await askConfirm('删除章节',
    '删除「' + labelOf(id) + '」？文字不会丢，会保留在书的 darlings 文件夹里。', '删除')
  if (!ok) return
  try {
    await flush()
    if (state.dirty.has(id)) {
      toast('这一章还没写回磁盘，先不删除')
      return
    }
    const index = state.meta.chapterOrder.indexOf(id)
    const res = await window.saga.deleteChapter(id)
    state.meta = res.meta
    delete state.chapters[id]
    state.dirty.delete(id)
    wordCache.delete(id)
    textCache.delete(id)
    const sec = document.querySelector(`.chapter[data-id="${id}"]`)
    if (sec) sec.remove()
    if (state.currentId === id) {
      state.currentId = res.meta.chapterOrder[Math.min(index, res.meta.chapterOrder.length - 1)] || null
    }
    syncStructure()
    if (state.currentId) scrollToChapter(state.currentId)
    toast('已移到书的 darlings 文件夹，可以找回')
  } catch (err) {
    toast('删除失败：' + cleanError(err))
  }
}

async function moveChapter (id, beforeId) {
  const order = state.meta && state.meta.chapterOrder
  if (!order || id === beforeId || !order.includes(id)) return
  if (beforeId && !order.includes(beforeId)) return
  if (beforeId && order[order.indexOf(beforeId) - 1] === id) return
  try {
    await flush()
    finishManuscript()
    const stage = $('#stage')
    const anchor = sectionAtTopEl()
    const anchorTop = anchor ? anchor.getBoundingClientRect().top : 0
    state.meta = await window.saga.moveChapter(id, beforeId)
    const box = $('#chapters')
    const frag = document.createDocumentFragment()
    const sections = new Map([...$$('.chapter')].map((sec) => [sec.dataset.id, sec]))
    for (const chId of state.meta.chapterOrder) {
      const sec = sections.get(chId)
      if (sec) frag.appendChild(sec)
    }
    box.appendChild(frag)
    syncStructure()
    if (anchor) {
      stage.scrollTop += anchor.getBoundingClientRect().top - anchorTop
    }
  } catch (err) {
    toast('移动失败：' + cleanError(err))
  }
}

/* the small menu the pane opens */

let popmenuEl = null
let popOutside = null

function closePopmenu () {
  if (!popmenuEl) return
  popmenuEl.remove()
  popmenuEl = null
  if (popOutside) {
    document.removeEventListener('mousedown', popOutside, true)
    popOutside = null
  }
}

function showPopmenu (entries, anchor) {
  closePopmenu()
  const menu = document.createElement('div')
  menu.id = 'popmenu'
  for (const entry of entries) {
    if (entry.head) {
      const head = document.createElement('div')
      head.className = 'pop-head'
      head.textContent = entry.head
      menu.appendChild(head)
    } else if (entry.sep) {
      const sep = document.createElement('div')
      sep.className = 'pop-sep'
      menu.appendChild(sep)
    } else {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'pop-item'
      btn.textContent = entry.label
      btn.disabled = !!entry.disabled
      btn.addEventListener('click', () => {
        closePopmenu()
        entry.run()
      })
      menu.appendChild(btn)
    }
  }
  document.body.appendChild(menu)
  const r = anchor.getBoundingClientRect()
  const width = menu.offsetWidth
  const height = menu.offsetHeight
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width))
  let top = r.bottom + 6
  if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 6)
  menu.style.left = left + 'px'
  menu.style.top = top + 'px'
  popmenuEl = menu
  const first = menu.querySelector('.pop-item:not(:disabled)')
  if (first) first.focus()
  popOutside = (e) => { if (popmenuEl && !popmenuEl.contains(e.target)) closePopmenu() }
  setTimeout(() => { if (popmenuEl) document.addEventListener('mousedown', popOutside, true) }, 0)
}

const ADD_GROUPS = {
  front: { head: '前置页', kinds: ['copyright', 'dedication', 'epigraph', 'contents', 'opening', 'foreword'] },
  body: { head: '正文', kinds: ['chapter', 'part', 'unnumbered', 'prologue', 'extra', 'epilogue'] },
  back: { head: '后置页', kinds: ['afterword', 'acknowledgments', 'about'] }
}

function openAddMenu (anchor, beforeId) {
  // between chapters the writer almost always wants another chapter; at the
  // very front, the pages that live there come first
  const atFront = state.meta && state.meta.chapterOrder[0] === beforeId
  const groups = atFront ? ['front', 'body', 'back'] : ['body', 'front', 'back']
  const entries = []
  groups.forEach((key, index) => {
    if (index) entries.push({ sep: true })
    const group = ADD_GROUPS[key]
    entries.push({ head: group.head })
    for (const kind of group.kinds) {
      entries.push({ label: KIND_NAME[kind] || kind, run: () => addChapter(kind, beforeId) })
    }
  })
  showPopmenu(entries, anchor)
}

function showRowMenu (id, item) {
  const order = state.meta.chapterOrder
  const index = order.indexOf(id)
  showPopmenu([
    { label: '上移', disabled: index <= 0, run: () => moveChapter(id, order[index - 1]) },
    { label: '下移', disabled: index < 0 || index >= order.length - 1, run: () => moveChapter(id, order[index + 2] || null) },
    { sep: true },
    { label: '删除这一章', run: () => deleteChapter(id) }
  ], item)
}

/* dragging a chapter up or down the list */

let dragId = null
let dragStep = 0
let dragTimer = null

function clearDropMarks () {
  for (const el of $$('.nav-item.drop-before, .nav-item.drop-after')) {
    el.classList.remove('drop-before', 'drop-after')
  }
}

function endDrag () {
  dragId = null
  dragStep = 0
  if (dragTimer) {
    clearInterval(dragTimer)
    dragTimer = null
  }
  clearDropMarks()
  for (const el of $$('.nav-item.dragging')) el.classList.remove('dragging')
}

function makeDraggable (item, id) {
  item.draggable = true
  item.addEventListener('dragstart', (e) => {
    dragId = id
    item.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', id) } catch {}
  })
  item.addEventListener('dragend', endDrag)
  item.addEventListener('dragover', (e) => {
    if (!dragId || dragId === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = item.getBoundingClientRect()
    const before = e.clientY < r.top + r.height / 2
    clearDropMarks()
    item.classList.add(before ? 'drop-before' : 'drop-after')
    const pane = $('#nav-pane')
    const pr = pane.getBoundingClientRect()
    dragStep = e.clientY < pr.top + 48 ? -14 : e.clientY > pr.bottom - 48 ? 14 : 0
    if (dragStep && !dragTimer) {
      dragTimer = setInterval(() => { pane.scrollTop += dragStep }, 16)
    } else if (!dragStep && dragTimer) {
      clearInterval(dragTimer)
      dragTimer = null
    }
  })
  item.addEventListener('drop', (e) => {
    e.preventDefault()
    const from = dragId
    endDrag()
    if (!from || from === id) return
    const r = item.getBoundingClientRect()
    const before = e.clientY < r.top + r.height / 2
    const order = state.meta.chapterOrder
    const beforeId = before ? id : (order[order.indexOf(id) + 1] || null)
    if (beforeId !== from) moveChapter(from, beforeId)
  })
}

/* a yes or no, kept inside the app's own dialogs */

let confirmPending = null

function askConfirm (title, text, okLabel) {
  if (confirmPending) {
    const previous = confirmPending
    confirmPending = null
    previous(false)
  }
  $('#confirm-title').textContent = title
  $('#confirm-text').textContent = text
  $('#confirm-ok').textContent = okLabel || '确定'
  openModal('confirm')
  $('#confirm-ok').focus()
  return new Promise((resolve) => { confirmPending = resolve })
}

function settleConfirm (ok) {
  const resolve = confirmPending
  confirmPending = null
  closeModal('confirm')
  if (resolve) resolve(ok)
}

/* ---------- the manuscript ---------- */

function markFirstParagraph (body) {
  for (const p of body.querySelectorAll('p[data-first]')) p.removeAttribute('data-first')
  const first = [...body.querySelectorAll('p')].find((p) => p.textContent.trim() || p.querySelector('br'))
  if (first) first.setAttribute('data-first', '')
}

// a blank page keeps its own quiet prompt, drawn, never saved
function updateGhost (body) {
  body.classList.toggle('is-empty', !body.textContent.trim())
}

function contentsList () {
  const ol = document.createElement('ol')
  ol.className = 'toc-list'
  for (const id of state.meta.chapterOrder) {
    const kind = kindOf(id)
    if (FRONT_PAGES.has(kind)) continue
    const li = document.createElement('li')
    li.className = kind === 'part' ? 't-part' : 'lv1'
    li.textContent = labelOf(id)
    li.addEventListener('click', () => scrollToChapter(id))
    ol.appendChild(li)
  }
  return ol
}

// the head of a chapter, with its name editable where the book has one
function bindTitle (el, id) {
  let before = titleOf(id)
  const sync = () => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
    state.meta.chapterTitles = state.meta.chapterTitles || {}
    if (t) state.meta.chapterTitles[id] = t
    else delete state.meta.chapterTitles[id]
    el.classList.toggle('is-empty', !t)
    refreshNav(id)
    scheduleTitleSave(id)
  }
  el.addEventListener('input', sync)
  el.addEventListener('focus', () => { before = titleOf(id) })
  el.addEventListener('blur', () => { sync(); flushTitle(id) })
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      el.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      el.textContent = before
      sync()
      el.blur()
    }
  })
  el.addEventListener('paste', (e) => {
    e.preventDefault()
    const text = ((e.clipboardData || window.clipboardData).getData('text/plain') || '').replace(/\s+/g, ' ')
    document.execCommand('insertText', false, text)
  })
}

function buildHead (id) {
  const head = document.createElement('div')
  head.className = 'chapter-head'
  const kind = kindOf(id)
  if (kind !== 'chapter' && kind !== 'part' && kind !== 'unnumbered') {
    head.textContent = labelOf(id)
    return head
  }
  const name = kind === 'chapter'
    ? '第 ' + numberAt(id) + ' 章'
    : kind === 'part'
      ? '第 ' + (ROMAN[partNumberAt(id)] || partNumberAt(id)) + ' 部分'
      : ''
  if (name) {
    const nameEl = document.createElement('span')
    nameEl.className = 'ch-name'
    nameEl.textContent = name
    head.appendChild(nameEl)

    const sep = document.createElement('span')
    sep.className = 'ch-sep'
    sep.textContent = ' — '
    head.appendChild(sep)
  }

  const titleEl = document.createElement('span')
  titleEl.className = 'ch-title'
  titleEl.contentEditable = 'true'
  titleEl.spellcheck = false
  titleEl.dataset.ph = '添加标题'
  titleEl.textContent = titleOf(id)
  titleEl.classList.toggle('is-empty', !titleOf(id))
  head.appendChild(titleEl)
  bindTitle(titleEl, id)
  return head
}

function buildChapter (id) {
  const kind = kindOf(id)
  const sec = document.createElement('section')
  sec.className = 'chapter sheet kind-' + kind + (isStory(id) ? '' : ' bookpage')
  sec.dataset.id = id
  sec.style.setProperty('--book-font', FONT_STACKS[currentFont])

  const head = buildHead(id)

  const body = document.createElement('div')
  body.className = 'chapter-body'
  body.dataset.id = id

  if (kind === 'contents') {
    body.contentEditable = 'false'
    body.appendChild(contentsList())
  } else {
    body.contentEditable = 'true'
    body.spellcheck = false
    body.dataset.ph = GHOST[kind] || ''
    const html = String(state.chapters[id] || '').trim()
    body.innerHTML = html && html !== '<p><br></p>' ? html : '<p><br></p>'
    markFirstParagraph(body)
    updateGhost(body)
    body.addEventListener('input', () => {
      state.currentId = id
      markCurrent(id)
      state.dirty.add(id)
      markFirstParagraph(body)
      updateGhost(body)
      refreshNav(id)
      updateStats()
      scheduleSave()
      scheduleCommentRender()
      if (!$('#find-bar').hidden) scheduleFindRefresh()
    })
    body.addEventListener('focus', () => {
      state.currentId = id
      markCurrent(id)
      updateStats()
    })
  }

  sec.append(head, body)
  fontObserver.observe(sec)
  return sec
}

function appendChapters (ids) {
  const box = $('#chapters')
  const frag = document.createDocumentFragment()
  for (const id of ids) frag.appendChild(buildChapter(id))
  box.appendChild(frag)
}

// a long book is laid in a few chapters at a time: the title page and the
// first pages are ready at once, the rest follows a frame later
const BUILD_CHUNK = 24
let buildToken = 0
let buildIds = []
let builtCount = 0

function finishManuscript () {
  if (builtCount >= buildIds.length) return
  buildToken++
  appendChapters(buildIds.slice(builtCount))
  builtCount = buildIds.length
  renderComments()
}

function jumpTo (top, id) {
  const stage = $('#stage')
  const target = Math.max(0, top)
  state.currentId = id
  markCurrent(id)
  updateStats()
  if (Math.abs(target - stage.scrollTop) < 1) { jumpTop = null; return }
  const far = Math.abs(target - stage.scrollTop) > stage.clientHeight * 2
  jumpTop = target
  jumpUntil = performance.now() + (far ? 200 : 1200)
  stage.scrollTo({ top: target, behavior: far ? 'auto' : 'smooth' })
}

function scrollToChapter (id) {
  let sec = document.querySelector(`.chapter[data-id="${id}"]`)
  // a chapter further down than the pages laid in so far: finish the book
  // now, then go there
  if (!sec) {
    finishManuscript()
    sec = document.querySelector(`.chapter[data-id="${id}"]`)
  }
  if (!sec) return
  // the page is zoomed, so its top is read where the eye sees it, not in
  // the unzoomed units offsetTop reports
  const stage = $('#stage')
  const top = stage.scrollTop + sec.getBoundingClientRect().top - stage.getBoundingClientRect().top
  // the chapter comes to the writer with the caret in it, at its end
  const body = sec.querySelector('.chapter-body')
  if (body && body.isContentEditable) {
    body.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(body)
    range.collapse(false)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  }
  jumpTo(top - 18, id)
}

function sectionAtTopEl () {
  const stage = $('#stage')
  const line = stage.getBoundingClientRect().top + 140
  let current = null
  for (const sec of $$('.chapter')) {
    if (sec.getBoundingClientRect().top <= line) current = sec
    else break
  }
  return current
}

function sectionAtTop () {
  const sec = sectionAtTopEl()
  return sec ? sec.dataset.id : null
}

/* ---------- saving ---------- */

function flashSaved () {
  const el = $('#stat-saved')
  el.hidden = false
  el.textContent = '已保存'
  el.classList.add('on')
  clearTimeout(flashSaved.timer)
  flashSaved.timer = setTimeout(() => {
    el.classList.remove('on')
    setTimeout(() => {
      if (el.classList.contains('on')) return
      el.textContent = ''
      el.hidden = true
    }, 220)
  }, 1200)
}

function scheduleSave () {
  clearTimeout(state.saveTimer)
  state.saveTimer = setTimeout(saveDirty, 700)
}

async function saveDirty () {
  clearTimeout(state.saveTimer)
  for (const id of [...state.dirty]) {
    if (kindOf(id) === 'contents') { state.dirty.delete(id); continue }
    const body = document.querySelector(`.chapter-body[data-id="${id}"]`)
    if (!body) { state.dirty.delete(id); continue }
    // screen marks stay out of the file: data-first only sets the page's type
    const copy = body.cloneNode(true)
    for (const p of copy.querySelectorAll('[data-first]')) p.removeAttribute('data-first')
    const html = copy.innerHTML
    state.dirty.delete(id)
    try {
      await window.saga.writeChapter(id, html)
      state.chapters[id] = html
      wordCache.delete(id)
      textCache.delete(id)
      refreshNav(id)
      updateStats()
      flashSaved()
    } catch (err) {
      state.dirty.add(id)
      toast('保存失败：' + (err && err.message ? err.message : '未知原因'))
    }
  }
}

const flush = async () => {
  savePosition()
  if (state.dirty.size) await saveDirty()
  if (dirtyTitles.size) await flushTitles()
  if (commentsDirty) await saveCommentsNow()
}

/* ---------- 全文查找替换 ---------- */

let findMatches = []
let findIndex = -1
let findRefreshTimer = null

function scheduleFindRefresh () {
  clearTimeout(findRefreshTimer)
  findRefreshTimer = setTimeout(() => {
    if (!$('#find-bar').hidden) refreshFind()
  }, 350)
}

function findInBodies () {
  const all = $('#find-scope-all').checked
  if (all) {
    finishManuscript()
    return [...$$('#chapters .chapter-body')].filter((body) => body.isContentEditable)
  }
  let id = state.currentId
  if (!id || !document.querySelector(`.chapter-body[data-id="${id}"]`)) {
    const order = (state.meta && state.meta.chapterOrder) || []
    id = order.find((chId) => kindOf(chId) === 'chapter' &&
      String(state.chapters[chId] || '').replace(/<[^>]*>/g, '').trim()) ||
      order.find((chId) => STORY.has(kindOf(chId)))
  }
  if (!id) return []
  let body = document.querySelector(`.chapter-body[data-id="${id}"]`)
  if (!body) {
    finishManuscript()
    body = document.querySelector(`.chapter-body[data-id="${id}"]`)
  }
  if (body && body.isContentEditable) return [body]
  // the contents sheet is generated, not written; search the first chapter
  const order = (state.meta && state.meta.chapterOrder) || []
  const alt = order.find((chId) => kindOf(chId) === 'chapter' &&
    String(state.chapters[chId] || '').replace(/<[^>]*>/g, '').trim())
  if (!alt) return []
  const altBody = document.querySelector(`.chapter-body[data-id="${alt}"]`)
  return altBody && altBody.isContentEditable ? [altBody] : []
}

function matchesInBody (body, needle, caseSensitive) {
  const out = []
  if (!needle) return out
  const low = caseSensitive ? needle : needle.toLowerCase()
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const text = node.nodeValue || ''
    if (!text) continue
    const hay = caseSensitive ? text : text.toLowerCase()
    let from = 0
    while (from <= hay.length - low.length) {
      const at = hay.indexOf(low, from)
      if (at < 0) break
      if (at + needle.length <= text.length) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + needle.length)
        out.push({ body, range })
      }
      from = at + Math.max(needle.length, 1)
    }
  }
  return out
}

function paintFind () {
  if (!window.CSS || !CSS.highlights) return
  const all = new Highlight()
  const current = new Highlight()
  findMatches.forEach((match, i) => {
    if (i === findIndex) current.add(match.range)
    else all.add(match.range)
  })
  if (all.size) CSS.highlights.set('saga-find', all)
  else CSS.highlights.delete('saga-find')
  if (current.size) CSS.highlights.set('saga-find-current', current)
  else CSS.highlights.delete('saga-find-current')
}

function updateFindCount () {
  const el = $('#find-count')
  if (!el) return
  el.textContent = findMatches.length ? (findIndex + 1) + ' / ' + findMatches.length : '0 / 0'
}

function showFindAt (index) {
  if (!findMatches.length) { findIndex = -1; paintFind(); updateFindCount(); return }
  findIndex = ((index % findMatches.length) + findMatches.length) % findMatches.length
  paintFind()
  updateFindCount()
  const match = findMatches[findIndex]
  const rect = match.range.getBoundingClientRect()
  if (!rect || (!rect.width && !rect.height)) return
  const stage = $('#stage')
  const top = stage.scrollTop + rect.top - stage.getBoundingClientRect().top - stage.clientHeight / 3
  stage.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
  state.currentId = match.body.dataset.id
  markCurrent(state.currentId)
  updateStats()
}

function refreshFind () {
  clearTimeout(findRefreshTimer)
  const needle = $('#find-input').value
  const caseSensitive = $('#find-case').checked
  findMatches = []
  findIndex = -1
  if (needle) {
    for (const body of findInBodies()) {
      for (const match of matchesInBody(body, needle, caseSensitive)) findMatches.push(match)
    }
  }
  if (findMatches.length) showFindAt(0)
  else { paintFind(); updateFindCount() }
}

function findStep (delta) {
  if (!findMatches.length) refreshFind()
  if (!findMatches.length) return
  showFindAt(findIndex + delta)
}

function replaceInBody (body, needle, replacement, caseSensitive) {
  const low = caseSensitive ? needle : needle.toLowerCase()
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  let node
  let count = 0
  while ((node = walker.nextNode())) {
    const text = node.nodeValue || ''
    if (!text) continue
    const hay = caseSensitive ? text : text.toLowerCase()
    let out = ''
    let from = 0
    let at
    while ((at = hay.indexOf(low, from)) >= 0) {
      out += text.slice(from, at) + replacement
      from = at + needle.length
      count++
    }
    if (from) node.nodeValue = out + text.slice(from)
  }
  return count
}

function replaceCurrent () {
  if (!findMatches.length) { refreshFind(); return }
  const match = findMatches[findIndex]
  if (!match) return
  const replacement = $('#find-replace-input').value
  const body = match.body
  const at = findIndex
  match.range.deleteContents()
  if (replacement) match.range.insertNode(document.createTextNode(replacement))
  body.normalize()
  body.dispatchEvent(new Event('input', { bubbles: true }))
  refreshFind()
  if (findMatches.length) showFindAt(Math.min(at, findMatches.length - 1))
}

async function replaceAllFind () {
  const needle = $('#find-input').value
  if (!needle) { toast('先输入要查找的文字'); return }
  const replacement = $('#find-replace-input').value
  const caseSensitive = $('#find-case').checked
  const btn = $('#find-replace-all')
  btn.disabled = true
  try {
    // the backup on disk should hold what the writer sees, including edits
    // still waiting for their debounce
    await flush()
    const plans = []
    for (const body of findInBodies()) {
      const count = replaceInBodyCount(body, needle, caseSensitive)
      if (count) plans.push({ body, id: body.dataset.id, count })
    }
    if (!plans.length) { toast('没有找到「' + needle + '」'); return }
    // a bulk rewrite is recoverable: every chapter it touches waits in darlings/
    let backedUp = 0
    for (const plan of plans) {
      const name = await window.saga.backupChapter(plan.id, 'before-replace')
      if (name) backedUp++
    }
    let total = 0
    const previous = state.currentId
    for (const plan of plans) {
      total += replaceInBody(plan.body, needle, replacement, caseSensitive)
      plan.body.normalize()
      markFirstParagraph(plan.body)
      updateGhost(plan.body)
      state.dirty.add(plan.id)
      wordCache.delete(plan.id)
      textCache.delete(plan.id)
      refreshNav(plan.id)
    }
    state.currentId = previous
    markCurrent(previous)
    updateStats()
    scheduleSave()
    scheduleCommentRender()
    refreshFind()
    toast('已替换 ' + total + ' 处' + (backedUp ? '，原文已备份到 darlings/' : ''), 3600)
  } catch (err) {
    toast('替换失败：' + cleanError(err))
  } finally {
    btn.disabled = false
  }
}

// a count without making ranges, so the backup pass does not disturb the page
function replaceInBodyCount (body, needle, caseSensitive) {
  const low = caseSensitive ? needle : needle.toLowerCase()
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  let node
  let count = 0
  while ((node = walker.nextNode())) {
    const text = node.nodeValue || ''
    if (!text) continue
    const hay = caseSensitive ? text : text.toLowerCase()
    let from = 0
    let at
    while ((at = hay.indexOf(low, from)) >= 0) {
      count++
      from = at + needle.length
    }
  }
  return count
}

function openFind () {
  if (!state.meta) return
  if (document.querySelector('.modal:not([hidden])')) return
  const bar = $('#find-bar')
  bar.hidden = false
  const sel = window.getSelection()
  let picked = ''
  if (sel && !sel.isCollapsed && sel.rangeCount) {
    const node = sel.getRangeAt(0).startContainer
    const el = node.nodeType === 1 ? node : node.parentElement
    if (el && el.closest && el.closest('.chapter-body')) picked = sel.toString()
  }
  const input = $('#find-input')
  if (picked && !picked.includes('\n') && picked.length <= 200) input.value = picked
  input.focus()
  input.select()
  refreshFind()
}

function closeFind () {
  const bar = $('#find-bar')
  if (!bar || bar.hidden) return
  bar.hidden = true
  findMatches = []
  findIndex = -1
  paintFind()
  updateFindCount()
}

$('#find-input').addEventListener('input', refreshFind)
$('#find-case').addEventListener('change', refreshFind)
$('#find-scope-all').addEventListener('change', refreshFind)
$('#find-prev').addEventListener('click', () => findStep(-1))
$('#find-next').addEventListener('click', () => findStep(1))
$('#find-replace-one').addEventListener('click', replaceCurrent)
$('#find-replace-all').addEventListener('click', replaceAllFind)
$('#find-close').addEventListener('click', closeFind)
$('#find-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    findStep(e.shiftKey ? -1 : 1)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeFind()
  }
})
$('#find-replace-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    replaceCurrent()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeFind()
  }
})

/* ---------- the day's numbers ---------- */

function dayKey () {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function todayWords () {
  const { words } = bookTotals()
  const key = 'saga.day.' + state.dir
  let rec = null
  try { rec = JSON.parse(localStorage.getItem(key) || 'null') } catch {}
  if (!rec || rec.d !== dayKey()) {
    rec = { d: dayKey(), base: words }
    try { localStorage.setItem(key, JSON.stringify(rec)) } catch {}
  }
  return Math.max(0, words - rec.base)
}

function updateStats () {
  if (!state.meta) return
  const totals = bookTotals()
  $('#stat-today').textContent = '今日 ' + fmtNum(todayWords())
  $('#stat-book').textContent = '全书 ' + fmtNum(totals.words) + ' 字 · ' + totals.chapters + ' 章'
  const chEl = $('#stat-chapter')
  if (!state.currentId) {
    chEl.textContent = ''
    chEl.hidden = true
  } else {
    const id = state.currentId
    const words = isStory(id) ? wordsOf(id) : 0
    chEl.textContent = labelOf(id) + ' · ' + fmtNum(words) + ' 字'
    chEl.hidden = false
  }
}

/* ---------- zoom ---------- */

const ZOOM_MIN = 80
const ZOOM_MAX = 200

function zoomValue () {
  const n = Number(localStorage.getItem('saga.zoom'))
  return Number.isFinite(n) && n >= ZOOM_MIN && n <= ZOOM_MAX ? n : 120
}

// Zoom is a scale, not a new layout. Setting a new size with CSS zoom lays the
// whole manuscript out again — a second in a book of six hundred chapters —
// while scaling the page where it stands takes a frame, keeps every line
// break, and lets the browser paint the type at the new size.
let zoomNow = zoomValue()

function applyZoom (value) {
  const n = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value))
  localStorage.setItem('saga.zoom', String(n))
  const stage = $('#stage')
  const paper = $('#paper')
  const was = zoomNow
  // keep the chapter the writer is looking at under the same place on screen
  const anchor = sectionAtTopEl()
  const stageRect = stage.getBoundingClientRect()
  // the paper's top in the page's own, unscaled units
  const paperTop = paper.getBoundingClientRect().top - stageRect.top + stage.scrollTop
  const before = anchor ? anchor.getBoundingClientRect().top - stageRect.top : 0
  paper.style.transform = n === 100 ? '' : 'scale(' + n / 100 + ')'
  zoomNow = n
  if (anchor && n !== was) {
    stage.scrollTop = paperTop + (stage.scrollTop + before - paperTop) * (n / was) - before
    state.currentId = anchor.dataset.id
    markCurrent(state.currentId)
  }
  $('#zoom-val').textContent = n + '%'
  $('#zoom-out').disabled = n <= ZOOM_MIN
  $('#zoom-in').disabled = n >= ZOOM_MAX
  queueProgress()
  positionCommentMarks()
}

/* ---------- where the writer was ---------- */

// one position per book on this device: the chapter at the top of the screen
// and how far into it the eye had gone. The book file stays untouched.
const positionKey = () => 'saga.pos.' + state.dir
let positionTimer = null

function sectionAtViewportTop () {
  const stage = $('#stage')
  const line = stage.getBoundingClientRect().top
  let current = null
  for (const sec of $$('.chapter')) {
    if (sec.getBoundingClientRect().top <= line) current = sec
    else break
  }
  return current
}

function savePosition () {
  if (!state.dir || !state.meta) return
  // on the welcome page the sheets have no size; a flush there must not
  // overwrite the place the book was left at
  if ($('#editor').hidden) return
  const stage = $('#stage')
  const sec = sectionAtViewportTop()
  if (!sec) {
    // the writer is at the title page: the book opens at its beginning
    try { localStorage.removeItem(positionKey()) } catch {}
    return
  }
  const sr = sec.getBoundingClientRect()
  const tr = stage.getBoundingClientRect()
  const ratio = sr.height > 0 ? Math.max(0, Math.min(1, (tr.top - sr.top) / sr.height)) : 0
  try { localStorage.setItem(positionKey(), JSON.stringify({ id: sec.dataset.id, ratio, at: Date.now() })) } catch {}
}

function schedulePositionSave () {
  clearTimeout(positionTimer)
  positionTimer = setTimeout(savePosition, 500)
}

function restorePosition () {
  let pos = null
  try { pos = JSON.parse(localStorage.getItem(positionKey()) || 'null') } catch {}
  if (!pos || !pos.id || !state.meta.chapterOrder.includes(pos.id)) return false
  let sec = document.querySelector(`.chapter[data-id="${pos.id}"]`)
  if (!sec) {
    finishManuscript()
    sec = document.querySelector(`.chapter[data-id="${pos.id}"]`)
  }
  if (!sec) return false
  const stage = $('#stage')
  const sr = sec.getBoundingClientRect()
  const tr = stage.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, Number(pos.ratio) || 0))
  stage.scrollTop += sr.top - tr.top + ratio * sr.height
  state.currentId = pos.id
  markCurrent(pos.id)
  revealCurrent()
  updateStats()
  return true
}

/* ---------- how far through the book ---------- */

let progressRaf = 0

function updateProgress () {
  const stage = $('#stage')
  const max = Math.max(0, stage.scrollHeight - stage.clientHeight)
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round(stage.scrollTop / max * 100))) : 0
  const label = $('#stat-progress')
  if (label) label.textContent = pct + '%'
  const line = $('#progress-line')
  if (line) line.style.transform = 'scaleX(' + pct / 100 + ')'
}

function queueProgress () {
  if (progressRaf) return
  progressRaf = requestAnimationFrame(() => {
    progressRaf = 0
    updateProgress()
  })
}

/* ---------- opening a book ---------- */

let announced = { dir: '', at: 0 }

// the books opened here, newest first; each row is a way back in, and can
// be let go without its folder being touched
async function showRecents () {
  let list = []
  try { list = await window.saga.recentBooks() } catch { list = [] }
  const card = $('#recent-card')
  const box = $('#recent-list')
  if (!card || !box) return []
  box.textContent = ''
  if (!list.length) {
    // the shelf stays, empty, so the page always says where books will land
    card.hidden = false
    box.classList.add('is-empty')
    const empty = document.createElement('p')
    empty.className = 'recent-empty'
    empty.textContent = '还没有打开过书稿。打开一本后，它会出现在这里。'
    box.appendChild(empty)
    return []
  }
  box.classList.remove('is-empty')

  for (const item of list) {
    const row = document.createElement('div')
    row.className = 'recent-row'

    const name = document.createElement('button')
    name.type = 'button'
    name.className = 'recent-name'
    name.textContent = '《' + item.title + '》'
    name.title = item.dir
    name.addEventListener('click', () => openRecent(item.dir))

    const forget = document.createElement('button')
    forget.type = 'button'
    forget.className = 'recent-forget'
    forget.textContent = '删除'
    forget.title = '只删除这条记录，不会删除书的文件'
    forget.addEventListener('click', () => forgetRecent(item.dir))

    row.append(name, forget)
    box.appendChild(row)
  }
  card.hidden = false
  return list
}

async function openRecent (dir) {
  try {
    const data = await window.saga.openPath(dir)
    if (data) showEditor(data)
  } catch (err) {
    showWelcomeError('打开失败：' + cleanError(err))
    showRecents()
  }
}

async function forgetRecent (dir) {
  try {
    await window.saga.forgetBook(dir)
    await showRecents()
    toast('已删除这条记录，书的文件还在原处')
  } catch (err) {
    toast('删除记录失败：' + cleanError(err))
  }
}

async function showEditor (data) {
  window.saga.log && window.saga.log('showEditor ' + data.dir + ' chapters=' + data.meta.chapterOrder.length)
  if (data.dir === announced.dir && Date.now() - announced.at < 1000) return
  announced = { dir: data.dir, at: Date.now() }
  if (state.dir && state.dir !== data.dir) savePosition()
  // a name still on its way to book.json belongs to the book being left
  if (dirtyTitles.size) await flushTitles()

  // a long book takes a moment to set; the veil says so without freezing
  const heavy = data.meta.chapterOrder.length > 80
  const veil = $('#opening')
  if (heavy) {
    veil.classList.remove('done')
    veil.hidden = false
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }

  $('#welcome-error').hidden = true
  wordCache.clear()
  textCache.clear()
  state.dir = data.dir
  state.name = data.name
  state.meta = data.meta
  state.chapters = data.chapters
  state.comments = Array.isArray(data.comments) ? data.comments : []
  state.currentId = null
  state.dirty = new Set()
  commentsDirty = false
  commentSelection = null
  activeCommentId = null
  hideCommentPop()
  $('#sel-tools').hidden = true
  jumpTop = null
  closePopmenu()
  navQuery = ''
  $('#nav-search-input').value = ''
  closeFind()
  const savedEl = $('#stat-saved')
  savedEl.classList.remove('on')
  savedEl.textContent = ''
  savedEl.hidden = true

  $('#tp-title').textContent = data.meta.title || data.name
  const subtitle = (data.meta.subtitle || '').trim()
  $('#tp-subtitle').textContent = subtitle
  $('#tp-subtitle').hidden = !subtitle
  $('#tp-author').textContent = data.meta.author || '佚名'
  document.title = (data.meta.title || data.name) + ' — Saga'

  $('#chapters').textContent = ''
  fontObserver.disconnect()
  $('#welcome').hidden = true
  $('#editor').hidden = false
  $('#export-btn').hidden = false
  $('#meta-btn').hidden = false
  $('#comments-btn').hidden = false
  updateCommentCount()
  // the paper opens at the size it was last read in
  applyZoom(zoomValue())

  buildToken++
  const token = buildToken
  buildIds = data.meta.chapterOrder
  builtCount = 0

  buildNav()
  const firstCount = heavy ? Math.min(BUILD_CHUNK, buildIds.length) : buildIds.length
  appendChapters(buildIds.slice(0, firstCount))
  builtCount = firstCount
  renderComments()

  markCurrent(null)
  $('#stage').scrollTop = 0
  if (!restorePosition()) updateStats()
  updateProgress()

  window.saga.ready({ chapters: data.meta.chapterOrder.length })
  window.saga.log && window.saga.log('editor shown: ' + $$('.nav-item').length + ' rows')
  if (heavy) {
    veil.classList.add('done')
    setTimeout(() => {
      if (veil.classList.contains('done')) veil.hidden = true
    }, 320)
  }

  // the rest of a long book follows in small pieces, so typing and the
  // title page never wait for all of it
  if (builtCount < buildIds.length) {
    const grow = () => {
      if (token !== buildToken) return
      const nextCount = Math.min(buildIds.length, builtCount + BUILD_CHUNK)
      appendChapters(buildIds.slice(builtCount, nextCount))
      builtCount = nextCount
      renderComments()
      if (builtCount < buildIds.length) requestAnimationFrame(grow)
    }
    requestAnimationFrame(grow)
  }
}

async function openLastBook () {
  try {
    window.saga.log && window.saga.log('asking for the last book')
    const data = await window.saga.lastBook()
    window.saga.log && window.saga.log('last book: ' + (data ? data.meta.chapterOrder.length + ' chapters' : 'none'))
    if (data) showEditor(data)
  } catch (err) {
    window.saga.log && window.saga.log('last book failed: ' + (err && err.message ? err.message : err))
    showWelcomeError('无法打开上次的书：' + cleanError(err))
  }
}

/* ---------- wiring ---------- */

function cleanError (err) {
  const raw = err && err.message ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

function showWelcomeError (text) {
  const el = $('#welcome-error')
  el.textContent = text
  el.hidden = false
  toast(text)
}

$('#import-btn').addEventListener('click', async () => {
  try {
    const data = await window.saga.pickBook()
    if (data) showEditor(data)
    else toast('没有选择文件夹')
  } catch (err) {
    showWelcomeError('打开失败：' + cleanError(err))
  }
})

/* a book folder dropped on the window is imported the same way */
const carriesFiles = (e) => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'))
document.addEventListener('dragover', (e) => {
  if (!carriesFiles(e)) return
  e.preventDefault()
  document.body.classList.add('dropping')
})
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dropping')
})
document.addEventListener('drop', async (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
  if (!file) return
  e.preventDefault()
  document.body.classList.remove('dropping')
  const dir = window.saga.pathForFile(file)
  if (!dir) { toast('无法读取这个文件夹的路径'); return }
  try {
    const data = await window.saga.openPath(dir)
    if (data) showEditor(data)
  } catch (err) {
    showWelcomeError('打开失败：' + cleanError(err))
  }
})

window.addEventListener('error', (e) => {
  window.saga.log && window.saga.log('error: ' + (e.message || 'unknown'))
  toast('出错：' + (e.message || '未知错误'))
})
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason && e.reason.message ? e.reason.message : String(e.reason)
  window.saga.log && window.saga.log('rejection: ' + msg)
  toast('出错：' + msg)
})

$('#back-btn').addEventListener('click', async () => {
  savePosition()
  await flush()
  buildToken++
  clearTimeout(positionTimer)
  try { await window.saga.closeBook() } catch {}
  state.dir = null
  state.name = ''
  state.meta = null
  state.chapters = {}
  state.comments = []
  state.currentId = null
  state.dirty.clear()
  dirtyTitles.clear()
  commentsDirty = false
  commentSelection = null
  activeCommentId = null
  wordCache.clear()
  textCache.clear()
  document.title = 'Saga'
  closePopmenu()
  clearNavSearch()
  hideCommentPop()
  $('#sel-tools').hidden = true
  $('#comment-marks').textContent = ''
  if (window.CSS && CSS.highlights) CSS.highlights.delete('saga-comment')
  $('#export-btn').hidden = true
  $('#meta-btn').hidden = true
  $('#comments-btn').hidden = true
  $('#editor').hidden = true
  $('#welcome').hidden = false
  showRecents()
})

/* ---------- settings, and what this is ---------- */

function openModal (name) {
  const modal = $('#' + name + '-modal')
  if (!modal) return
  modal.hidden = false
  const card = modal.querySelector('.modal-card')
  if (card) card.focus({ preventScroll: true })
}

function closeModal (name) {
  const modal = $('#' + name + '-modal')
  if (modal) modal.hidden = true
}

for (const btn of $$('[data-open]')) {
  btn.addEventListener('click', () => openModal(btn.dataset.open))
}
for (const btn of $$('[data-close]')) {
  btn.addEventListener('click', () => closeModal(btn.dataset.close))
}
for (const modal of $$('.modal')) {
  modal.addEventListener('mousedown', (e) => {
    if (e.target === modal) modal.hidden = true
  })
}

$('#help-copy-mail').addEventListener('click', async () => {
  try {
    await window.saga.copyText('396673164@qq.com')
    toast('邮箱已复制')
  } catch (err) {
    toast('复制失败，请手动选择邮箱')
  }
})

/* ---------- 检查更新 ---------- */

const updateBtn = $('#help-update-btn')
const updateStatus = $('#help-update-status')
const updateAction = $('#update-action')
const updateCancel = $('#update-cancel')
const updateModalStatus = $('#update-status')
const updateText = $('#update-text')
let updatePhase = 'idle'
let updateInfo = null

const HELP_LABEL = {
  idle: '检查更新',
  checking: '正在检查…',
  latest: '重新检查',
  available: '查看更新',
  downloading: '正在下载…',
  downloaded: '立即安装',
  portable: '打开文件夹',
  installing: '正在安装…',
  error: '重试'
}
const ACTION_LABEL = {
  available: '下载并安装',
  downloading: '正在下载…',
  downloaded: '立即安装',
  portable: '打开文件夹',
  installing: '正在安装…',
  error: '重试'
}

function setUpdateState (phase, status) {
  updatePhase = phase
  updateBtn.textContent = HELP_LABEL[phase] || '检查更新'
  updateBtn.disabled = phase === 'checking' || phase === 'downloading' || phase === 'installing'
  updateStatus.textContent = status || ''
  updateStatus.hidden = !status
  updateAction.textContent = ACTION_LABEL[phase] || '下载并安装'
  updateAction.disabled = phase === 'checking' || phase === 'downloading' || phase === 'installing'
  updateCancel.hidden = phase !== 'downloading'
  updateCancel.disabled = phase !== 'downloading'
  updateModalStatus.textContent = status || ''
  updateModalStatus.hidden = !status
}

function showUpdatePrompt () {
  if (!updateInfo || !updateInfo.available) return
  updateText.textContent = `当前版本 ${updateInfo.current}，最新版本 ${updateInfo.latest}。`
  closeModal('help')
  openModal('update')
}

async function downloadUpdate () {
  if (!updateInfo || !updateInfo.available) return checkForUpdates()
  setUpdateState('downloading', `正在下载 ${updateInfo.latest}… 0%`)
  try {
    const r = await window.saga.updateDownload()
    if (!r || !r.ok) {
      if (r && r.canceled) {
        setUpdateState('available', '已取消下载')
        return
      }
      throw new Error((r && r.error) || '下载失败')
    }
    if (r.portable) {
      setUpdateState('portable', '新版已下载到「下载」文件夹。关闭 Saga 后替换当前便携版。')
    } else {
      setUpdateState('downloaded', `新版本 ${updateInfo.latest} 已下载，点击「立即安装」。`)
    }
  } catch (err) {
    setUpdateState('error', '下载失败：' + cleanError(err))
  }
}

async function checkForUpdates ({ quiet = false } = {}) {
  setUpdateState('checking', quiet ? '' : '正在连接 GitHub…')
  try {
    const r = await window.saga.updateCheck()
    if (!r || !r.ok) throw new Error((r && r.error) || '检查失败')
    updateInfo = r
    if (!r.available) {
      setUpdateState('latest', `已是最新版本（${r.current}）`)
      return
    }
    setUpdateState('available', `发现新版本 ${r.latest}`)
    showUpdatePrompt()
  } catch (err) {
    if (quiet) {
      setUpdateState('idle', '')
      return
    }
    setUpdateState('error', '检查失败：' + cleanError(err))
  }
}

async function installUpdate () {
  if (updatePhase === 'portable') {
    try {
      await window.saga.updateInstall()
      setUpdateState('portable', '已打开下载文件夹。关闭 Saga 后替换旧文件。')
    } catch (err) {
      toast('打开文件夹失败')
    }
    return
  }
  setUpdateState('installing', '正在启动安装程序，Saga 即将退出…')
  try {
    const r = await window.saga.updateInstall()
    if (!r || !r.ok) throw new Error((r && r.error) || '无法启动安装程序')
  } catch (err) {
    setUpdateState('downloaded', '启动安装程序失败：' + cleanError(err))
  }
}

updateBtn.addEventListener('click', () => {
  if (updatePhase === 'available') return showUpdatePrompt()
  if (updatePhase === 'downloaded' || updatePhase === 'portable') return installUpdate()
  checkForUpdates()
})

updateAction.addEventListener('click', () => {
  if (updatePhase === 'available') return downloadUpdate()
  if (updatePhase === 'downloaded' || updatePhase === 'portable') return installUpdate()
  if (updatePhase === 'error') return checkForUpdates()
})

updateCancel.addEventListener('click', async () => {
  updateCancel.disabled = true
  try { await window.saga.updateCancel() } catch {}
  updateCancel.disabled = false
})

window.saga.onUpdateProgress((p) => {
  if (updatePhase !== 'downloading') return
  const total = p && p.total ? p.total : 0
  const pct = total ? Math.min(100, Math.floor((p.received / total) * 100)) : 0
  const text = `正在下载更新… ${pct}%`
  updateStatus.textContent = text
  updateStatus.hidden = false
  updateModalStatus.textContent = text
  updateModalStatus.hidden = false
})

window.saga.appVersion().then((v) => {
  $('#help-version').textContent = v || '未知'
}).catch(() => {})

/* 启动后自动检查一次：避开正在输入和已经打开的弹窗 */
let autoUpdateDone = false
let lastInputAt = Date.now()
document.addEventListener('input', () => { lastInputAt = Date.now() }, true)

function tryAutoUpdateCheck () {
  if (autoUpdateDone) return
  const modalOpen = !!document.querySelector('.modal:not([hidden])')
  if (modalOpen || Date.now() - lastInputAt < 2500) {
    setTimeout(tryAutoUpdateCheck, 3000)
    return
  }
  autoUpdateDone = true
  checkForUpdates({ quiet: true })
}
setTimeout(tryAutoUpdateCheck, 6000)

/* ---------- 使用引导 ---------- */

const GUIDE_SEEN = 'saga.guide.seen'
const GUIDE_STEPS = [
  {
    title: '这是书稿，不是成品电子书',
    body: '<p><b>Saga 是写作工具，不是阅读器。</b>它打开的是按模板创作的书稿文件夹，不是 EPUB、PDF、TXT 等成品电子书。</p><p>每一份书稿都是磁盘上的一个文件夹：<code>book.json</code> 记录书名和章节顺序，<code>chapters/</code> 里每一章是一个 HTML 文件，<code>comments.json</code> 存批注。写完后再通过「导出」生成成品。</p>'
  },
  {
    title: '新建，或者打开已有的 Saga 书稿',
    body: '<p>第一次写，点「新建书籍…」，选一个位置。Saga 会按模板建好版权、献辞、目录等前置页，以及正文和后置页；没有内容的页可以留空。</p><p>已有 Saga 书稿文件夹，点「打开书稿文件夹…」，或直接把文件夹拖进窗口。EPUB、PDF、TXT 等成品不能直接导入，需要先转换成 Saga 书稿文件夹。没有书稿？可以打开示例书《小城畸人》看看一份完整书稿长什么样。</p>'
  },
  {
    title: '在纸上写，自动保存',
    body: '<p>左边是目录，点一章就跳过去；直接在中间的纸上写。改动会自动保存，不需要按保存。</p><p>按 <code>Ctrl/⌘ + F</code> 可以在正文里查找替换，勾选「全书」会搜索整本书。</p><p>空白页上的浅灰提示只是编辑器提示，不会写进书稿。</p><p>删除章节会把文字移到书的 <code>darlings/</code> 文件夹；每次保存先写临时文件再替换，断电也不会写坏。</p>'
  },
  {
    title: '底栏与返回',
    body: '<p>底栏显示阅读进度、今日字数和全书字数；<code>+</code> / <code>−</code> 调整字号缩放。</p><p>点「← 首页」回到首页，可以换一本书、新建，或者打开别的书稿。</p><p>顶栏「书籍」改书名、作者、系列、语言、ISBN 和简介；「设置」切换深色/浅色和正文字体；选中正文文字可以添加批注。</p>'
  },
  {
    title: '写完再导出成品',
    body: '<p>Saga 的主线是「新建书稿 → 写作 → 导出成品」。顶栏「导出」支持 TXT、Markdown、HTML、EPUB、DOCX、ODT、RTF、LaTeX、PDF、投稿稿和 KDP 纸质书。</p><p>「投稿稿」按标准投稿格式生成 DOCX 或 PDF：标题页、双倍行距、页眉页码。EPUB 会带上语言、ISBN、系列和无障碍信息。</p><p>「AI」里可以复制 MCP / CLI 配置，让 Claude Desktop、Cursor、Trae 等 AI 客户端读写书稿。</p><p>「设置」切换深色/浅色和正文字体；「简介」里能看到书的文件结构，也能再次打开这份引导。</p>'
  }
]

let guideIndex = 0

function renderGuide () {
  const step = GUIDE_STEPS[guideIndex]
  $('#guide-step-no').textContent = '第 ' + (guideIndex + 1) + ' 步 / 共 ' + GUIDE_STEPS.length + ' 步'
  $('#guide-step-title').textContent = step.title
  $('#guide-step-body').innerHTML = step.body
  $('#guide-prev').hidden = guideIndex === 0
  $('#guide-next').textContent = guideIndex === GUIDE_STEPS.length - 1 ? '开始使用' : '下一步'
  const dots = $('#guide-dots')
  dots.textContent = ''
  GUIDE_STEPS.forEach((_, i) => {
    const dot = document.createElement('button')
    dot.type = 'button'
    dot.className = 'guide-dot' + (i === guideIndex ? ' on' : '')
    dot.title = '第 ' + (i + 1) + ' 步'
    dot.setAttribute('aria-label', '第 ' + (i + 1) + ' 步')
    dot.addEventListener('click', () => {
      guideIndex = i
      renderGuide()
    })
    dots.appendChild(dot)
  })
}

function openGuide (index) {
  guideIndex = Math.max(0, Math.min(Number(index) || 0, GUIDE_STEPS.length - 1))
  renderGuide()
  openModal('guide')
}

function closeGuide () {
  closeModal('guide')
  try { localStorage.setItem(GUIDE_SEEN, '1') } catch {}
}

function guideNext () {
  if (guideIndex < GUIDE_STEPS.length - 1) {
    guideIndex++
    renderGuide()
  } else {
    closeGuide()
  }
}

function guidePrev () {
  if (guideIndex > 0) {
    guideIndex--
    renderGuide()
  }
}

async function openExampleBook () {
  closeModal('about')
  if (state.meta) {
    await flush()
    if (state.dirty.size) {
      toast('还有未保存的修改，先留在这本书里')
      return
    }
  }
  try {
    const data = await window.saga.openExample()
    if (data) {
      showEditor(data)
      toast('已打开示例书《小城畸人》')
    }
  } catch (err) {
    toast('打开示例书失败：' + cleanError(err))
  }
}

$('#example-btn').addEventListener('click', openExampleBook)
$('#about-example-btn').addEventListener('click', openExampleBook)

$('#guide-btn').addEventListener('click', () => openGuide(0))
$('#about-guide-btn').addEventListener('click', () => {
  closeModal('about')
  openGuide(0)
})
$('#guide-skip').addEventListener('click', closeGuide)
$('#guide-next').addEventListener('click', guideNext)
$('#guide-prev').addEventListener('click', guidePrev)
$('#guide-modal').addEventListener('click', (e) => {
  if (e.target === $('#guide-modal') || e.target.closest('[data-close="guide"]')) {
    try { localStorage.setItem(GUIDE_SEEN, '1') } catch {}
  }
})
$('#guide-modal').addEventListener('mousedown', (e) => {
  if (e.target === $('#guide-modal')) {
    try { localStorage.setItem(GUIDE_SEEN, '1') } catch {}
  }
})
document.addEventListener('keydown', (e) => {
  if ($('#guide-modal').hidden) return
  if (e.key === 'ArrowRight') {
    e.preventDefault()
    guideNext()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    guidePrev()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeGuide()
  }
})

/* ---------- 书籍信息 ---------- */

async function loadCoverPreview () {
  const img = $('#meta-cover-img')
  const name = $('#meta-cover-name')
  const clear = $('#meta-cover-clear')
  img.hidden = true
  img.removeAttribute('src')
  name.textContent = '未选择'
  clear.hidden = true
  try {
    const data = await window.saga.coverData()
    if (!data || !data.url) return
    img.src = data.url
    img.hidden = false
    name.textContent = data.name
    clear.hidden = false
  } catch {}
}

function fillMetaForm () {
  const meta = state.meta || {}
  $('#meta-title-input').value = meta.title || state.name || ''
  $('#meta-subtitle').value = meta.subtitle || ''
  $('#meta-author').value = meta.author || ''
  $('#meta-series').value = meta.series || ''
  $('#meta-series-index').value = meta.seriesIndex || ''
  $('#meta-language').value = meta.language || 'zh-CN'
  $('#meta-isbn').value = meta.isbn || ''
  $('#meta-publisher').value = meta.publisher || ''
  $('#meta-rights').value = meta.rights || ''
  $('#meta-description').value = meta.description || ''
  $('#meta-keywords').value = Array.isArray(meta.keywords) ? meta.keywords.join('，') : (meta.keywords || '')
  $('#meta-error').hidden = true
  loadCoverPreview()
}

async function saveMetaForm () {
  if (!state.meta) return
  const title = $('#meta-title-input').value.trim()
  const error = $('#meta-error')
  if (!title) {
    error.textContent = '书名不能为空'
    error.hidden = false
    $('#meta-title-input').focus()
    return
  }
  const btn = $('#meta-save')
  btn.disabled = true
  error.hidden = true
  try {
    const meta = await window.saga.writeMeta({
      title,
      subtitle: $('#meta-subtitle').value,
      author: $('#meta-author').value,
      series: $('#meta-series').value,
      seriesIndex: $('#meta-series-index').value,
      language: $('#meta-language').value,
      isbn: $('#meta-isbn').value,
      publisher: $('#meta-publisher').value,
      rights: $('#meta-rights').value,
      description: $('#meta-description').value,
      keywords: $('#meta-keywords').value
    })
    state.meta = meta
    $('#tp-title').textContent = meta.title || state.name
    const subtitle = String(meta.subtitle || '').trim()
    $('#tp-subtitle').textContent = subtitle
    $('#tp-subtitle').hidden = !subtitle
    $('#tp-author').textContent = meta.author || '佚名'
    document.title = (meta.title || state.name) + ' — Saga'
    closeModal('meta')
    toast('书籍信息已保存')
  } catch (err) {
    error.textContent = '保存失败：' + cleanError(err)
    error.hidden = false
  } finally {
    btn.disabled = false
  }
}

$('#meta-btn').addEventListener('click', fillMetaForm)
$('#meta-save').addEventListener('click', saveMetaForm)
$('#meta-cover-pick').addEventListener('click', async () => {
  const btn = $('#meta-cover-pick')
  btn.disabled = true
  try {
    const res = await window.saga.pickCover()
    if (!res || res.canceled) return
    state.meta = res.meta
    $('#meta-cover-img').src = res.cover.url
    $('#meta-cover-img').hidden = false
    $('#meta-cover-name').textContent = res.cover.name
    $('#meta-cover-clear').hidden = false
    toast('封面已保存，导出 EPUB 时会写入')
  } catch (err) {
    toast('选择封面失败：' + cleanError(err))
  } finally {
    btn.disabled = false
  }
})
$('#meta-cover-clear').addEventListener('click', async () => {
  const btn = $('#meta-cover-clear')
  btn.disabled = true
  try {
    state.meta = await window.saga.clearCover()
    $('#meta-cover-img').hidden = true
    $('#meta-cover-img').removeAttribute('src')
    $('#meta-cover-name').textContent = '未选择'
    btn.hidden = true
    toast('封面已移除，EPUB 会使用排版标题页')
  } catch (err) {
    toast('移除封面失败：' + cleanError(err))
  } finally {
    btn.disabled = false
  }
})
for (const input of $$('#meta-modal input, #meta-modal textarea')) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.tagName === 'INPUT') {
      e.preventDefault()
      saveMetaForm()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeModal('meta')
    }
  })
}

/* ---------- 批注 ---------- */

function bodyOfChapter (id) {
  return document.querySelector(`.chapter-body[data-id="${id}"]`)
}

function elementOrParent (node) {
  if (!node) return null
  return node.nodeType === 1 ? node : node.parentElement
}

function offsetInBody (body, node, offset) {
  const range = document.createRange()
  range.selectNodeContents(body)
  range.setEnd(node, offset)
  return range.toString().length
}

// a character range inside a chapter body, for a comment's start and end
function textRangeInBody (body, start, end) {
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  let pos = 0
  let startNode = null
  let startOffset = 0
  let endNode = null
  let endOffset = 0
  let node
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length
    if (!startNode && pos + len >= start) {
      startNode = node
      startOffset = start - pos
    }
    if (pos + len >= end) {
      endNode = node
      endOffset = end - pos
      break
    }
    pos += len
  }
  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, Math.max(0, Math.min(startOffset, startNode.nodeValue.length)))
  range.setEnd(endNode, Math.max(0, Math.min(endOffset, endNode.nodeValue.length)))
  return range
}

// the quote first, its old place second, a neighbour if the text moved
function rangeForComment (comment) {
  const body = bodyOfChapter(comment.chapterId)
  if (!body || !comment.quote) return null
  const text = body.textContent || ''
  let start = -1
  if (Number.isFinite(comment.start) && text.startsWith(comment.quote, comment.start)) {
    start = comment.start
  }
  if (start < 0 && comment.prefix) {
    const needle = comment.prefix + comment.quote + (comment.suffix || '')
    const at = text.indexOf(needle)
    if (at >= 0) start = at + comment.prefix.length
  }
  if (start < 0) {
    let at = text.indexOf(comment.quote)
    if (at >= 0) {
      let best = at
      while (at >= 0) {
        if (Number.isFinite(comment.start) && Math.abs(at - comment.start) < Math.abs(best - comment.start)) best = at
        at = text.indexOf(comment.quote, at + 1)
      }
      start = best
    }
  }
  if (start < 0) return null
  return textRangeInBody(body, start, start + comment.quote.length)
}

function updateCommentCount () {
  const btn = $('#comments-btn')
  if (!btn) return
  const n = state.comments.filter((c) => !c.resolved).length
  btn.textContent = n ? '批注 ' + n : '批注'
}

function positionCommentMarks () {
  const layer = $('#comment-marks')
  if (!layer) return
  const paper = $('#paper')
  const paperRight = paper ? paper.getBoundingClientRect().right : window.innerWidth - 40
  const left = Math.min(window.innerWidth - 34, paperRight + 6)
  const used = []
  for (const mark of layer.querySelectorAll('.comment-mark')) {
    const range = commentRanges.get(mark.dataset.id)
    if (!range) {
      mark.hidden = true
      continue
    }
    const rects = range.getClientRects()
    const rect = rects.length ? rects[0] : range.getBoundingClientRect()
    if (!rect || (!rect.width && !rect.height) || rect.bottom < 30 || rect.top > window.innerHeight - 8) {
      mark.hidden = true
      continue
    }
    let top = Math.round(rect.top + Math.min(rect.height, 18) / 2 - 9)
    while (used.some((y) => Math.abs(y - top) < 19)) top += 19
    if (top > window.innerHeight - 24) {
      mark.hidden = true
      continue
    }
    used.push(top)
    mark.hidden = false
    mark.style.left = Math.max(8, left) + 'px'
    mark.style.top = top + 'px'
  }
}

function renderComments () {
  const layer = $('#comment-marks')
  if (!layer) return
  layer.textContent = ''
  commentRanges.clear()
  const highlight = window.CSS && CSS.highlights ? new Highlight() : null
  for (const comment of state.comments) {
    if (comment.resolved) continue
    const range = rangeForComment(comment)
    if (!range) continue
    if (highlight) highlight.add(range)
    commentRanges.set(comment.id, range)
    const mark = document.createElement('button')
    mark.type = 'button'
    mark.className = 'comment-mark'
    mark.dataset.id = comment.id
    mark.title = comment.note
    mark.setAttribute('aria-label', '批注：' + comment.note)
    mark.textContent = '批'
    mark.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      showCommentPop(comment.id, mark)
    })
    layer.appendChild(mark)
  }
  if (window.CSS && CSS.highlights) {
    if (highlight && highlight.size) CSS.highlights.set('saga-comment', highlight)
    else CSS.highlights.delete('saga-comment')
  }
  updateCommentCount()
  positionCommentMarks()
  if (!$('#comments-modal').hidden) renderCommentsList()
}

function reanchorComments () {
  for (const comment of state.comments) {
    const body = bodyOfChapter(comment.chapterId)
    if (!body) continue
    const range = rangeForComment(comment)
    if (!range) continue
    comment.start = offsetInBody(body, range.startContainer, range.startOffset)
    comment.end = offsetInBody(body, range.endContainer, range.endOffset)
  }
}

let commentRenderTimer = null
function scheduleCommentRender () {
  clearTimeout(commentRenderTimer)
  commentRenderTimer = setTimeout(() => {
    reanchorComments()
    renderComments()
    if (state.comments.length) scheduleCommentSave()
  }, 400)
}

function scheduleCommentSave () {
  commentsDirty = true
  clearTimeout(commentSaveTimer)
  commentSaveTimer = setTimeout(saveCommentsNow, 500)
}

async function saveCommentsNow () {
  if (!state.dir || !commentsDirty) return
  commentsDirty = false
  try {
    await window.saga.writeComments(state.comments)
  } catch (err) {
    commentsDirty = true
    toast('批注保存失败：' + cleanError(err))
  }
}

let selToolsTimer = null
function scheduleSelTools () {
  clearTimeout(selToolsTimer)
  selToolsTimer = setTimeout(updateSelTools, 30)
}

function updateSelTools () {
  const tools = $('#sel-tools')
  if (!tools) return
  const sel = window.getSelection()
  const modalOpen = !!document.querySelector('.modal:not([hidden])')
  if (modalOpen || !sel || sel.isCollapsed || !sel.rangeCount) {
    tools.hidden = true
    return
  }
  const range = sel.getRangeAt(0)
  const startBody = elementOrParent(range.startContainer)
  const endBody = elementOrParent(range.endContainer)
  const a = startBody && startBody.closest ? startBody.closest('.chapter-body') : null
  const b = endBody && endBody.closest ? endBody.closest('.chapter-body') : null
  if (!a || a !== b || !a.isContentEditable) {
    tools.hidden = true
    return
  }
  const rect = range.getBoundingClientRect()
  if (!rect || (!rect.width && !rect.height)) {
    tools.hidden = true
    return
  }
  tools.hidden = false
  tools.style.top = Math.max(36, rect.top - 38) + 'px'
  tools.style.left = Math.max(8, Math.min(window.innerWidth - 120, rect.left + rect.width / 2 - 42)) + 'px'
}

function captureCommentSelection () {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) {
    toast('请先在正文里选择文字')
    return null
  }
  const range = sel.getRangeAt(0)
  const startEl = elementOrParent(range.startContainer)
  const endEl = elementOrParent(range.endContainer)
  const startBody = startEl && startEl.closest ? startEl.closest('.chapter-body') : null
  const endBody = endEl && endEl.closest ? endEl.closest('.chapter-body') : null
  if (!startBody || !endBody) {
    toast('请先在正文里选择文字')
    return null
  }
  if (!startBody.isContentEditable) {
    toast('这一页不能添加批注')
    return null
  }
  if (startBody !== endBody) {
    toast('一次只能批注同一章里的文字')
    return null
  }
  const quote = range.toString()
  if (!quote.trim()) {
    toast('选择的文字为空')
    return null
  }
  const start = offsetInBody(startBody, range.startContainer, range.startOffset)
  const end = offsetInBody(startBody, range.endContainer, range.endOffset)
  const text = startBody.textContent || ''
  return {
    chapterId: startBody.dataset.id,
    start,
    end,
    quote,
    prefix: text.slice(Math.max(0, start - 40), start),
    suffix: text.slice(end, end + 40)
  }
}

function showCommentPop (id, anchor) {
  const comment = state.comments.find((c) => c.id === id)
  if (!comment) return
  activeCommentId = id
  hideCommentPop()
  activeCommentId = id
  const quote = comment.quote.trim()
  $('#comment-pop-quote').textContent = '“' + quote.slice(0, 160) + (quote.length > 160 ? '…' : '') + '”'
  $('#comment-pop-note').textContent = comment.note
  $('#comment-pop-resolve').textContent = comment.resolved ? '恢复批注' : '标记已解决'
  const pop = $('#comment-pop')
  pop.hidden = false
  const rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null
  const w = pop.offsetWidth || 280
  const h = pop.offsetHeight || 150
  const left = Math.max(10, Math.min(window.innerWidth - w - 12, rect ? rect.right + 10 : window.innerWidth - w - 24))
  const top = Math.max(36, Math.min(window.innerHeight - h - 12, rect ? rect.top - 8 : window.innerHeight - h - 40))
  pop.style.left = left + 'px'
  pop.style.top = top + 'px'
}

function hideCommentPop () {
  const pop = $('#comment-pop')
  if (pop) pop.hidden = true
  activeCommentId = null
}

function toggleCommentResolved (id) {
  const comment = state.comments.find((c) => c.id === id)
  if (!comment) return
  comment.resolved = !comment.resolved
  scheduleCommentSave()
  renderComments()
  hideCommentPop()
  toast(comment.resolved ? '批注已标记解决' : '批注已恢复')
}

function deleteComment (id) {
  const before = state.comments.length
  state.comments = state.comments.filter((c) => c.id !== id)
  if (state.comments.length === before) return
  scheduleCommentSave()
  renderComments()
  hideCommentPop()
  toast('批注已删除')
}

function gotoComment (id) {
  const comment = state.comments.find((c) => c.id === id)
  if (!comment) return
  closeModal('comments')
  const range = rangeForComment(comment)
  if (!range) {
    scrollToChapter(comment.chapterId)
    toast('原文已修改，批注仍保留')
    return
  }
  const stage = $('#stage')
  const top = stage.scrollTop + range.getBoundingClientRect().top - stage.getBoundingClientRect().top - stage.clientHeight / 3
  stage.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
  state.currentId = comment.chapterId
  markCurrent(comment.chapterId)
  setTimeout(() => {
    positionCommentMarks()
    showCommentPop(comment.id, { getBoundingClientRect: () => range.getBoundingClientRect() })
  }, 80)
}

function renderCommentsList () {
  const box = $('#comments-list')
  if (!box) return
  box.textContent = ''
  const order = state.meta ? state.meta.chapterOrder : []
  const items = state.comments.slice().sort((a, b) => {
    const ai = order.indexOf(a.chapterId)
    const bi = order.indexOf(b.chapterId)
    return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi) || (a.start || 0) - (b.start || 0)
  })
  if (!items.length) {
    const empty = document.createElement('p')
    empty.className = 'comments-empty'
    empty.textContent = '还没有批注。选中正文里的文字，点浮出的「添加批注」。'
    box.appendChild(empty)
    return
  }
  let lastChapter = null
  for (const comment of items) {
    if (comment.chapterId !== lastChapter) {
      const heading = document.createElement('h3')
      heading.className = 'comment-chapter'
      const known = state.meta && state.meta.chapterOrder.includes(comment.chapterId)
      heading.textContent = known ? labelOf(comment.chapterId) : '已删除的章节'
      box.appendChild(heading)
      lastChapter = comment.chapterId
    }
    const row = document.createElement('div')
    row.className = 'comment-row' + (comment.resolved ? ' resolved' : '')
    const quote = document.createElement('p')
    quote.className = 'comment-row-quote'
    const quoted = comment.quote.trim()
    quote.textContent = quoted.slice(0, 120) + (quoted.length > 120 ? '…' : '')
    const note = document.createElement('p')
    note.className = 'comment-row-note'
    note.textContent = comment.note
    if (!rangeForComment(comment)) {
      const miss = document.createElement('span')
      miss.className = 'comment-orphan'
      miss.textContent = '原文已修改'
      row.appendChild(miss)
    }
    const actions = document.createElement('div')
    actions.className = 'comment-row-actions'
    for (const [act, label] of [['goto', '定位'], ['resolve', comment.resolved ? '恢复' : '已解决'], ['delete', '删除']]) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.dataset.act = act
      btn.dataset.id = comment.id
      btn.textContent = label
      actions.appendChild(btn)
    }
    row.append(quote, note, actions)
    box.appendChild(row)
  }
}

$('#sel-comment-btn').addEventListener('mousedown', (e) => e.preventDefault())
$('#sel-comment-btn').addEventListener('click', () => {
  const picked = captureCommentSelection()
  if (!picked) return
  commentSelection = picked
  $('#comment-quote').textContent = picked.quote.trim().slice(0, 400)
  $('#comment-text').value = ''
  $('#comment-error').hidden = true
  $('#sel-tools').hidden = true
  openModal('comment')
  setTimeout(() => $('#comment-text').focus(), 30)
})
$('#comment-save').addEventListener('click', () => {
  const note = $('#comment-text').value.trim()
  const error = $('#comment-error')
  if (!note) {
    error.textContent = '批注不能为空'
    error.hidden = false
    return
  }
  if (!commentSelection) {
    error.textContent = '没有选中文字'
    error.hidden = false
    return
  }
  state.comments.push({
    id: 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    ...commentSelection,
    note,
    resolved: false,
    createdAt: new Date().toISOString()
  })
  commentSelection = null
  closeModal('comment')
  const sel = window.getSelection()
  if (sel) sel.removeAllRanges()
  scheduleCommentSave()
  renderComments()
  toast('已添加批注')
})
$('#comment-modal').addEventListener('click', (e) => {
  if (e.target === $('#comment-modal') || e.target.closest('[data-close="comment"]')) commentSelection = null
})
$('#comments-btn').addEventListener('click', renderCommentsList)
$('#comments-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]')
  if (!btn) return
  if (btn.dataset.act === 'resolve') toggleCommentResolved(btn.dataset.id)
  else if (btn.dataset.act === 'delete') deleteComment(btn.dataset.id)
  else if (btn.dataset.act === 'goto') gotoComment(btn.dataset.id)
})
function commentsMarkdown () {
  const meta = state.meta || {}
  const order = meta.chapterOrder || []
  const items = state.comments.slice().sort((a, b) => {
    const ai = order.indexOf(a.chapterId)
    const bi = order.indexOf(b.chapterId)
    return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi) || (a.start || 0) - (b.start || 0)
  })
  if (!items.length) return ''
  const unresolved = items.filter((c) => !c.resolved).length
  const lines = [
    '# 《' + (meta.title || state.name || '未命名') + '》批注',
    '',
    '共 ' + items.length + ' 条，未解决 ' + unresolved + ' 条。',
    ''
  ]
  let lastChapter = null
  for (const comment of items) {
    if (comment.chapterId !== lastChapter) {
      const known = order.includes(comment.chapterId)
      lines.push('## ' + (known ? labelOf(comment.chapterId) : '已删除的章节'), '')
      lastChapter = comment.chapterId
    }
    const quote = String(comment.quote || '').trim().replace(/\r/g, '')
    for (const line of quote.split('\n')) lines.push('> ' + line)
    lines.push('')
    lines.push(String(comment.note || '').trim())
    lines.push('')
    lines.push('- 状态：' + (comment.resolved ? '已解决' : '未解决'))
    if (comment.createdAt) lines.push('- 时间：' + String(comment.createdAt).slice(0, 10))
    lines.push('')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

async function exportComments () {
  const text = commentsMarkdown()
  if (!text) {
    toast('还没有批注可以导出')
    return
  }
  const btn = $('#comments-export')
  btn.disabled = true
  try {
    const res = await window.saga.exportComments({
      text,
      name: (state.meta && state.meta.title ? state.meta.title : state.name || '未命名') + '-批注'
    })
    if (!res || res.canceled) return
    closeModal('comments')
    toast('批注已导出 ' + String(res.file).split(/[\\/]/).pop(), 2800)
  } catch (err) {
    toast('导出批注失败：' + cleanError(err))
  } finally {
    btn.disabled = false
  }
}

async function copyComments () {
  const text = commentsMarkdown()
  if (!text) {
    toast('还没有批注可以复制')
    return
  }
  let ok = false
  try { ok = await window.saga.copyText(text) } catch {}
  toast(ok ? '批注已复制到剪贴板' : '复制失败')
}

$('#comments-copy').addEventListener('click', copyComments)
$('#comments-export').addEventListener('click', exportComments)

$('#comment-pop-resolve').addEventListener('click', () => {
  if (activeCommentId) toggleCommentResolved(activeCommentId)
})
$('#comment-pop-delete').addEventListener('click', () => {
  if (activeCommentId) deleteComment(activeCommentId)
})
$('#comment-pop-close').addEventListener('click', hideCommentPop)
document.addEventListener('mousedown', (e) => {
  const pop = $('#comment-pop')
  if (!pop || pop.hidden) return
  if (pop.contains(e.target) || e.target.closest('.comment-mark')) return
  hideCommentPop()
})
document.addEventListener('selectionchange', scheduleSelTools)
document.addEventListener('mouseup', scheduleSelTools)
document.addEventListener('keyup', (e) => {
  if (e.shiftKey || e.key === 'Escape') scheduleSelTools()
})
window.addEventListener('resize', positionCommentMarks)

/* ---------- 投稿稿 ---------- */

function fillManuscriptForm () {
  const meta = state.meta || {}
  const saved = meta.manuscript || {}
  const lang = String(meta.language || 'zh-CN').toLowerCase()
  $('#ms-byline').value = saved.byline != null ? saved.byline : (meta.author || '')
  $('#ms-header-name').value = saved.headerName || ''
  $('#ms-contact-name').value = saved.contactName != null ? saved.contactName : (meta.author || '')
  $('#ms-address').value = saved.address || ''
  $('#ms-phone').value = saved.phone || ''
  $('#ms-email').value = saved.email || ''
  $('#ms-font').value = saved.font === 'courier' ? 'courier' : 'times'
  $('#ms-paper').value = saved.paper === 'Letter' ? 'Letter' : saved.paper === 'A4' ? 'A4' : (lang.startsWith('zh') ? 'A4' : 'Letter')
  $('#ms-end').checked = saved.end !== false
  $('#manuscript-note').textContent = ''
}

function manuscriptValues () {
  return {
    byline: $('#ms-byline').value.trim(),
    headerName: $('#ms-header-name').value.trim(),
    contactName: $('#ms-contact-name').value.trim(),
    address: $('#ms-address').value,
    phone: $('#ms-phone').value.trim(),
    email: $('#ms-email').value.trim(),
    font: $('#ms-font').value,
    paper: $('#ms-paper').value,
    end: $('#ms-end').checked
  }
}

async function runManuscript (format) {
  if (!state.meta) return
  const note = $('#manuscript-note')
  const docx = $('#ms-docx')
  const pdf = $('#ms-pdf')
  docx.disabled = true
  pdf.disabled = true
  note.textContent = format === 'pdf' ? '正在排版 PDF，长书可能需要一会儿…' : '正在生成 DOCX…'
  try {
    await flush()
    const res = await window.saga.exportManuscript({ format, ...manuscriptValues() })
    if (!res || res.canceled) {
      note.textContent = '已取消，没有生成文件'
      return
    }
    state.meta.manuscript = { ...(state.meta.manuscript || {}), ...manuscriptValues() }
    closeModal('manuscript')
    const bits = ['已导出 ' + String(res.file).split(/[\\/]/).pop()]
    if (res.wordsText) bits.push(res.wordsText)
    if (res.pages) bits.push(res.pages + ' 页')
    toast(bits.join(' · '), 3600)
  } catch (err) {
    const message = '导出失败：' + cleanError(err)
    note.textContent = message
    toast(message)
  } finally {
    docx.disabled = false
    pdf.disabled = false
  }
}

document.querySelector('[data-open="manuscript"]').addEventListener('click', () => {
  closeModal('export')
  fillManuscriptForm()
})
$('#ms-docx').addEventListener('click', () => runManuscript('docx'))
$('#ms-pdf').addEventListener('click', () => runManuscript('pdf'))

/* ---------- AI 接入 ---------- */

let aiData = null

async function loadAiInfo () {
  const mcp = $('#ai-mcp')
  const cli = $('#ai-cli')
  try {
    aiData = await window.saga.aiInfo()
    mcp.textContent = aiData.mcpJson
    cli.textContent = aiData.examples.join('\n')
    const warn = $('#ai-warning')
    const pathNote = $('#ai-path-note')
    if (aiData.portable) {
      warn.textContent = '当前是便携版：每次运行都从临时目录启动，AI 客户端找不到稳定入口。请使用安装版（Saga-Setup）接入 CLI / MCP。'
      warn.hidden = false
      pathNote.hidden = true
    } else {
      warn.hidden = true
      pathNote.textContent = aiData.packaged
        ? '下面的路径按当前电脑上的安装位置自动生成。换一台电脑安装后，会显示那台电脑上的路径，不需要手改。'
        : '当前是从源码运行，下面显示的是源码文件夹的路径；安装版会自动换成安装后的位置。'
      pathNote.hidden = false
    }
  } catch (err) {
    aiData = null
    mcp.textContent = '读取失败：' + cleanError(err)
    cli.textContent = ''
    $('#ai-path-note').hidden = true
  }
}

$('#ai-btn').addEventListener('click', loadAiInfo)
for (const btn of $$('[data-copy]')) {
  btn.addEventListener('click', async () => {
    if (!aiData) await loadAiInfo()
    if (!aiData) return
    const text = btn.dataset.copy === 'mcp' ? aiData.mcpJson : aiData.examples.join('\n')
    let ok = false
    try { ok = await window.saga.copyText(text) } catch {}
    toast(ok ? '已复制到剪贴板' : '复制失败')
  })
}
for (const btn of $$('#theme-choice .theme-opt')) {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme))
}

// a confirm closed any other way is a no
const confirmModal = $('#confirm-modal')
confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal || e.target.closest('[data-close="confirm"]')) settleConfirm(false)
})
$('#confirm-ok').addEventListener('click', () => settleConfirm(true))
$('#confirm-cancel').addEventListener('click', () => settleConfirm(false))

/* exporting, and making a book from the template */

function setExportNote (text) {
  const note = $('#export-note')
  if (note) note.textContent = text || ''
}

function setExportBusy (busy) {
  for (const btn of $$('.export-opt')) btn.disabled = busy
  if (busy) setExportNote('正在导出…')
}

async function runExport (format) {
  if (!state.meta) return
  setExportBusy(true)
  try {
    await flush()
    const font = document.documentElement.dataset.font || 'serif'
    const runs = {
      pdf: () => window.saga.exportPdf({ font }),
      epub: () => window.saga.exportEpub({ font }),
      docx: () => window.saga.exportDocx({ font }),
      html: () => window.saga.exportHtml({ font }),
      odt: () => window.saga.exportOdt({ font }),
      rtf: () => window.saga.exportRtf({ font }),
      tex: () => window.saga.exportLatex({ font })
    }
    const res = runs[format] ? await runs[format]() : await window.saga.exportText(format)
    if (!res || res.canceled) {
      setExportNote('')
      return
    }
    const warnings = Array.isArray(res.warnings) && res.warnings.length ? '；' + res.warnings.join('；') : ''
    setExportNote('已导出：' + res.file + warnings)
    toast('已导出 ' + String(res.file).split(/[\\/]/).pop() + warnings, warnings ? 4200 : 2400)
  } catch (err) {
    const message = '导出失败：' + cleanError(err)
    setExportNote(message)
    toast(message)
  } finally {
    setExportBusy(false)
  }
}

/* ---------- PDF 排版 ---------- */

function pdfOptionsKey () {
  return 'saga.pdf.' + (state.dir || 'none')
}

function fillPdfForm () {
  let saved = null
  try { saved = JSON.parse(localStorage.getItem(pdfOptionsKey()) || 'null') } catch {}
  const v = saved && typeof saved === 'object' ? saved : {}
  $('#pdf-paper').value = ['A4', 'Letter', 'A5', '6x9'].includes(v.paper) ? v.paper : 'A4'
  $('#pdf-font-size').value = ['10', '11', '12', '14'].includes(String(v.fontSize)) ? String(v.fontSize) : '12'
  $('#pdf-line-height').value = ['1.4', '1.6', '1.85', '2'].includes(String(v.lineHeight)) ? String(v.lineHeight) : '1.85'
  $('#pdf-note').textContent = ''
}

async function runPdf () {
  if (!state.meta) return
  const btn = $('#pdf-create')
  const note = $('#pdf-note')
  const options = {
    paper: $('#pdf-paper').value,
    fontSize: $('#pdf-font-size').value,
    lineHeight: $('#pdf-line-height').value
  }
  btn.disabled = true
  note.textContent = '正在排版 PDF…'
  try {
    await flush()
    const res = await window.saga.exportPdf({
      font: document.documentElement.dataset.font || 'serif',
      ...options
    })
    if (!res || res.canceled) {
      note.textContent = '已取消，没有生成文件'
      return
    }
    try { localStorage.setItem(pdfOptionsKey(), JSON.stringify(options)) } catch {}
    closeModal('pdf')
    toast('已导出 ' + String(res.file).split(/[\\/]/).pop(), 2400)
  } catch (err) {
    const message = '导出失败：' + cleanError(err)
    note.textContent = message
    toast(message)
  } finally {
    btn.disabled = false
  }
}

document.querySelector('[data-open="pdf"]').addEventListener('click', () => {
  closeModal('export')
  fillPdfForm()
})
$('#pdf-create').addEventListener('click', runPdf)

function openNewBook () {
  $('#nb-title').value = ''
  $('#nb-author').value = ''
  $('#nb-error').hidden = true
  openModal('newbook')
  $('#nb-title').focus()
}

async function createNewBook () {
  const title = $('#nb-title').value.trim()
  const error = $('#nb-error')
  if (!title) {
    error.textContent = '书名不能为空'
    error.hidden = false
    $('#nb-title').focus()
    return
  }
  const btn = $('#nb-create')
  btn.disabled = true
  error.hidden = true
  try {
    const data = await window.saga.createBook({ title, author: $('#nb-author').value.trim() })
    if (!data) {
      toast('没有选择文件夹')
      return
    }
    closeModal('newbook')
    showEditor(data)
  } catch (err) {
    error.textContent = cleanError(err)
    error.hidden = false
  } finally {
    btn.disabled = false
  }
}

let kdpTrim = '6x9'
let kdpPaper = 'white'

async function runKdp () {
  const btn = $('#kdp-create')
  const note = $('#kdp-note')
  btn.disabled = true
  note.textContent = '正在排版，长书可能需要一会儿…'
  try {
    await flush()
    const res = await window.saga.exportKdp({
      trim: kdpTrim,
      paper: kdpPaper,
      guides: $('#kdp-guides').checked,
      font: document.documentElement.dataset.font || 'serif'
    })
    if (!res || res.canceled) {
      note.textContent = '已取消，没有生成文件'
      return
    }
    // the two files are on disk: close the dialog, then say so where the
    // writer is already looking
    note.textContent = ''
    closeModal('kdp')
    const summary = '已生成 KDP 内页与封面 · ' + res.pages + ' 页 · 书脊 ' + res.spine + ' 英寸'
    toast(res.warning ? summary + '；' + res.warning : summary, res.warning ? 5200 : 3200)
  } catch (err) {
    const message = '生成失败：' + cleanError(err)
    note.textContent = message
    toast(message)
  } finally {
    btn.disabled = false
  }
}

for (const btn of $$('.export-opt[data-export]')) {
  btn.addEventListener('click', () => runExport(btn.dataset.export))
}
$('#kdp-trim').addEventListener('click', (e) => {
  const btn = e.target.closest('.kdp-opt')
  if (!btn) return
  kdpTrim = btn.dataset.trim
  for (const b of $$('#kdp-trim .kdp-opt')) b.classList.toggle('on', b === btn)
})
$('#kdp-paper').addEventListener('click', (e) => {
  const btn = e.target.closest('.kdp-opt')
  if (!btn) return
  kdpPaper = btn.dataset.paper
  for (const b of $$('#kdp-paper .kdp-opt')) b.classList.toggle('on', b === btn)
})
document.querySelector('[data-open="kdp"]').addEventListener('click', () => closeModal('export'))
$('#kdp-create').addEventListener('click', runKdp)
$('#export-btn').addEventListener('click', () => setExportNote(''))
$('#new-btn').addEventListener('click', openNewBook)
$('#nb-create').addEventListener('click', createNewBook)
for (const input of [$('#nb-title'), $('#nb-author')]) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      createNewBook()
    }
  })
}

$('#nav-search-input').addEventListener('input', (e) => {
  navQuery = e.target.value
  applyNavFilter()
})
$('#nav-search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    clearNavSearch()
    e.target.blur()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const first = [...$$('.nav-item')].find((item) => !item.hidden)
    if (first) scrollToChapter(first.dataset.id)
  }
})

$('#zoom-out').addEventListener('click', () => applyZoom(zoomValue() - 10))
$('#zoom-in').addEventListener('click', () => applyZoom(zoomValue() + 10))

$('#stage').addEventListener('scroll', () => {
  if (!state.meta) return
  queueProgress()
  positionCommentMarks()
  $('#sel-tools').hidden = true
  hideCommentPop()
  if (jumpTop !== null) {
    // the picked chapter stays current until its page arrives (or the
    // writer takes the scroll back)
    const landed = Math.abs($('#stage').scrollTop - jumpTop) < 4
    if (!landed && performance.now() < jumpUntil) return
    jumpTop = null
  }
  const id = sectionAtTop()
  if (id !== state.currentId) {
    state.currentId = id
    markCurrent(id)
    updateStats()
  }
  schedulePositionSave()
})

window.addEventListener('resize', () => queueProgress())

// taking the wheel or the pointer back cancels a jump still on its way
for (const ev of ['wheel', 'touchstart', 'pointerdown']) {
  $('#stage').addEventListener(ev, () => { jumpTop = null }, { passive: true })
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (confirmPending) {
      settleConfirm(false)
      return
    }
    if ($('#find-bar').hidden === false && !document.querySelector('.modal:not([hidden])')) {
      closeFind()
      return
    }
    closePopmenu()
    for (const m of $$('.modal')) m.hidden = true
    return
  }
  if (!(e.metaKey || e.ctrlKey)) return
  const key = e.key.toLowerCase()
  if (key === 's') {
    e.preventDefault()
    flush()
  } else if (key === 'o') {
    e.preventDefault()
    $('#import-btn').click()
  } else if (key === 'f') {
    e.preventDefault()
    if (e.shiftKey) {
      const input = $('#nav-search-input')
      input.focus()
      input.select()
    } else {
      openFind()
    }
  }
})

window.addEventListener('blur', () => { flush() })
document.addEventListener('visibilitychange', () => { if (document.hidden) flush() })

window.saga.onFlush(async () => {
  await flush()
  window.saga.flushed()
})

window.saga.onBookOpened((data) => showEditor(data))

/* pasting goes in as words, not as someone else's markup */
document.addEventListener('paste', (e) => {
  const body = e.target
  if (!body || !body.closest || !body.closest('.chapter-body')) return
  if (body.contentEditable === 'false') return
  e.preventDefault()
  const text = (e.clipboardData || window.clipboardData).getData('text/plain')
  document.execCommand('insertText', false, text)
})

function attachEditor () {
  document.execCommand('defaultParagraphSeparator', false, 'p')
  document.addEventListener('dragover', (e) => {
    if (e.target.closest && e.target.closest('.chapter-body')) e.preventDefault()
  })
}

let toastTimer = null
function toast (text, duration) {
  const el = $('#toast')
  el.textContent = text
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, duration || 2400)
}

attachEditor()
$('#build-line').textContent = 'Saga · 本次启动 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false })
window.saga.log && window.saga.log('renderer up')
showRecents().then((list) => {
  if (list.length) return
  setTimeout(() => {
    if ($('#guide-modal').hidden && !$('#welcome').hidden && $('#opening').hidden &&
      localStorage.getItem(GUIDE_SEEN) !== '1') {
      openGuide(0)
    }
  }, 900)
})
openLastBook()
