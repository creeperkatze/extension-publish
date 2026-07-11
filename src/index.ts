import * as core from '@actions/core'
import { publishToChrome } from './chrome'
import { publishToEdge } from './edge'
import { publishToFirefox } from './firefox'

const STATUS_LABEL = {
  success: '✅ Success',
  skipped: '⏭️ Skipped',
  failed: '❌ Failed',
} as const

async function run(): Promise<void> {
  const errors: string[] = []
  const rows: string[][] = []

  for (const [name, fn] of [
    ['Chrome Web Store', publishToChrome],
    ['Firefox Add-ons', publishToFirefox],
    ['Edge Add-ons', publishToEdge],
  ] as const) {
    try {
      const result = await fn()
      rows.push([name, STATUS_LABEL[result.status], result.version ?? '-', result.details ?? '-'])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      core.error(`${name}: ${message}`)
      errors.push(name)
      rows.push([name, STATUS_LABEL.failed, '-', message])
    }
  }

  await core.summary
    .addHeading('Extension Publish', 2)
    .addTable([
      [
        { data: 'Store', header: true },
        { data: 'Status', header: true },
        { data: 'Version', header: true },
        { data: 'Details', header: true },
      ],
      ...rows,
    ])
    .write()

  if (errors.length > 0) {
    core.setFailed(`Failed: ${errors.join(', ')}`)
  }
}

run()
