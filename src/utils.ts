import { createHmac, randomUUID } from 'node:crypto'

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
