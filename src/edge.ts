import * as core from '@actions/core'
import { readFileSync } from 'node:fs'

const EDGE_BASE = 'https://api.addons.microsoftedge.microsoft.com'

interface OperationStatus {
  id: string
  createdTime: string
  lastUpdatedTime: string
  status: 'Succeeded' | 'Failed' | 'InProgress'
  message: string
  errorCode: string
}

function authHeaders(apiKey: string, clientId: string): Record<string, string> {
  return {
    Authorization: `ApiKey ${apiKey}`,
    'X-ClientID': clientId,
  }
}

function extractOperationId(location: string): string {
  return location.trim().split('/').at(-1) ?? location.trim()
}

async function assertAccepted(response: Response, context: string): Promise<string> {
  if (response.status !== 202) {
    const body = await response.text()
    throw new Error(`${context}: expected 202, got HTTP ${response.status} — ${body}`)
  }
  const location = response.headers.get('Location')
  if (!location) throw new Error(`${context}: 202 response missing Location header`)
  return extractOperationId(location)
}

async function assertOk(response: Response, context: string): Promise<void> {
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${context}: HTTP ${response.status} — ${body}`)
  }
}

async function uploadPackage(
  apiKey: string,
  clientId: string,
  productId: string,
  zipPath: string,
): Promise<string> {
  const zipData = readFileSync(zipPath)

  const response = await fetch(
    `${EDGE_BASE}/v1/products/${productId}/submissions/draft/package`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(apiKey, clientId),
        'Content-Type': 'application/zip',
      },
      body: zipData,
    },
  )
  return assertAccepted(response, 'Edge upload')
}

async function pollOperation(
  apiKey: string,
  clientId: string,
  statusUrl: string,
  context: string,
  intervalMs = 5_000,
  timeoutMs = 300_000,
): Promise<OperationStatus> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, intervalMs))

    const response = await fetch(`${EDGE_BASE}${statusUrl}`, {
      headers: authHeaders(apiKey, clientId),
    })
    await assertOk(response, `${context} status`)
    const status = (await response.json()) as OperationStatus
    core.info(`  status: ${status.status}${status.message ? ` — ${status.message}` : ''}`)

    if (status.status !== 'InProgress') return status
  }

  throw new Error(`${context} timed out after ${timeoutMs / 1000}s`)
}

async function publishDraft(
  apiKey: string,
  clientId: string,
  productId: string,
  notes: string | undefined,
): Promise<string> {
  const response = await fetch(
    `${EDGE_BASE}/v1/products/${productId}/submissions`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(apiKey, clientId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notes: notes ?? '' }),
    },
  )
  return assertAccepted(response, 'Edge publish')
}

export async function publishToEdge(): Promise<void> {
  const apiKey = core.getInput('edge-api-key')
  const clientId = core.getInput('edge-client-id')
  const productId = core.getInput('edge-product-id')
  const zipPath = core.getInput('edge-zip-path')

  if (!apiKey && !clientId && !productId && !zipPath) {
    core.info('Edge Add-ons: no inputs provided — skipping.')
    return
  }

  const shouldPublish = core.getInput('edge-publish') !== 'false'
  const notes = core.getInput('edge-notes') || undefined

  // 1. Upload
  core.info(`Edge Add-ons: uploading ${zipPath}...`)
  const uploadOperationId = await uploadPackage(apiKey, clientId, productId, zipPath)
  core.info(`  upload operation ID: ${uploadOperationId}`)
  core.setOutput('edge-upload-operation-id', uploadOperationId)

  // 2. Poll upload status
  core.info('Edge Add-ons: waiting for upload to complete...')
  const uploadStatus = await pollOperation(
    apiKey,
    clientId,
    `/v1/products/${productId}/submissions/draft/package/operations/${uploadOperationId}`,
    'Edge upload',
  )
  core.setOutput('edge-upload-status', uploadStatus.status)

  if (uploadStatus.status === 'Failed') {
    throw new Error(`Edge Add-ons: upload failed — ${uploadStatus.message} (${uploadStatus.errorCode})`)
  }

  // 3. Publish (optional)
  if (!shouldPublish) {
    core.info('Edge Add-ons: skipping publish (edge-publish=false).')
    return
  }

  core.info('Edge Add-ons: publishing draft...')
  const publishOperationId = await publishDraft(apiKey, clientId, productId, notes)
  core.info(`  publish operation ID: ${publishOperationId}`)
  core.setOutput('edge-publish-operation-id', publishOperationId)

  // 4. Poll publish status
  core.info('Edge Add-ons: waiting for publish to complete...')
  const publishStatus = await pollOperation(
    apiKey,
    clientId,
    `/v1/products/${productId}/submissions/operations/${publishOperationId}`,
    'Edge publish',
  )
  core.setOutput('edge-publish-status', publishStatus.status)

  if (publishStatus.status === 'Failed') {
    throw new Error(`Edge Add-ons: publish failed — ${publishStatus.message} (${publishStatus.errorCode})`)
  }

  core.info(`Edge Add-ons: done. Status: ${publishStatus.status}`)
}
