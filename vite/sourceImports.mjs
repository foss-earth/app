// Local-source mode (README): Node loads the Vite plugins of linked Earth libraries
// from their TypeScript source. Their relative imports name the .js files a build
// would emit, so a missing .js import falls back to the .ts file beside it.
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.{1,2}\/.*\.js$/.test(specifier)) throw error
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context)
    }
  },
})
