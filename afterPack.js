'use strict'

const path = require('node:path')

// After electron-builder has packed the app (and before the installers are
// made), close the doors that turn the GUI binary into a debugging tool.
exports.default = async function afterPack (context) {
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses')
  const exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.exe')
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
  })
  console.log('[build] fuses applied: ' + exe)
}
