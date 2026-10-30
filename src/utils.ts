import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

export interface PublishResult {
  status: 'success' | 'skipped'
  version?: string
  details?: string
}

export function b64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function makeJwt(apiKey: string, apiSecret: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iss: apiKey, jti: randomUUID(), iat: now, exp: now + 300 }))
  const signature = b64url(createHmac('sha256', apiSecret).update(`${header}.${payload}`).digest())
  return `${header}.${payload}.${signature}`
}

export async function assertOk(response: Response, context: string): Promise<void> {
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${context}: HTTP ${response.status}: ${body}`)
  }
}

export function fillVersion(path: string, versionFile = 'package.json'): string {
  if (!path.includes('{version}')) {
    return path
  }

  let versionData: unknown
  try {
    versionData = JSON.parse(readFileSync(versionFile, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to read version from "${versionFile}": ${detail}`)
  }

  if (
    typeof versionData !== 'object' ||
    versionData === null ||
    !('version' in versionData) ||
    typeof versionData.version !== 'string' ||
    versionData.version.length === 0
  ) {
    throw new Error(`Version file "${versionFile}" must contain a non-empty string "version" field`)
  }

  return path.replaceAll('{version}', versionData.version)
}
