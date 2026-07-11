import * as core from '@actions/core'
import { readFileSync } from 'node:fs'
import { assertOk, PublishResult } from './utils'

const BASE_URL = 'https://api.addons.microsoftedge.microsoft.com'

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
    throw new Error(`${context}: expected 202, got HTTP ${response.status}: ${body}`)
  }
  const location = response.headers.get('Location')
  if (!location) throw new Error(`${context}: 202 response missing Location header`)
  return extractOperationId(location)
}


async function uploadPackage(
  apiKey: string,
  clientId: string,
  productId: string,
  zipPath: string,
): Promise<string> {
  const zipData = readFileSync(zipPath)

  const response = await fetch(
    `${BASE_URL}/v1/products/${productId}/submissions/draft/package`,
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

    const response = await fetch(`${BASE_URL}${statusUrl}`, {
      headers: authHeaders(apiKey, clientId),
    })
    await assertOk(response, `${context} status`)
    const status = (await response.json()) as OperationStatus
    core.info(`  Status: ${status.status}${status.message ? `: ${status.message}` : ''}`)

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
    `${BASE_URL}/v1/products/${productId}/submissions`,
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

export async function publishToEdge(): Promise<PublishResult> {
  const apiKey = core.getInput('edge-api-key')
  const clientId = core.getInput('edge-client-id')
  const productId = core.getInput('edge-product-id')
  const zipPath = core.getInput('edge-zip-path')

  if (!apiKey && !clientId && !productId && !zipPath) {
    core.info('Edge Add-ons: No inputs provided, skipping')
    return { status: 'skipped', details: 'No inputs provided' }
  }

  const shouldPublish = core.getInput('edge-publish') !== 'false'
  const notes = core.getInput('edge-notes') || undefined

  // Upload
  core.info(`Edge Add-ons: Uploading ${zipPath}`)
  const uploadOperationId = await uploadPackage(apiKey, clientId, productId, zipPath)
  core.info(`  Upload operation ID: ${uploadOperationId}`)
  core.setOutput('edge-upload-operation-id', uploadOperationId)

  // Poll upload status
  core.info('Edge Add-ons: Waiting for upload to complete')
  const uploadStatus = await pollOperation(
    apiKey,
    clientId,
    `/v1/products/${productId}/submissions/draft/package/operations/${uploadOperationId}`,
    'Edge upload',
  )
  core.setOutput('edge-upload-status', uploadStatus.status)

  if (uploadStatus.status === 'Failed') {
    throw new Error(`Edge Add-ons: Upload failed: ${uploadStatus.message} (${uploadStatus.errorCode})`)
  }

  // Publish
  if (!shouldPublish) {
    core.info('Edge Add-ons: Skipping publish')
    return { status: 'success', details: `Uploaded, not published (upload status: ${uploadStatus.status})` }
  }

  core.info('Edge Add-ons: Publishing draft')
  const publishOperationId = await publishDraft(apiKey, clientId, productId, notes)
  core.info(`  Publish operation ID: ${publishOperationId}`)
  core.setOutput('edge-publish-operation-id', publishOperationId)

  // Poll publish status
  core.info('Edge Add-ons: Waiting for publish to complete')
  const publishStatus = await pollOperation(
    apiKey,
    clientId,
    `/v1/products/${productId}/submissions/operations/${publishOperationId}`,
    'Edge publish',
  )
  core.setOutput('edge-publish-status', publishStatus.status)

  if (publishStatus.status === 'Failed') {
    throw new Error(`Edge Add-ons: Publish failed: ${publishStatus.message} (${publishStatus.errorCode})`)
  }

  core.info(`Edge Add-ons: Done, status: ${publishStatus.status}`)

  return { status: 'success', details: `Upload status: ${uploadStatus.status}, publish status: ${publishStatus.status}` }
}
