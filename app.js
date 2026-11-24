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
  currentId: null,
  dirty: new Set(),
  saveTimer: null
}

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
}

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
  state.currentId = null
  state.dirty = new Set()
  jumpTop = null
  closePopmenu()
  navQuery = ''
  $('#nav-search-input').value = ''
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
  state.currentId = null
  state.dirty.clear()
  dirtyTitles.clear()
  wordCache.clear()
  textCache.clear()
  document.title = 'Saga'
  closePopmenu()
  clearNavSearch()
  $('#export-btn').hidden = true
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

/* ---------- 使用引导 ---------- */

const GUIDE_SEEN = 'saga.guide.seen'
const GUIDE_STEPS = [
  {
    title: '这是书稿，不是成品电子书',
    body: '<p><b>Saga 是写作工具，不是阅读器。</b>它打开的是按模板创作的书稿文件夹，不是 EPUB、PDF、TXT 等成品电子书。</p><p>每一份书稿都是磁盘上的一个文件夹：<code>book.json</code> 记录书名和章节顺序，<code>chapters/</code> 里每一章是一个 HTML 文件。写完后再通过「导出」生成成品。</p>'
  },
  {
    title: '新建，或者打开已有的 Saga 书稿',
    body: '<p>第一次写，点「新建书籍…」，选一个位置。Saga 会按模板建好版权、献辞、目录等前置页，以及正文和后置页；没有内容的页可以留空。</p><p>已有 Saga 书稿文件夹，点「打开书稿文件夹…」，或直接把文件夹拖进窗口。EPUB、PDF、TXT 等成品不能直接导入，需要先转换成 Saga 书稿文件夹。没有书稿？可以打开示例书《小城畸人》看看一份完整书稿长什么样。</p>'
  },
  {
    title: '在纸上写，自动保存',
    body: '<p>左边是目录，点一章就跳过去；直接在中间的纸上写。改动会自动保存，不需要按保存。</p><p>空白页上的浅灰提示只是编辑器提示，不会写进书稿。</p><p>删除章节会把文字移到书的 <code>darlings/</code> 文件夹；每次保存先写临时文件再替换，断电也不会写坏。</p>'
  },
  {
    title: '底栏与返回',
    body: '<p>底栏显示阅读进度、今日字数和全书字数；<code>+</code> / <code>−</code> 调整字号缩放。</p><p>点「← 首页」回到首页，可以换一本书、新建，或者打开别的书稿。</p><p>「设置」里可以切换深色/浅色和正文字体。</p>'
  },
  {
    title: '写完再导出成品',
    body: '<p>Saga 的主线是「新建书稿 → 写作 → 导出成品」。顶栏「导出」支持 TXT、Markdown、HTML、EPUB、DOCX、ODT、RTF、LaTeX、PDF 和 KDP 纸质书。</p><p>「AI」里可以复制 MCP / CLI 配置，让 Claude Desktop、Cursor、Trae 等 AI 客户端读写书稿。</p><p>「设置」切换深色/浅色和正文字体；「简介」里能看到书的文件结构，也能再次打开这份引导。</p>'
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
    setExportNote('已导出：' + res.file)
    toast('已导出 ' + String(res.file).split(/[\\/]/).pop())
  } catch (err) {
    const message = '导出失败：' + cleanError(err)
    setExportNote(message)
    toast(message)
  } finally {
    setExportBusy(false)
  }
}

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
    const input = $('#nav-search-input')
    input.focus()
    input.select()
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
