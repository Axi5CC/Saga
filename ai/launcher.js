'use strict'

/*  Starting the window from the CLI, and the windowless print process.

    Saga.exe is a GUI process, so a terminal cannot wait on it directly. We
    spawn it with pipes (or detached for "open") and read a result file the
    print process writes before it exits.  */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const HEADLESS_FLAG = '--headless-export'
const RESULT_FLAG = '--headless-result'

function packagedApp () {
  // resources/ai when a CLI or MCP client runs this file, app.asar/ai when the
  // window's own builder calls it from inside the package
  const parent = path.basename(path.dirname(__dirname)).toLowerCase()
  return parent === 'resources' || parent === 'app.asar'
}

function appRoot () {
  return path.resolve(__dirname, '..')
}

function electronExe () {
  if (process.versions.electron) return process.execPath
  try {
    const electron = require('electron')
    if (typeof electron === 'string') return electron
  } catch {}
  return path.join(appRoot(), 'node_modules', 'electron', 'dist', 'electron.exe')
}

function guiArgs (args) {
  return packagedApp() ? args : [appRoot(), ...args]
}

function childEnv () {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function runHeadless (request) {
  return new Promise((resolve, reject) => {
    const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 7)
    const reqFile = path.join(os.tmpdir(), 'saga-export-' + stamp + '.json')
    const resultFile = path.join(os.tmpdir(), 'saga-export-' + stamp + '.result.json')
    fs.writeFileSync(reqFile, JSON.stringify(request, null, 2))
    const exe = electronExe()
    const args = guiArgs([HEADLESS_FLAG, reqFile, RESULT_FLAG, resultFile])
    const child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], env: childEnv() })
    let stderr = ''
    let done = false

    const clean = () => {
      try { fs.unlinkSync(reqFile) } catch {}
      try { fs.unlinkSync(resultFile) } catch {}
    }
    const finish = (err, result) => {
      if (done) return
      done = true
      clearTimeout(timer)
      clean()
      if (err) reject(err)
      else resolve(result)
    }

    child.stderr.on('data', (data) => {
      if (stderr.length < 8000) stderr += data.toString()
    })
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      finish(new Error('导出超时（180 秒）'))
    }, 180000)
    child.on('error', (err) => finish(err))
    child.on('exit', (code) => {
      let result = null
      try { result = JSON.parse(fs.readFileSync(resultFile, 'utf8')) } catch {}
      if (result && result.ok) return finish(null, result)
      const reason = result && result.error
        ? result.error
        : '无窗口导出没有返回结果（退出码 ' + code + '）' + (stderr ? '：' + stderr.trim().slice(0, 500) : '')
      finish(new Error(reason))
    })
  })
}

function openInSaga (book) {
  const child = spawn(electronExe(), guiArgs(['--open', book]), {
    detached: true,
    stdio: 'ignore',
    env: childEnv()
  })
  child.unref()
}

module.exports = { runHeadless, openInSaga, electronExe }
