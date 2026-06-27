import * as core from '@actions/core'
import { readFileSync } from 'node:fs'
import { assertOk } from './utils'

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const BASE_URL = 'https://chromewebstore.googleapis.com'

type UploadState =
  | 'UPLOAD_STATE_UNSPECIFIED'
  | 'SUCCESS'
  | 'SUCCEEDED'
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
  const url = `${BASE_URL}/upload/v2/${name}:upload`
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
  const url = `${BASE_URL}/v2/${name}:fetchStatus`

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
    core.info(`  Upload status: ${status.lastAsyncUploadState}`)
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
  const url = `${BASE_URL}/v2/${name}:publish`

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

export async function publishToChrome(): Promise<void> {
  const clientId = core.getInput('chrome-client-id')
  const clientSecret = core.getInput('chrome-client-secret')
  const refreshToken = core.getInput('chrome-refresh-token')
  const publisherId = core.getInput('chrome-publisher-id')
  const extensionId = core.getInput('chrome-extension-id')
  const zipPath = core.getInput('chrome-zip-path')

  if (!clientId && !clientSecret && !refreshToken && !publisherId && !extensionId && !zipPath) {
    core.info('Chrome Web Store: No inputs provided, skipping')
    return
  }

  const shouldPublish = core.getInput('chrome-publish') !== 'false'
  const publishType = (core.getInput('chrome-publish-type') || 'DEFAULT_PUBLISH') as
    | 'DEFAULT_PUBLISH'
    | 'STAGED_PUBLISH'
  const deployPercentageRaw = core.getInput('chrome-deploy-percentage')
  const skipReview = core.getInput('chrome-skip-review') === 'true'

  // Auth
  core.info('Chrome Web Store: Obtaining access token')
  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken)

  // Upload
  core.info(`Chrome Web Store: Uploading ${zipPath}`)
  const upload = await uploadZip(accessToken, publisherId, extensionId, zipPath)
  core.info(`  Initial upload state: ${upload.uploadState}`)

  if (upload.crxVersion) {
    core.setOutput('chrome-crx-version', upload.crxVersion)
  }

  // Poll if async
  let uploadState = upload.uploadState
  if (uploadState === 'IN_PROGRESS') {
    core.info('Chrome Web Store: Waiting for upload to complete')
    uploadState = await pollUploadStatus(accessToken, publisherId, extensionId)
  }

  core.setOutput('chrome-upload-state', uploadState)
  core.setOutput('chrome-item-id', upload.itemId)

  if (uploadState === 'FAILURE') {
    throw new Error('Chrome Web Store: Upload failed')
  }
  if (uploadState !== 'SUCCESS' && uploadState !== 'SUCCEEDED') {
    throw new Error(`Chrome Web Store: Unexpected upload state "${uploadState}"`)
  }

  // Publish
  if (!shouldPublish) {
    core.info('Chrome Web Store: Skipping publish')
    return
  }

  const publishRequest: PublishRequest = { publishType, skipReview }

  if (publishType === 'STAGED_PUBLISH' && deployPercentageRaw) {
    publishRequest.deployInfos = [{ deployPercentage: parseInt(deployPercentageRaw, 10) }]
  }

  core.info('Chrome Web Store: Publishing')
  const result = await publishItem(accessToken, publisherId, extensionId, publishRequest)
  core.setOutput('chrome-publish-state', result.state)
  core.info(`Chrome Web Store: Done, state: ${result.state}`)
}
