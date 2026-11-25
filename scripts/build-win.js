'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const appDir = path.join(root, 'build', 'app')
const distDir = path.join(appDir, 'dist')
const obfuscate = !process.argv.includes('--no-obfuscate')

const files = [
  'app.js',
  'main.js',
  'preload.js',
  'index.html',
  'styles.css',
  'icon.png',
  'saga.ico',
  'icon.svg',
  'LICENSE',
  'README.md'
]
const dirs = ['ai', 'example', 'fonts', 'print']

const obfuscatorOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.35,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.65,
  transformObjectKeys: false,
  unicodeEscapeSequence: false
}

function copyDir (src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dst, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

function copyApp () {
  fs.rmSync(path.join(root, 'build'), { recursive: true, force: true })
  fs.mkdirSync(appDir, { recursive: true })

  for (const name of files) {
    fs.copyFileSync(path.join(root, name), path.join(appDir, name))
  }
  for (const name of dirs) {
    copyDir(path.join(root, name), path.join(appDir, name))
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const buildPkg = {
    name: pkg.name,
    productName: pkg.productName,
    version: pkg.version,
    description: pkg.description,
    author: pkg.author,
    license: pkg.license,
    repository: pkg.repository,
    main: pkg.main,
    private: true
  }
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(buildPkg, null, 2) + '\n')

  fs.copyFileSync(path.join(root, 'electron-builder.yml'), path.join(appDir, 'electron-builder.yml'))
  fs.copyFileSync(path.join(root, 'afterPack.js'), path.join(appDir, 'afterPack.js'))
}

function obfuscateApp () {
  const JavaScriptObfuscator = require('javascript-obfuscator')
  const targets = [
    'app.js',
    'main.js',
    'preload.js',
    ...fs.readdirSync(path.join(appDir, 'ai'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => path.join('ai', name))
  ]

  for (const relative of targets) {
    const file = path.join(appDir, relative)
    const before = fs.readFileSync(file, 'utf8')
    const after = JavaScriptObfuscator.obfuscate(before, obfuscatorOptions).getObfuscatedCode()
    fs.writeFileSync(file, after, 'utf8')
    console.log(relative + ': ' + before.length + ' -> ' + after.length)
  }
}

copyApp()
if (obfuscate) obfuscateApp()

const cli = path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js')
execFileSync(process.execPath, [cli, '--win', '--publish', 'never'], {
  cwd: appDir,
  stdio: 'inherit'
})

console.log('artifacts: ' + distDir)
