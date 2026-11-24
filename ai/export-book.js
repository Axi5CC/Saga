'use strict'

/*  One book, out to a file: the CLI and MCP share this.  */

const fs = require('node:fs')
const path = require('node:path')
const core = require('./book-core')
const formats = require('./book-formats')
const { runHeadless } = require('./launcher')

const FORMATS = {
  txt: '.txt', md: '.md', markdown: '.md', html: '.html',
  epub: '.epub', docx: '.docx', odt: '.odt', rtf: '.rtf',
  tex: '.tex', latex: '.tex', pdf: '.pdf'
}

async function exportBook (bookPath, opts) {
  opts = opts || {}
  const book = core.readBook(bookPath)
  const raw = String(opts.format || '').toLowerCase()
  const format = raw === 'markdown' ? 'md' : raw === 'latex' ? 'tex' : raw
  if (!format) throw new Error('缺少导出格式')
  const title = core.plainName(book.meta.title || book.name)

  if (format === 'pdf' || format === 'kdp') {
    if (format === 'pdf') {
      const out = opts.out
        ? path.resolve(opts.out)
        : path.join(path.dirname(book.dir), title + '.pdf')
      return runHeadless({ kind: 'pdf', book: book.dir, out })
    }
    const outDir = opts.outDir
      ? path.resolve(opts.outDir)
      : path.join(path.dirname(book.dir), title + '-kdp')
    const trim = String(opts.trim || '6x9')
    if (!formats.KDP_TRIMS[trim]) throw new Error('开本只能是 ' + Object.keys(formats.KDP_TRIMS).join(' / '))
    const paper = String(opts.paper || 'white')
    if (paper !== 'white' && paper !== 'cream') throw new Error('纸张只能是 white 或 cream')
    return runHeadless({ kind: 'kdp', book: book.dir, outDir, trim, paper })
  }

  const ext = FORMATS[format]
  if (!ext) throw new Error('不支持的格式：' + raw)
  const out = opts.out
    ? path.resolve(opts.out)
    : path.join(path.dirname(book.dir), title + ext)
  fs.mkdirSync(path.dirname(out), { recursive: true })

  let data
  if (format === 'txt') data = formats.bookText(book.meta, book.chapters)
  else if (format === 'md') data = formats.bookMarkdown(book.meta, book.chapters)
  else if (format === 'html') data = formats.htmlBook(book.meta, book.chapters)
  else if (format === 'rtf') data = formats.rtfBook(book.meta, book.chapters)
  else if (format === 'tex') data = formats.latexBook(book.meta, book.chapters)
  else if (format === 'epub') data = formats.makeZip(formats.epubFiles(book.meta, book.chapters))
  else if (format === 'docx') data = formats.makeZip(formats.docxFiles(book.meta, book.chapters))
  else if (format === 'odt') data = formats.makeZip(formats.odtFiles(book.meta, book.chapters))
  else throw new Error('不支持的格式：' + raw)

  fs.writeFileSync(out, data)
  return { ok: true, file: out }
}

module.exports = { exportBook, FORMATS }
