'use strict'

/*  Export builders shared by the window and the AI tools.

    These are the same functions the window has always used: TXT, Markdown,
    HTML, EPUB, DOCX, ODT, RTF, LaTeX, the print page and the KDP pair. They
    only read a meta object and a map of chapter HTML; no Electron here.  */

const crypto = require('node:crypto')
const zlib = require('node:zlib')

const {
  kindOfMeta, bookLabel, htmlText, escapeHtml, STORY_KINDS, CONTENTS_SKIP, countWords
} = require('./book-core')
const manuscript = require('./manuscript')

// the same choices the window offers; system keeps the old export defaults
const FONTS = {
  serif: {
    name: 'Noto Serif SC',
    stack: '"Noto Serif SC", Georgia, "Times New Roman", "Songti SC", "SimSun", serif',
    docxAscii: 'Noto Serif SC', docxEastAsia: 'Noto Serif SC',
    dir: 'noto-serif', css: '400.css', filesDir: 'files'
  },
  sans: {
    name: 'Noto Sans SC',
    stack: '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Helvetica Neue", sans-serif',
    docxAscii: 'Noto Sans SC', docxEastAsia: 'Noto Sans SC',
    dir: 'noto-sans', css: '400.css', filesDir: 'files'
  },
  kai: {
    name: 'LXGW WenKai Lite',
    stack: '"LXGW WenKai Lite", "KaiTi", "STKaiti", "Songti SC", serif',
    docxAscii: 'LXGW WenKai Lite', docxEastAsia: 'LXGW WenKai Lite',
    dir: 'wenkai', css: 'regular.css', filesDir: 'files'
  },
  fangsong: {
    name: 'Zhuque Fangsong',
    stack: '"Zhuque Fangsong", "FangSong", "STFangsong", "Songti SC", serif',
    docxAscii: 'Zhuque Fangsong', docxEastAsia: 'Zhuque Fangsong',
    dir: 'zhuque', css: 'regular.css', filesDir: 'files'
  },
  xiaowei: {
    name: 'ZCOOL XiaoWei',
    stack: '"ZCOOL XiaoWei", "Songti SC", "SimSun", serif',
    docxAscii: 'ZCOOL XiaoWei', docxEastAsia: 'ZCOOL XiaoWei',
    dir: 'xiaowei', css: 'regular.css', filesDir: 'files'
  },
  brush: {
    name: 'Ma Shan Zheng',
    stack: '"Ma Shan Zheng", "KaiTi", "STKaiti", cursive',
    docxAscii: 'Ma Shan Zheng', docxEastAsia: 'Ma Shan Zheng',
    dir: 'brush', css: 'regular.css', filesDir: 'files'
  },
  smiley: {
    name: 'Smiley Sans',
    stack: '"Smiley Sans", "Microsoft YaHei", "PingFang SC", sans-serif',
    docxAscii: 'Smiley Sans', docxEastAsia: 'Smiley Sans',
    dir: 'smiley', css: 'regular.css', filesDir: 'files'
  },
  system: {
    name: 'SimSun',
    stack: 'Georgia, "Times New Roman", "Songti SC", "SimSun", serif',
    docxAscii: 'Times New Roman', docxEastAsia: 'SimSun',
    dir: null
  }
}

function fontOf (key) {
  return FONTS[key] || FONTS.system
}

function contentsLines (meta) {
  return meta.chapterOrder
    .filter((id) => !CONTENTS_SKIP.includes(kindOfMeta(meta, id)))
    .map((id) => bookLabel(meta, id))
}

