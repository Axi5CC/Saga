'use strict'

/*  The whole renderer API. The page never sees fs or path; it asks here.  */

const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('saga', {
  lastBook: () => ipcRenderer.invoke('book:last'),
  recentBooks: () => ipcRenderer.invoke('books:recent'),
  forgetBook: (dir) => ipcRenderer.invoke('book:forget', dir),
  pickBook: () => ipcRenderer.invoke('book:pick'),
  openPath: (dir) => ipcRenderer.invoke('book:openPath', dir),
  // a dropped folder's real path (the page only ever sees a File object)
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file) } catch { return '' }
  },
  writeChapter: (chId, html) => ipcRenderer.invoke('chapter:write', chId, html),
  writeTitle: (chId, title) => ipcRenderer.invoke('book:title', chId, title),
  writeMeta: (patch) => ipcRenderer.invoke('book:meta', patch),
  pickCover: () => ipcRenderer.invoke('book:coverPick'),
  coverData: () => ipcRenderer.invoke('book:coverData'),
  clearCover: () => ipcRenderer.invoke('book:coverClear'),
  backupChapter: (chId, tag) => ipcRenderer.invoke('chapter:backup', chId, tag),
  writeComments: (items) => ipcRenderer.invoke('comments:write', items),
  exportComments: (payload) => ipcRenderer.invoke('comments:export', payload),
  createChapter: (kind, beforeId) => ipcRenderer.invoke('chapter:create', kind, beforeId),
  deleteChapter: (chId) => ipcRenderer.invoke('chapter:delete', chId),
  moveChapter: (chId, beforeId) => ipcRenderer.invoke('chapter:move', chId, beforeId),
  createBook: (opts) => ipcRenderer.invoke('book:create', opts),
  closeBook: () => ipcRenderer.invoke('book:close'),
  openExample: () => ipcRenderer.invoke('example:open'),
  aiInfo: () => ipcRenderer.invoke('ai:info'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateCancel: () => ipcRenderer.invoke('update:cancel'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (fn) => ipcRenderer.on('update:progress', (_e, p) => fn(p)),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', String(text == null ? '' : text)),
  exportText: (format) => ipcRenderer.invoke('export:text', format),
  exportHtml: (opts) => ipcRenderer.invoke('export:html', opts),
  exportEpub: (opts) => ipcRenderer.invoke('export:epub', opts),
  exportDocx: (opts) => ipcRenderer.invoke('export:docx', opts),
  exportOdt: (opts) => ipcRenderer.invoke('export:odt', opts),
  exportRtf: (opts) => ipcRenderer.invoke('export:rtf', opts),
  exportLatex: (opts) => ipcRenderer.invoke('export:latex', opts),
  exportKdp: (opts) => ipcRenderer.invoke('export:kdp', opts),
  exportPdf: (opts) => ipcRenderer.invoke('export:pdf', opts),
  exportManuscript: (opts) => ipcRenderer.invoke('export:manuscript', opts),
  setTheme: (theme) => ipcRenderer.invoke('app:theme', theme),
  onBookOpened: (fn) => ipcRenderer.on('book:opened', (_e, data) => fn(data)),
  onFlush: (fn) => ipcRenderer.on('app:flush', () => fn()),
  flushed: () => ipcRenderer.send('ui:flushed'),
  ready: (info) => ipcRenderer.send('ui:ready', info),
  log: (text) => ipcRenderer.send('ui:log', String(text))
})
