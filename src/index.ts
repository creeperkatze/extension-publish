import * as core from '@actions/core'
import { publishToChrome } from './chrome'

async function run(): Promise<void> {
  try {
    await publishToChrome()
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

run()