function bookText (meta, chapters) {
  const out = ['《' + (meta.title || '未命名') + '》']
  if (String(meta.subtitle || '').trim()) out.push(String(meta.subtitle).trim())
  if (String(meta.author || '').trim()) out.push(String(meta.author).trim())
  out.push('')
  for (const id of meta.chapterOrder) {
    const kind = kindOfMeta(meta, id)
    if (kind === 'contents') {
      out.push('目录', '', ...contentsLines(meta), '')
      continue
    }
    out.push(bookLabel(meta, id), '')
    const body = htmlText(chapters[id] || '')
    if (body) out.push(body, '')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

function bookMarkdown (meta, chapters) {
  const out = ['# ' + (meta.title || '未命名')]
  if (String(meta.subtitle || '').trim()) out.push('*' + String(meta.subtitle).trim() + '*')
  if (String(meta.author || '').trim()) out.push(String(meta.author).trim())
  out.push('')
  for (const id of meta.chapterOrder) {
    const kind = kindOfMeta(meta, id)
    if (kind === 'contents') {
      out.push('## 目录', '')
      for (const line of contentsLines(meta)) out.push('- ' + line)
      out.push('')
      continue
    }
    out.push('## ' + bookLabel(meta, id), '')
    const body = htmlText(chapters[id] || '')
    if (body) out.push(body, '')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}


// the papers the PDF dialog offers; width and height in inches, the same
// numbers Chromium's printToPDF takes
const PDF_PAPERS = {
  A4: { w: 8.2677, h: 11.6929, css: 'A4' },
  Letter: { w: 8.5, h: 11, css: 'Letter' },
  A5: { w: 5.827, h: 8.268, css: 'A5' },
  '6x9': { w: 6, h: 9, css: '6in 9in' }
}

function printHtml (meta, chapters, opts) {
  const font = fontOf(opts && opts.font)
  const fontLink = opts && opts.fontCss
    ? '<link rel="stylesheet" href="' + escapeHtml(opts.fontCss) + '">'
    : ''
  const paper = PDF_PAPERS[(opts && opts.paper) || 'A4'] || PDF_PAPERS.A4
  const size = Math.min(18, Math.max(8, Number(opts && opts.fontSize) || 12))
  const leading = Math.min(2.4, Math.max(1.2, Number(opts && opts.lineHeight) || 1.85))
  // the title page fills the sheet whatever the paper is
  const titleHeight = Math.max(110, Math.round(paper.h * 25.4 - 48))
  let body = ''
  for (const id of meta.chapterOrder) {
    const kind = kindOfMeta(meta, id)
    const label = escapeHtml(bookLabel(meta, id))
    if (kind === 'contents') {
      const items = contentsLines(meta).map((line) => '<li>' + escapeHtml(line) + '</li>').join('')
      body += '<section class="chapter kind-contents"><h2>目录</h2><ul class="toc">' + items + '</ul></section>'
      continue
    }
    body += '<section class="chapter kind-' + kind + (STORY_KINDS.has(kind) ? ' story' : ' page') +
      '"><h2>' + label + '</h2>' + String(chapters[id] || '') + '</section>'
  }
  const subtitle = String(meta.subtitle || '').trim()
  const author = String(meta.author || '').trim()
  return `<!doctype html>
<html lang="${escapeHtml(languageOf(meta))}"><head><meta charset="utf-8">
${fontLink}
<style>
  @page { size: ${paper.css}; }
  html, body { margin: 0; padding: 0; }
  body { font-family: ${font.stack};
    font-size: ${size}pt; line-height: ${leading}; color: #111; }
  .titlepage { height: ${titleHeight}mm; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center; page-break-after: always; }
  .titlepage h1 { font-size: ${Math.round(size * 2.2)}pt; font-weight: 700; margin: 0 0 10mm; letter-spacing: .04em; }
  .titlepage .sub { font-size: ${Math.round(size * 1.15)}pt; font-style: italic; margin: 0 0 22mm; }
  .titlepage .by { font-size: ${size}pt; letter-spacing: .2em; }
  .chapter { page-break-before: always; }
  .chapter h2 { text-align: center; font-size: ${Math.round(size * 1.08)}pt; font-weight: 700;
    margin: 34mm 0 12mm; letter-spacing: .2em; }
  .chapter p { text-indent: 2em; margin: 0; white-space: pre-wrap; }
  .chapter.page p { text-indent: 0; }
  .chapter.kind-dedication p, .chapter.kind-epigraph p {
    text-indent: 0; text-align: center; font-style: italic; }
  .chapter.kind-copyright p, .chapter.kind-acknowledgments p, .chapter.kind-about p {
    text-indent: 2em; font-size: ${Math.max(8, size - 1.5)}pt; }
  .chapter.kind-part h2, .chapter.kind-extra h2, .chapter.kind-epilogue h2 { letter-spacing: .3em; }
  .toc { list-style: none; margin: 0 12mm; padding: 0; }
  .toc li { margin: 0 0 2.2mm; font-size: ${Math.max(8, size - 1)}pt; }
</style></head><body>
<section class="titlepage"><h1>${escapeHtml(meta.title || '未命名')}</h1>
${subtitle ? '<p class="sub">' + escapeHtml(subtitle) + '</p>' : ''}
${author ? '<p class="by">' + escapeHtml(author) + '</p>' : ''}</section>
${body}
</body></html>`
}

/* ---------- EPUB and DOCX: the book as a package ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32 (buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// a plain zip, made here: no dependency, and the EPUB's mimetype can be the
// first entry, stored rather than compressed, as the format asks
function makeZip (entries) {
  const now = new Date()
  const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff
  const day = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff
  const chunks = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const method = entry.store ? 0 : 8
    const body = method === 0 ? data : zlib.deflateRawSync(data)
    const sum = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(sum, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, name, body)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt16LE(time, 12)
    cd.writeUInt16LE(day, 14)
    cd.writeUInt32LE(sum, 16)
    cd.writeUInt32LE(body.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, name]))
    offset += local.length + name.length + body.length
  }
  const cdBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cdBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, cdBuf, end])
}

// XHTML demands void elements close; a pasted <img> or <hr> is not enough.
const VOID_TAGS = 'area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr'

function xhtmlFragment (html) {
  const voidTag = new RegExp('<(' + VOID_TAGS + ')(\\b[^>]*?)(\\/?)>', 'gi')
  return String(html || '')
    .replace(voidTag, (match, tag, attrs) => '<' + tag + attrs.replace(/\/\s*$/, '') + '/>')
    .replace(/&nbsp;/gi, '&#160;')
    // a bare ampersand is not XML; leave a written entity alone
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
}

// EPUB 3 wants a real language, and KDP checks it against the book.  A book
// made before the field existed is Chinese, which is what Saga spoke then.
function languageOf (meta) {
  const raw = String((meta && meta.language) || 'zh-CN').trim().replace(/_/g, '-')
  return /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/i.test(raw) ? raw : 'zh-CN'
}

function keywordsOf (meta) {
  const raw = meta && meta.keywords
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[,，;；\n]/)
  return list.map((x) => String(x).trim()).filter(Boolean).slice(0, 40)
}

function isbnOf (meta) {
  const digits = String((meta && meta.isbn) || '').replace(/[^0-9Xx]/g, '')
  return /^[0-9]{9}[0-9Xx]$/.test(digits) || /^[0-9]{13}$/.test(digits) ? digits : ''
}

// KDP's accessibility checks look for these, and a book without them can be
// flagged even when the text itself is clean.
function accessibilityMetadata () {
  return [
    '<meta property="schema:accessMode">textual</meta>',
    '<meta property="schema:accessModeSufficient">textual</meta>',
    '<meta property="schema:accessibilityFeature">structuralNavigation</meta>',
    '<meta property="schema:accessibilityFeature">tableOfContents</meta>',
    '<meta property="schema:accessibilityFeature">readingOrder</meta>',
    '<meta property="schema:accessibilityHazard">none</meta>',
    '<meta property="schema:accessibilitySummary">Text-only book with a navigable table of contents and chapter-level headings.</meta>'
  ].join('\n')
}

// what the export dialog can say after an EPUB is written
function epubAccessibility (meta, chapters) {
  const warnings = []
  if (!String((meta && meta.title) || '').trim()) warnings.push('缺少书名')
  const rawLanguage = String((meta && meta.language) || '').trim()
  if (!rawLanguage) warnings.push('未设置语言，已按 zh-CN 导出')
  else if (languageOf(meta) !== rawLanguage.replace(/_/g, '-')) {
    warnings.push('语言代码无效，已按 ' + languageOf(meta) + ' 导出')
  }
  let images = 0
  let withoutAlt = 0
  for (const id of (meta && meta.chapterOrder) || []) {
    const tags = String(chapters[id] || '').match(/<img\b[^>]*>/gi) || []
    images += tags.length
    withoutAlt += tags.filter((tag) => !/\balt\s*=/i.test(tag)).length
  }
  if (withoutAlt) warnings.push('有 ' + withoutAlt + ' 张图片缺少 alt 文本')
  return { warnings, images, imagesWithoutAlt: withoutAlt, language: languageOf(meta) }
}

function epubCss (font) {
  return `
body { margin: 5%; font-family: ${font.stack}; line-height: 1.75; }
h1 { text-align: center; font-size: 1.4em; margin: 2.2em 0 1.4em; letter-spacing: .12em; }
p { text-indent: 2em; margin: 0; }
.chapter.page p { text-indent: 0; }
.kind-dedication p, .kind-epigraph p { text-align: center; font-style: italic; }
.kind-copyright p, .kind-acknowledgments p, .kind-about p { text-indent: 2em; font-size: .9em; }
.titlepage { text-align: center; margin-top: 35%; }
.titlepage h1 { font-size: 2.2em; letter-spacing: 0; margin: 0 0 1em; }
.titlepage .sub { text-indent: 0; font-style: italic; margin: 0 0 2em; }
.titlepage .by { text-indent: 0; letter-spacing: .2em; }
.coverpage { margin: 0; padding: 0; text-align: center; }
.coverpage img { max-width: 100%; max-height: 100%; }
`
}

function epubFiles (meta, chapters, opts) {
  const font = fontOf(opts && opts.font)
  const fontHref = opts && opts.fontHref ? String(opts.fontHref) : ''
  const fontCss = opts && opts.fontCss ? String(opts.fontCss) : ''
  const fontEntries = (opts && opts.fontEntries) || []
  const fontLink = fontHref
    ? '<link rel="stylesheet" href="' + escapeHtml(fontHref) + '" type="text/css"/>'
    : ''
  const cover = opts && opts.cover && opts.cover.name && opts.cover.data && opts.cover.mediaType
    ? opts.cover
    : null
  const coverHref = cover ? String(cover.name) : ''
  const title = meta.title || '未命名'
  const subtitle = String(meta.subtitle || '').trim()
  const author = String(meta.author || '').trim()
  const lang = languageOf(meta)
  const keywords = keywordsOf(meta)
  const isbn = isbnOf(meta)
  const series = String(meta.series || '').trim()
  const seriesIndex = /^[1-9]\d*$/.test(String(meta.seriesIndex || '').trim()) ? String(meta.seriesIndex).trim() : ''
  const description = String(meta.description || '').trim()
  const publisher = String(meta.publisher || '').trim()
  const rights = String(meta.rights || '').trim()
  const identifier = isbn ? 'urn:isbn:' + isbn : 'urn:uuid:' + crypto.randomUUID()
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const seriesMeta = series
    ? '<meta property="belongs-to-collection" id="series">' + escapeHtml(series) + '</meta>\n' +
      '<meta refines="#series" property="collection-type">series</meta>' +
      (seriesIndex ? '\n<meta refines="#series" property="group-position">' + escapeHtml(seriesIndex) + '</meta>' : '')
    : ''
  const subjects = keywords.map((word) => '<dc:subject>' + escapeHtml(word) + '</dc:subject>').join('\n')
  const items = []
  for (const id of meta.chapterOrder) {
    if (kindOfMeta(meta, id) === 'contents') continue
    items.push({ id, kind: kindOfMeta(meta, id), label: bookLabel(meta, id) })
  }
  items.forEach((item, index) => {
    item.href = 'text-' + String(index + 1).padStart(3, '0') + '.xhtml'
  })
  const navItems = items.map((item) =>
    '<li><a href="' + item.href + '">' + escapeHtml(item.label) + '</a></li>').join('')
  const firstStory = items.find((item) => STORY_KINDS.has(item.kind)) || items[0]
  const landmarkItems = [
    cover ? '<li><a epub:type="cover" href="cover.xhtml">封面</a></li>' : '',
    '<li><a epub:type="titlepage" href="title.xhtml">书名页</a></li>',
    '<li><a epub:type="toc" href="nav.xhtml">目录</a></li>',
    firstStory ? '<li><a epub:type="bodymatter" href="' + firstStory.href + '">正文</a></li>' : ''
  ].filter(Boolean).join('')
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeHtml(lang)}" lang="${escapeHtml(lang)}">
<head><meta charset="utf-8"/><title>目录</title><link rel="stylesheet" href="style.css" type="text/css"/>${fontLink}</head>
<body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>${navItems}</ol></nav>
<nav epub:type="landmarks" id="landmarks" hidden="hidden"><h2>Landmarks</h2><ol>${landmarkItems}</ol></nav></body></html>`
  const titlePage = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeHtml(lang)}" lang="${escapeHtml(lang)}">
<head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><link rel="stylesheet" href="style.css" type="text/css"/>${fontLink}</head>
<body><section class="titlepage"><h1>${escapeHtml(title)}</h1>
${subtitle ? '<p class="sub">' + escapeHtml(subtitle) + '</p>' : ''}
${author ? '<p class="by">' + escapeHtml(author) + '</p>' : ''}
</section></body></html>`
  const coverPage = cover ? `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeHtml(lang)}" lang="${escapeHtml(lang)}">
<head><meta charset="utf-8"/><title>封面</title><link rel="stylesheet" href="style.css" type="text/css"/></head>
<body><section class="coverpage" epub:type="cover"><img src="${escapeHtml(coverHref)}" alt="${escapeHtml(title)}"/></section></body></html>` : ''
  const manifestItems = items.map((item, index) =>
    '<item id="t' + (index + 1) + '" href="' + item.href + '" media-type="application/xhtml+xml"/>').join('\n')
  const spineItems = items.map((item, index) =>
    '<itemref idref="t' + (index + 1) + '"/>').join('\n')
  const coverManifest = cover
    ? '<item id="coverpage" href="cover.xhtml" media-type="application/xhtml+xml"/>\n' +
      '<item id="cover-image" href="' + escapeHtml(coverHref) + '" media-type="' + escapeHtml(cover.mediaType) + '" properties="cover-image"/>\n'
    : ''
  const coverSpine = cover ? '<itemref idref="coverpage"/>\n' : ''
  const coverMeta = cover ? '<meta name="cover" content="cover-image"/>\n' : ''
  const fontManifest = (fontHref
    ? '<item id="fontcss" href="' + escapeHtml(fontHref) + '" media-type="text/css"/>\n'
    : '') + fontEntries.map((entry, index) =>
    '<item id="font' + (index + 1) + '" href="' + escapeHtml(entry.name) + '" media-type="font/woff2"/>').join('\n')
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId" xml:lang="${escapeHtml(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="BookId">${escapeHtml(identifier)}</dc:identifier>
<dc:title>${escapeHtml(title)}</dc:title>
${author ? '<dc:creator>' + escapeHtml(author) + '</dc:creator>' : ''}
<dc:language>${escapeHtml(lang)}</dc:language>
${publisher ? '<dc:publisher>' + escapeHtml(publisher) + '</dc:publisher>' : ''}
${rights ? '<dc:rights>' + escapeHtml(rights) + '</dc:rights>' : ''}
${description ? '<dc:description>' + escapeHtml(description) + '</dc:description>' : ''}
${subjects}
${seriesMeta}
<meta property="dcterms:modified">${modified}</meta>
${coverMeta}${accessibilityMetadata()}
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="style" href="style.css" media-type="text/css"/>
<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>
${coverManifest}${manifestItems}
${fontManifest}
</manifest>
<spine>
${coverSpine}<itemref idref="titlepage"/>
<itemref idref="nav"/>
${spineItems}
</spine>
</package>`
  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  const pages = items.map((item) => {
    const cls = STORY_KINDS.has(item.kind) ? 'story' : 'page'
    return {
      name: 'OEBPS/' + item.href,
      data: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeHtml(lang)}" lang="${escapeHtml(lang)}">
<head><meta charset="utf-8"/><title>${escapeHtml(item.label)}</title><link rel="stylesheet" href="style.css" type="text/css"/>${fontLink}</head>
<body><section class="chapter ${cls} kind-${item.kind}"><h1>${escapeHtml(item.label)}</h1>${xhtmlFragment(chapters[item.id] || '')}</section></body></html>`
    }
  })
  return [
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/style.css', data: epubCss(font) },
    { name: 'OEBPS/title.xhtml', data: titlePage },
    ...(cover ? [
      { name: 'OEBPS/cover.xhtml', data: coverPage },
      { name: 'OEBPS/' + coverHref, data: cover.data }
    ] : []),
    ...(fontHref && fontCss ? [{ name: 'OEBPS/' + fontHref, data: fontCss }] : []),
    ...fontEntries.map((entry) => ({ name: 'OEBPS/' + entry.name, data: entry.data })),
    ...pages
  ]
}

function docxParagraphs (html) {
  return htmlText(html).split(/\n{2,}/).map((text) => text.trim()).filter(Boolean)
}

function docxRun (text, opts, font) {
  const face = font || fontOf()
  const rPr = ['<w:rFonts w:ascii="' + face.docxAscii + '" w:hAnsi="' + face.docxAscii +
    '" w:eastAsia="' + face.docxEastAsia + '"/>']
  if (opts.bold) rPr.push('<w:b/>')
  if (opts.italic) rPr.push('<w:i/>')
  if (opts.size) rPr.push('<w:sz w:val="' + opts.size + '"/><w:szCs w:val="' + opts.size + '"/>')
  return '<w:r><w:rPr>' + rPr.join('') + '</w:rPr><w:t xml:space="preserve">' + escapeHtml(text) + '</w:t></w:r>'
}

function docxPara (text, opts, font) {
  opts = opts || {}
  const pPr = []
  if (opts.align) pPr.push('<w:jc w:val="' + opts.align + '"/>')
  if (opts.indent) pPr.push('<w:ind w:firstLine="' + opts.indent + '"/>')
  pPr.push('<w:spacing w:line="' + (opts.line || 240) + '" w:lineRule="auto" w:before="' +
    (opts.before || 0) + '" w:after="' + (opts.after || 0) + '"/>')
  return '<w:p><w:pPr>' + pPr.join('') + '</w:pPr>' + docxRun(text, opts, font) + '</w:p>'
}

function docxDocument (meta, chapters, fontKey) {
  const font = fontOf(fontKey)
  const title = meta.title || '未命名'
  const subtitle = String(meta.subtitle || '').trim()
  const author = String(meta.author || '').trim()
  const paragraphs = []
  paragraphs.push(docxPara(title, { align: 'center', bold: true, size: 56, before: 2400, after: 240 }, font))
  if (subtitle) paragraphs.push(docxPara(subtitle, { align: 'center', italic: true, size: 28, after: 240 }, font))
  if (author) paragraphs.push(docxPara(author, { align: 'center', size: 24, after: 240 }, font))
  paragraphs.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
  let first = true
  for (const id of meta.chapterOrder) {
    const kind = kindOfMeta(meta, id)
    if (kind === 'contents') continue
    if (!first) paragraphs.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    first = false
    paragraphs.push(docxPara(bookLabel(meta, id), { align: 'center', bold: true, size: 30, before: 240, after: 240 }, font))
    for (const text of docxParagraphs(chapters[id] || '')) {
      if (kind === 'copyright' || kind === 'acknowledgments' || kind === 'about') {
        paragraphs.push(docxPara(text, { indent: 480, size: 21 }, font))
      } else if (kind === 'dedication' || kind === 'epigraph') {
        paragraphs.push(docxPara(text, { align: 'center', italic: true, size: 24 }, font))
      } else if (STORY_KINDS.has(kind)) {
        paragraphs.push(docxPara(text, { indent: 480, size: 24, line: 360 }, font))
      } else {
        paragraphs.push(docxPara(text, { size: 24 }, font))
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paragraphs.join('\n')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`
}

function docxFiles (meta, chapters, fontKey) {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  return [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: docxDocument(meta, chapters, fontKey) }
  ]
}

/* ---------- a web page, an RTF, an ODT, and LaTeX ---------- */

function htmlBook (meta, chapters, fontKey) {
  const font = fontOf(fontKey)
  const title = escapeHtml(meta.title || '未命名')
  const subtitle = String(meta.subtitle || '').trim()
  const author = String(meta.author || '').trim()
  const items = []
  for (const id of meta.chapterOrder) {
    if (kindOfMeta(meta, id) === 'contents') continue
    items.push({ id, kind: kindOfMeta(meta, id), label: bookLabel(meta, id) })
  }
  const nav = items.map((item, index) =>
    '<li><a href="#c' + (index + 1) + '">' + escapeHtml(item.label) + '</a></li>').join('')
  const sections = items.map((item, index) => {
    const cls = STORY_KINDS.has(item.kind) ? 'story' : 'page'
    return '<section id="c' + (index + 1) + '" class="chapter ' + cls + ' kind-' + item.kind +
      '"><h2>' + escapeHtml(item.label) + '</h2>' + String(chapters[item.id] || '') + '</section>'
  }).join('\n')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #efede8; color: #1c1c1c;
    font-family: ${font.stack}; line-height: 1.8; }
  main { max-width: 46em; margin: 0 auto; padding: 4em 2.4em 6em;
    background: #fbfaf7; box-shadow: 0 0 40px rgba(0, 0, 0, .08); }
  .titlepage { text-align: center; padding: 28vh 0 22vh; }
  .titlepage h1 { font-size: 2.6em; margin: 0 0 .5em; letter-spacing: .02em; }
  .titlepage .sub { font-style: italic; font-size: 1.1em; margin: 0 0 2em; }
  .titlepage .by { letter-spacing: .2em; }
  nav.toc { margin: 0 0 4em; }
  nav.toc h1 { text-align: center; font-size: 1.15em; letter-spacing: .3em; }
  nav.toc ol { margin: 0 2em; padding-left: 1.2em; }
  nav.toc li { margin: .35em 0; }
  nav.toc a { color: inherit; text-decoration: none; }
  nav.toc a:hover { color: #9a7b3f; }
  section.chapter { margin: 0 0 4em; }
  section.chapter h2 { text-align: center; font-size: 1.25em; font-weight: 700;
    letter-spacing: .15em; margin: 0 0 1.6em; }
  section.chapter p { text-indent: 2em; margin: 0; white-space: pre-wrap; }
  section.page p { text-indent: 0; }
  section.kind-dedication p, section.kind-epigraph p { text-align: center; font-style: italic; }
  section.kind-copyright p, section.kind-acknowledgments p, section.kind-about p {
    text-indent: 2em; font-size: .9em; }
  @media (max-width: 640px) { main { padding: 2em 1.4em 4em; box-shadow: none; } }
  @media print { body { background: #fff; } main { box-shadow: none; max-width: none; padding: 0; }
    section.chapter { page-break-before: always; } }
</style></head><body><main>
<header class="titlepage"><h1>${title}</h1>
${subtitle ? '<p class="sub">' + escapeHtml(subtitle) + '</p>' : ''}
${author ? '<p class="by">' + escapeHtml(author) + '</p>' : ''}
</header>
<nav class="toc"><h1>目录</h1><ol>${nav}</ol></nav>
${sections}
</main></body></html>`
}

function rtfEscape (text) {
  let out = ''
  for (const ch of String(text)) {
    const code = ch.codePointAt(0)
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch
    else if (ch === '\n') out += '\\line '
    else if (code >= 0x20 && code < 0x7f) out += ch
    else if (code <= 0xffff) out += '\\u' + (code > 32767 ? code - 65536 : code) + '?'
    else {
      const rest = code - 0x10000
      const high = 0xd800 + (rest >> 10)
      const low = 0xdc00 + (rest & 0x3ff)
      out += '\\u' + (high - 65536) + '?\\u' + (low - 65536) + '?'
    }
  }
  return out
}

function rtfPara (text, opts) {
  opts = opts || {}
  const bits = ['\\pard\\plain\\f0']
  if (opts.align === 'center') bits.push('\\qc')
  if (opts.bold) bits.push('\\b')
  if (opts.italic) bits.push('\\i')
  bits.push('\\fs' + (opts.size || 24))
  if (opts.indent) bits.push('\\fi' + opts.indent)
  if (opts.line) bits.push('\\sl' + opts.line + '\\slmult1')
  if (opts.before) bits.push('\\sb' + opts.before)
  if (opts.after) bits.push('\\sa' + opts.after)
  return bits.join('') + ' ' + rtfEscape(text) + '\\par\n'
}

function rtfBook (meta, chapters, fontKey) {
  const font = fontOf(fontKey)
  const title = meta.title || '未命名'
  const subtitle = String(meta.subtitle || '').trim()
  const author = String(meta.author || '').trim()
  let out = String.raw`{\rtf1\ansi\ansicpg65001\deff0{\fonttbl{\f0\fnil\fcharset134 ` +
    font.name + String.raw`;}}\viewkind4\uc1` + '\n'
  out += rtfPara(title, { align: 'center', bold: true, size: 56, after: 240 })
  if (subtitle) out += rtfPara(subtitle, { align: 'center', italic: true, size: 28, after: 240 })
  if (author) out += rtfPara(author, { align: 'center', size: 24, after: 240 })
  out += '\\page\n'
  let first = true
  for (const id of meta.chapterOrder) {
    const kind = kindOfMeta(meta, id)
    if (kind === 'contents') continue
    if (!first) out += '\\page\n'
    first = false
    out += rtfPara(bookLabel(meta, id), { align: 'center', bold: true, size: 30, before: 240, after: 240 })
    for (const text of docxParagraphs(chapters[id] || '')) {
      if (kind === 'copyright' || kind === 'acknowledgments' || kind === 'about') {
        out += rtfPara(text, { indent: 480, size: 21 })
      } else if (kind === 'dedication' || kind === 'epigraph') {
        out += rtfPara(text, { align: 'center', italic: true, size: 24 })
      } else if (STORY_KINDS.has(kind)) {
        out += rtfPara(text, { indent: 480, size: 24, line: 360 })
      } else {
        out += rtfPara(text, { size: 24 })
      }
    }
  }
  return out + '}\n'
}

const ODT_NS = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
  `xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ` +
  `xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ` +
  `xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ` +
  `xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"`

function odtText (text) {
  return escapeHtml(text).replace(/\n/g, '<text:line-break/>')
}

function odtFiles (meta, chapters, fontKey) {
  const font = fontOf(fontKey)
  const title = meta.title || '未命名'
  const subtitle = String(meta.subtitle || '').trim()
  const author = String(meta.author || '').trim()
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${ODT_NS} office:version="1.2">
<office:font-face-decls><style:font-face style:name="SimSun" svg:font-family="SimSun"/></office:font-face-decls>
<office:styles><style:style style:name="Standard" style:family="paragraph" style:class="text"/></office:styles>
<office:automatic-styles>
<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2.5cm" fo:margin-bottom="2.5cm" fo:margin-left="2.5cm" fo:margin-right="2.5cm"/></style:page-layout>
</office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>
</office:document-styles>`

  const paragraphs = []
  paragraphs.push('<text:p text:style-name="PTitle">' + odtText(title) + '</text:p>')
  if (subtitle) paragraphs.push('<text:p text:style-name="PSubtitle">' + odtText(subtitle) + '</text:p>')
  if (author) paragraphs.push('<text:p text:style-name="PAuthor">' + odtText(author) + '</text:p>')
  paragraphs.push('<text:p text:style-name="PBreak"/>')
  let first = true
  for (const id of meta.chapterOrder) {
    const kind = kindOfMeta(meta, id)
    if (kind === 'contents') continue
    if (!first) paragraphs.push('<text:p text:style-name="PBreak"/>')
    first = false
    paragraphs.push('<text:h text:outline-level="1" text:style-name="PHeading">' +
      escapeHtml(bookLabel(meta, id)) + '</text:h>')
    for (const text of docxParagraphs(chapters[id] || '')) {
      let style = 'PBody'
      if (kind === 'copyright' || kind === 'acknowledgments' || kind === 'about') style = 'PSmall'
      else if (kind === 'dedication' || kind === 'epigraph') style = 'PCenter'
      else if (!STORY_KINDS.has(kind)) style = 'PPlain'
      paragraphs.push('<text:p text:style-name="' + style + '">' + odtText(text) + '</text:p>')
    }
  }
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${ODT_NS} office:version="1.2">
<office:font-face-decls><style:font-face style:name="SimSun" svg:font-family="SimSun"/></office:font-face-decls>
<office:automatic-styles>
<style:style style:name="PTitle" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/><style:text-properties style:font-name="SimSun" fo:font-size="24pt" fo:font-weight="bold"/></style:style>
<style:style style:name="PSubtitle" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/><style:text-properties style:font-name="SimSun" fo:font-size="14pt" fo:font-style="italic"/></style:style>
<style:style style:name="PAuthor" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/><style:text-properties style:font-name="SimSun" fo:font-size="12pt"/></style:style>
<style:style style:name="PHeading" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center" fo:margin-top="1cm" fo:margin-bottom="0.8cm"/><style:text-properties style:font-name="SimSun" fo:font-size="15pt" fo:font-weight="bold"/></style:style>
<style:style style:name="PBody" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-indent="0.74cm" fo:line-height="150%"/><style:text-properties style:font-name="SimSun" fo:font-size="12pt"/></style:style>
<style:style style:name="PPlain" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:line-height="150%"/><style:text-properties style:font-name="SimSun" fo:font-size="12pt"/></style:style>
<style:style style:name="PSmall" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-indent="0.74cm"/><style:text-properties style:font-name="SimSun" fo:font-size="10.5pt"/></style:style>
<style:style style:name="PCenter" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/><style:text-properties style:font-name="SimSun" fo:font-size="12pt" fo:font-style="italic"/></style:style>
<style:style style:name="PBreak" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page"/></style:style>
</office:automatic-styles>
<office:body><office:text>
${paragraphs.join('\n')}
</office:text></office:body>
</office:document-content>`
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`
  return [
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', store: true },
    { name: 'META-INF/manifest.xml', data: manifest },
    { name: 'content.xml', data: contentXml.replaceAll('SimSun', font.name) },
    { name: 'styles.xml', data: stylesXml.replaceAll('SimSun', font.name) }
  ]
}

function latexEscape (text) {
  const map = {
    '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&',
    '#': '\\#', '^': '\\textasciicircum{}', '_': '\\_', '%': '\\%', '~': '\\textasciitilde{}'
  }
  return String(text).replace(/[\\{}$&#^_%~]/g, (ch) => map[ch])
}

function latexBook (meta, chapters, fontKey) {
  const font = fontOf(fontKey)
  const title = latexEscape(meta.title || '未命名')
  const subtitle = String(meta.subtitle || '').trim()
  const author = latexEscape(meta.author || '佚名')
  const titleLine = subtitle ? title + '\\\\[0.8em]{\\large ' + latexEscape(subtitle) + '}' : title
  let out = String.raw`\documentclass[UTF8,12pt,a4paper]{ctexbook}
\usepackage[margin=2.5cm]{geometry}
\setCJKmainfont{` + font.name + String.raw`}
\setlength{\parindent}{2em}
\title{` + titleLine + String.raw`}
\author{` + author + String.raw`}
\date{}
\begin{document}
\maketitle
\tableofcontents
`
  for (const id of meta.chapterOrder) {
    const kind = kindOfMeta(meta, id)
    if (kind === 'contents') continue
    const plainTitle = String((meta.chapterTitles && meta.chapterTitles[id]) || '').trim()
    const label = latexEscape(bookLabel(meta, id))
    const heading = plainTitle ? latexEscape(plainTitle) : ''
    if (kind === 'part') out += String.raw`\part{` + heading + '}\n'
    else if (kind === 'chapter') out += String.raw`\chapter{` + heading + '}\n'
    else {
      out += String.raw`\chapter*{` + label + '}\n'
      if (!CONTENTS_SKIP.includes(kind)) {
        out += String.raw`\addcontentsline{toc}{chapter}{` + label + '}\n'
      }
    }
    const blocks = docxParagraphs(chapters[id] || '')
    if (kind === 'copyright' || kind === 'acknowledgments' || kind === 'about') {
      out += '{\\small\n' + blocks.map(latexEscape).join('\n\n') + '\n}\n'
    } else if (kind === 'dedication' || kind === 'epigraph') {
      out += '\\begin{center}\\itshape\n' + blocks.map(latexEscape).join('\\\\[0.6em]\n') + '\n\\end{center}\n'
    } else {
      out += blocks.map(latexEscape).join('\n\n') + '\n'
    }
  }
  return out + String.raw`\end{document}
`
}

/* ---------- standard manuscript format ---------- */

// Saga writes only paragraphs, so each <p> becomes one manuscript paragraph.
// A line of *** or # is the writer's own scene break; an <hr> is too.
function manuscriptParas (html) {
  const source = String(html || '')
  const out = []
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>|<hr\b[^>]*\/?>/gi
  let match
  let found = false
  while ((match = re.exec(source))) {
    found = true
    if (match[1] === undefined) {
      out.push({ sceneBreak: true })
      continue
    }
    const text = htmlText(match[1])
    if (!text.trim()) continue
    if (/^(?:\*\s*){3,}$|^#+$/.test(text.trim())) {
      out.push({ sceneBreak: true })
      continue
    }
    for (const line of text.split('\n')) {
      const clean = line.trim()
      if (clean) out.push({ runs: [{ text: clean }] })
    }
  }
  if (!found) {
    for (const line of htmlText(source).split('\n')) {
      const clean = line.trim()
      if (clean) out.push({ runs: [{ text: clean }] })
    }
  }
  return out
}

const MANUSCRIPT_SKIP = new Set([
  'copyright', 'dedication', 'contents', 'opening', 'foreword',
  'afterword', 'acknowledgments', 'about'
])

// What a submission carries: the story, parts and an epigraph.  Front and
// back pages stay out, as agents ask.  An unwritten page stays out too: a
// blank chapter should not become a blank sheet in the manuscript.
function manuscriptSections (meta, chapters) {
  const raw = []
  for (const id of meta.chapterOrder) {
    const kind = kindOfMeta(meta, id)
    if (MANUSCRIPT_SKIP.has(kind)) continue
    raw.push({ id, kind, paras: manuscriptParas(chapters[id] || '') })
  }
  // A page enters the manuscript only when it has words; a part also stays
  // when a written chapter follows it.  Numbering then comes from this
  // shorter list, so unwritten template pages leave no gaps.
  const keep = raw.map(() => false)
  for (let i = 0; i < raw.length; i++) {
    const section = raw[i]
    if (section.kind !== 'part') {
      keep[i] = section.paras.length > 0
      continue
    }
    let writing = section.paras.length > 0
    for (let j = i + 1; j < raw.length && raw[j].kind !== 'part'; j++) {
      if (raw[j].paras.length) { writing = true; break }
    }
    keep[i] = writing
  }
  const included = raw.filter((section, index) => keep[index])
  const labelMeta = { ...meta, chapterOrder: included.map((section) => section.id) }
  return included.map((section) => {
    if (section.kind === 'epigraph') {
      return { kind: 'epigraph', heading: '', paras: section.paras }
    }
    if (section.kind === 'part') {
      return { kind: 'part', heading: bookLabel(labelMeta, section.id), partTitle: '', paras: section.paras }
    }
    return { kind: 'chapter', heading: bookLabel(labelMeta, section.id), paras: section.paras }
  })
}

function manuscriptModel (meta, chapters, opts) {
  opts = opts || {}
  const lang = languageOf(meta)
  const sections = manuscriptSections(meta, chapters).map((section) => {
    const words = section.paras.reduce((n, p) => {
      if (p.sceneBreak || !p.runs) return n
      return n + countWords(p.runs.map((r) => r.text || '').join(' '))
    }, 0)
    return { ...section, words }
  })
  const words = sections.reduce((n, s) => n + s.words, 0)
  const byline = String(opts.byline != null ? opts.byline : (meta.author || '')).trim()
  const contactName = String(opts.contactName != null ? opts.contactName : byline).trim()
  const addressLines = String(opts.address || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const lines = [...addressLines, String(opts.phone || '').trim(), String(opts.email || '').trim()].filter(Boolean)
  const shown = manuscript.roundWords(words)
  const numeric = shown.toLocaleString(lang.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US')
  const title = String(meta.title || '未命名').trim()
  const paper = String(opts.paper || (lang.toLowerCase().startsWith('zh') ? 'A4' : 'Letter'))
  return {
    title,
    byline,
    headerName: String(opts.headerName || manuscript.surnameOf(byline)).trim(),
    headerTitle: String(opts.headerTitle || title.toLocaleUpperCase(lang)).trim(),
    contact: { name: contactName, lines },
    wordsText: lang.toLowerCase().startsWith('zh') ? '约 ' + numeric + ' 字' : 'about ' + numeric + ' words',
    byText: byline ? (lang.toLowerCase().startsWith('zh') ? byline : 'by ' + byline) : '',
    endText: opts.end === false ? '' : (lang.toLowerCase().startsWith('zh') ? '完' : 'END'),
    font: opts.font === 'courier' ? 'courier' : 'times',
    paper: paper === 'A4' ? 'A4' : 'Letter',
    lang,
    short: false,
    sections,
    words
  }
}

function manuscriptHtml (model, opts) {
  return manuscript.html(model, opts)
}

function manuscriptDocxEntries (model) {
  return manuscript.docxEntries(model)
}

/* ---------- a paperback for KDP ---------- */

const KDP_TRIMS = {
  '5x8': { w: 5, h: 8 },
  '5.25x8': { w: 5.25, h: 8 },
  '5.5x8.5': { w: 5.5, h: 8.5 },
  '6x9': { w: 6, h: 9 }
}
const KDP_PAPER = { white: 0.002252, cream: 0.0025 }

function kdpInteriorHtml (meta, chapters, opts) {
  const font = fontOf(opts && opts.font)
  const fontLink = opts && opts.fontCss
    ? '<link rel="stylesheet" href="' + escapeHtml(opts.fontCss) + '">'
    : ''
  const trim = (opts && opts.trim) || KDP_TRIMS['6x9']
  const storyBreak = opts && opts.fallback ? 'page' : 'recto'
  const lang = languageOf(meta)
  const title = escapeHtml(meta.title || '未命名')
  const subtitle = String(meta.subtitle || '').trim()
  const author = String(meta.author || '').trim()
  let body = ''
  for (const id of meta.chapterOrder) {
    const kind = kindOfMeta(meta, id)
    if (kind === 'contents') continue
    const story = STORY_KINDS.has(kind)
    body += '<section class="chapter ' + (story ? 'story' : 'page') + ' kind-' + kind +
      '"><h2>' + escapeHtml(bookLabel(meta, id)) + '</h2>' + String(chapters[id] || '') + '</section>'
  }
  return `<!doctype html>
<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">
${fontLink}
<style>
  /* Paged.js lays this out as real pages: page numbers, running heads,
     chapter openings on a right-hand page, and blank versos where needed. */
  @page {
    size: ${trim.w}in ${trim.h}in;
    margin: 0.75in;
    @top-left { content: string(booktitle); font: 8pt ${font.stack}; color: #555; letter-spacing: .08em; }
    @top-right { content: string(chapter); font: 8pt ${font.stack}; color: #555; letter-spacing: .08em; }
    @bottom-center { content: counter(page); font: 9pt ${font.stack}; color: #333; }
  }
  @page:left {
    margin-left: 0.75in; margin-right: 0.875in;
    @top-right { content: none; }
    @bottom-center { content: none; }
    @bottom-left { content: counter(page); font: 9pt ${font.stack}; color: #333; }
  }
  @page:right {
    margin-left: 0.875in; margin-right: 0.75in;
    @top-left { content: none; }
    @bottom-center { content: none; }
    @bottom-right { content: counter(page); font: 9pt ${font.stack}; color: #333; }
  }
  @page title { @top-left { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } }
  @page front { @top-left { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } @bottom-center { content: none; } }
  @page:blank { @top-left { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } @bottom-center { content: none; } }
  html, body { margin: 0; padding: 0; }
  body { font-family: ${font.stack}; font-size: 11pt; line-height: 1.6; color: #111; }
  p { orphans: 2; widows: 2; }
  .titlepage { page: title; text-align: center; padding-top: 2.2in; break-after: page; }
  .titlepage h1 { font-size: 24pt; font-weight: 700; margin: 0 0 12pt; letter-spacing: .02em;
    string-set: booktitle content(); }
  .titlepage .sub { font-size: 13pt; font-style: italic; margin: 0 0 24pt; }
  .titlepage .by { font-size: 12pt; letter-spacing: .18em; }
  .chapter { break-before: page; }
  .chapter.story { break-before: ${storyBreak}; }
  .chapter.page { page: front; }
  .chapter h2 { text-align: center; font-size: 14pt; font-weight: 700;
    margin: 0 0 18pt; letter-spacing: .12em; }
  .chapter.story h2 { string-set: chapter content(); }
  .chapter p { text-indent: 2em; margin: 0; white-space: pre-wrap; }
  .chapter.page p { text-indent: 0; }
  .kind-dedication p, .kind-epigraph p { text-align: center; font-style: italic; }
  .kind-copyright p, .kind-acknowledgments p, .kind-about p { text-indent: 2em; font-size: 9.5pt; }
</style></head><body>
<section class="titlepage"><h1>${title}</h1>
${subtitle ? '<p class="sub">' + escapeHtml(subtitle) + '</p>' : ''}
${author ? '<p class="by">' + escapeHtml(author) + '</p>' : ''}
</section>
${body}
</body></html>`
}

function kdpEstimateScript (trim) {
  return `(() => {
    const width = Math.max(220, (${trim.w} - 1.75) * 96)
    document.body.style.width = width + 'px'
    const pageHeight = Math.max(260, (${trim.h} - 1.5) * 96)
    let pages = 1
    for (const sec of document.querySelectorAll('.chapter')) {
      const h = sec.getBoundingClientRect().height
      pages += Math.max(1, Math.ceil(h / pageHeight))
    }
    return pages
  })()`
}

function kdpCoverHtml (meta, pages, spine, trim, opts) {
  const guides = !!(opts && opts.guides)
  const bleed = 0.125
  const safe = 0.25
  const fullW = trim.w * 2 + spine + bleed * 2
  const fullH = trim.h + bleed * 2
  const title = escapeHtml(meta.title || '未命名')
  const subtitle = escapeHtml(String(meta.subtitle || '').trim())
  const author = escapeHtml(String(meta.author || '').trim())
  const series = String(meta.series || '').trim()
  const seriesIndex = String(meta.seriesIndex || '').trim()
  const seriesLine = escapeHtml(series ? series + (seriesIndex ? ' · ' + seriesIndex : '') : '')
  const blurb = escapeHtml(String(meta.description || '').trim()).replace(/\r?\n/g, '<br>')
  const blurbSize = blurb.length > 1200 ? 8 : blurb.length > 700 ? 9 : 10
  const spineText = pages >= 100 && spine >= 0.25
  const spineLine = escapeHtml([meta.title || '', String(meta.author || '').trim()].filter(Boolean).join(' · '))
  const titleChars = Array.from(String(meta.title || '未命名')).length
  const titleSize = titleChars > 160 ? 13 : titleChars > 90 ? 16 : titleChars > 48 ? 19 : titleChars > 24 ? 22 : 28
  const guideLayer = !guides ? '' : `
  <div class="guide trim-guide"></div>
  <div class="guide safe-guide"></div>
  <div class="guide spine-guide"></div>
  <div class="guide-label back-label">封底 · ${trim.w} × ${trim.h} in</div>
  <div class="guide-label spine-label">书脊 ${spine.toFixed(3)} in</div>
  <div class="guide-label front-label">封面</div>`
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  @page { size: ${fullW}in ${fullH}in; margin: 0; }
  html, body { margin: 0; padding: 0; width: ${fullW}in; height: ${fullH}in; overflow: hidden; }
  body { font-family: Georgia, "Times New Roman", "Songti SC", "SimSun", serif; color: #1d1a16; }
  .cover { position: relative; width: 100%; height: 100%; background: #f6f1e7; }
  .panel { position: absolute; top: ${bleed}in; height: ${trim.h}in; overflow: hidden; }
  .back { left: ${bleed}in; width: ${trim.w}in; background: #efe8da; }
  .spine { left: ${bleed + trim.w}in; width: ${spine}in; background: #e6dcc9; }
  .front { left: ${bleed + trim.w + spine}in; width: ${trim.w}in; background: #f6f1e7; }

  .front-inner { position: absolute; left: 0.45in; right: 0.45in; top: 0.42in; bottom: 0.5in;
    display: flex; flex-direction: column; align-items: center; text-align: center; }
  .series { margin: 0 0 auto; color: #7c7364; font-size: 8.5pt; letter-spacing: .22em;
    text-transform: uppercase; }
  .front h1 { margin: 0; max-width: 100%; font-size: ${titleSize}pt; line-height: 1.16;
    font-weight: 700; letter-spacing: .03em; overflow-wrap: break-word; }
  .front .sub { margin: 0.16in 0 0; max-width: 92%; font-size: 12pt; font-style: italic;
    color: #51493e; line-height: 1.4; }
  .front .rule { width: 0.72in; margin: 0.26in 0; border-top: 1px solid #b3a690; }
  .front .by { margin: auto 0 0; font-size: 12pt; letter-spacing: .18em; }

  .spine .s { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    writing-mode: vertical-rl; text-orientation: mixed; font-size: 10pt; letter-spacing: .12em; }
  .spine .s.series { color: #7c7364; font-size: 8pt; letter-spacing: .18em; }

  .back-inner { position: absolute; left: 0.45in; right: 0.45in; top: 0.45in; bottom: 1.55in;
    overflow: hidden; }
  .blurb { font-size: ${blurbSize}pt; line-height: 1.7; color: #3a342b; }
  .blurb:empty { display: none; }
  .barcode { position: absolute; right: 0.25in; bottom: 0.25in; width: 2in; height: 1.2in;
    background: #fff; }
  .barcode span { position: absolute; inset: 0; display: flex; align-items: center;
    justify-content: center; color: #a39d92; font: 8pt/1.4 "Segoe UI", sans-serif; letter-spacing: .08em; }

  .guide { position: absolute; pointer-events: none; }
  .trim-guide { left: ${bleed}in; top: ${bleed}in; width: ${trim.w * 2 + spine}in; height: ${trim.h}in;
    border: 1px dashed rgba(90, 70, 40, .55); }
  .safe-guide { left: ${bleed + safe}in; top: ${bleed + safe}in;
    width: ${trim.w * 2 + spine - safe * 2}in; height: ${trim.h - safe * 2}in;
    border: 1px dashed rgba(90, 70, 40, .3); }
  .spine-guide { left: ${bleed + trim.w}in; top: ${bleed}in; width: ${spine}in; height: ${trim.h}in;
    border-left: 1px solid rgba(90, 70, 40, .28); border-right: 1px solid rgba(90, 70, 40, .28); }
  .guide-label { position: absolute; top: ${bleed + 0.08}in; color: #8f8779;
    font: 7pt/1 "Segoe UI", sans-serif; letter-spacing: .08em; }
  .back-label { left: ${bleed + 0.1}in; }
  .spine-label { left: ${bleed + trim.w + 0.04}in; }
  .front-label { left: ${bleed + trim.w + spine + 0.1}in; }
</style></head><body><div class="cover">
<div class="panel back">
  <div class="back-inner"><div class="blurb">${blurb}</div></div>
  <div class="barcode">${guides ? '<span>条码区 2 × 1.2 in</span>' : ''}</div>
</div>
<div class="panel spine">${spineText ? '<div class="s">' + spineLine + '</div>' : ''}</div>
<div class="panel front">
  <div class="front-inner">
    ${seriesLine ? '<div class="series">' + seriesLine + '</div>' : '<div class="series"></div>'}
    <h1>${title}</h1>
    ${subtitle ? '<p class="sub">' + subtitle + '</p>' : ''}
    <div class="rule"></div>
    ${author ? '<div class="by">' + author + '</div>' : ''}
  </div>
</div>
${guideLayer}
</div></body></html>`
}

function pdfPageCount (buf) {
  const text = buf.toString('latin1')
  let max = 0
  const re = /\/Count\s+(\d+)/g
  let match
  while ((match = re.exec(text))) max = Math.max(max, Number(match[1]))
  return max || null
}

module.exports = {
  FONTS,
  fontOf,
  contentsLines,
  bookText,
  bookMarkdown,
  printHtml,
  PDF_PAPERS,
  crc32,
  makeZip,
  xhtmlFragment,
  epubFiles,
  epubAccessibility,
  languageOf,
  keywordsOf,
  isbnOf,
  docxParagraphs,
  docxRun,
  docxPara,
  docxDocument,
  docxFiles,
  htmlBook,
  rtfEscape,
  rtfPara,
  rtfBook,
  odtText,
  odtFiles,
  latexEscape,
  latexBook,
  manuscriptParas,
  manuscriptSections,
  manuscriptModel,
  manuscriptHtml,
  manuscriptDocxEntries,
  KDP_TRIMS,
  KDP_PAPER,
  kdpInteriorHtml,
  kdpEstimateScript,
  kdpCoverHtml,
  pdfPageCount
}
