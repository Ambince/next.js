/* eslint-env jest */

import {
  fetchViaHTTP,
  findPort,
  killApp,
  launchApp,
  waitFor,
} from 'next-test-utils'
import { join } from 'path'

const context = { appDir: join(__dirname, '../'), appPort: NaN, app: null }

jest.setTimeout(1000 * 60 * 2)

describe('Middleware overriding a Node.js API', () => {
  describe('dev mode', () => {
    let output = ''

    beforeAll(async () => {
      output = ''
      context.appPort = await findPort()
      context.app = await launchApp(context.appDir, context.appPort, {
        onStdout(msg) {
          output += msg
        },
        onStderr(msg) {
          output += msg
        },
      })
    })

    afterAll(() => killApp(context.app))

    it('shows a warning but allows overriding', async () => {
      const res = await fetchViaHTTP(context.appPort, '/')
      await waitFor(500)
      expect(res.status).toBe(200)
      expect(output).toContain('A Node.js API is used (process.cwd')
      expect(output).toContain('fixed-value')
      expect(output).not.toContain('TypeError')
      expect(output).not.toContain(`A Node.js API is used (process.env`)
    })
  })
})
