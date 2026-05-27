import * as core from '@actions/core'
import { readFileSync } from 'node:fs'

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API_BASE = 'https://chromewebstore.googleapis.com'

// ── Types ──────────────────────────────────────────────────────────────────────

type UploadState =
  | 'UPLOAD_STATE_UNSPECIFIED'
  | 'SUCCESS'
  | 'FAILURE'
  | 'IN_PROGRESS'
  | 'NOT_FOUND'

interface TokenResponse {
  access_token: string
  expires_in: number
  token_type: string
  scope: string
}

interface UploadResponse {
  name: string
  itemId: string
  crxVersion?: string
  uploadState: UploadState
}

interface FetchStatusResponse {
  name: string
  itemId: string
  publicKey: string
  lastAsyncUploadState: UploadState
  takenDown: boolean
  warned: boolean
}

interface PublishResponse {
  name: string
  itemId: string
  state: string
}

interface PublishRequest {
  publishType?: 'DEFAULT_PUBLISH' | 'STAGED_PUBLISH'
  deployInfos?: Array<{ deployPercentage?: number }>
  skipReview?: boolean
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function assertOk(response: Response, context: string): Promise<void> {
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${context}: HTTP ${response.status} — ${body}`)
  }
}

async function getAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  await assertOk(response, 'OAuth token exchange')
  const data = (await response.json()) as TokenResponse
  return data.access_token
}

async function uploadZip(
  accessToken: string,
  publisherId: string,
  extensionId: string,
  zipPath: string,
): Promise<UploadResponse> {
  const name = `publishers/${publisherId}/items/${extensionId}`
  const url = `${API_BASE}/upload/v2/${name}:upload`
  const zipData = readFileSync(zipPath)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/zip',
      'X-Goog-Upload-Protocol': 'raw',
      'Content-Length': String(zipData.byteLength),
    },
    body: zipData,
  })
  await assertOk(response, 'Upload')
  return (await response.json()) as UploadResponse
}

async function fetchStatus(
  accessToken: string,
  publisherId: string,
  extensionId: string,
): Promise<FetchStatusResponse> {
  const name = `publishers/${publisherId}/items/${extensionId}`
  const url = `${API_BASE}/v2/${name}:fetchStatus`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  await assertOk(response, 'fetchStatus')
  return (await response.json()) as FetchStatusResponse
}

async function pollUploadStatus(
  accessToken: string,
  publisherId: string,
  extensionId: string,
  intervalMs = 5_000,
  timeoutMs = 300_000,
): Promise<UploadState> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, intervalMs))
    const status = await fetchStatus(accessToken, publisherId, extensionId)
    core.info(`  upload status: ${status.lastAsyncUploadState}`)
    if (status.lastAsyncUploadState !== 'IN_PROGRESS') {
      return status.lastAsyncUploadState
    }
  }

  throw new Error(`Upload timed out after ${timeoutMs / 1000}s`)
}

async function publishItem(
  accessToken: string,
  publisherId: string,
  extensionId: string,
  body: PublishRequest,
): Promise<PublishResponse> {
  const name = `publishers/${publisherId}/items/${extensionId}`
  const url = `${API_BASE}/v2/${name}:publish`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  await assertOk(response, 'Publish')
  return (await response.json()) as PublishResponse
}

// ── Public entry point ─────────────────────────────────────────────────────────

export async function publishToChrome(): Promise<void> {
  const clientId = core.getInput('chrome-client-id')
  const clientSecret = core.getInput('chrome-client-secret')
  const refreshToken = core.getInput('chrome-refresh-token')
  const publisherId = core.getInput('chrome-publisher-id')
  const extensionId = core.getInput('chrome-extension-id')
  const zipPath = core.getInput('chrome-zip-path')

  if (!clientId && !clientSecret && !refreshToken && !publisherId && !extensionId && !zipPath) {
    core.info('Chrome Web Store: no inputs provided — skipping.')
    return
  }

  const shouldPublish = core.getInput('chrome-publish') !== 'false'
  const publishType = (core.getInput('chrome-publish-type') || 'DEFAULT_PUBLISH') as
    | 'DEFAULT_PUBLISH'
    | 'STAGED_PUBLISH'
  const deployPercentageRaw = core.getInput('chrome-deploy-percentage')
  const skipReview = core.getInput('chrome-skip-review') === 'true'

  // 1. Auth
  core.info('Chrome Web Store: obtaining access token...')
  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken)

  // 2. Upload
  core.info(`Chrome Web Store: uploading ${zipPath}...`)
  const upload = await uploadZip(accessToken, publisherId, extensionId, zipPath)
  core.info(`  initial upload state: ${upload.uploadState}`)

  if (upload.crxVersion) {
    core.setOutput('chrome-crx-version', upload.crxVersion)
  }

  // 3. Poll if async
  let uploadState = upload.uploadState
  if (uploadState === 'IN_PROGRESS') {
    core.info('Chrome Web Store: upload in progress, polling...')
    uploadState = await pollUploadStatus(accessToken, publisherId, extensionId)
  }

  core.setOutput('chrome-upload-state', uploadState)
  core.setOutput('chrome-item-id', upload.itemId)

  if (uploadState === 'FAILURE') {
    throw new Error('Chrome Web Store: upload failed.')
  }
  if (uploadState !== 'SUCCESS') {
    throw new Error(`Chrome Web Store: unexpected upload state "${uploadState}".`)
  }

  // 4. Publish (optional)
  if (!shouldPublish) {
    core.info('Chrome Web Store: skipping publish (chrome-publish=false).')
    return
  }

  const publishRequest: PublishRequest = { publishType, skipReview }

  if (publishType === 'STAGED_PUBLISH' && deployPercentageRaw) {
    publishRequest.deployInfos = [{ deployPercentage: parseInt(deployPercentageRaw, 10) }]
  }

  core.info('Chrome Web Store: publishing...')
  const result = await publishItem(accessToken, publisherId, extensionId, publishRequest)
  core.setOutput('chrome-publish-state', result.state)
  core.info(`Chrome Web Store: done. State: ${result.state}`)
}
