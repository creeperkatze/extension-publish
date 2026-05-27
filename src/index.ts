import * as core from '@actions/core'
import { publishToChrome } from './chrome'
import { publishToEdge } from './edge'
import { publishToFirefox } from './firefox'

async function run(): Promise<void> {
  try {
    await publishToChrome()
    await publishToFirefox()
    await publishToEdge()
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

run()
