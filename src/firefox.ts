import * as core from '@actions/core'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { assertOk, makeJwt } from './utils'

const BASE_URL = 'https://addons.mozilla.org/api/v5'

interface UploadResponse {
  uuid: string
  channel: 'listed' | 'unlisted'
  processed: boolean
  submitted: boolean
  url: string
  valid: boolean
  validation: Record<string, unknown>
  version: string | null
}

interface VersionResponse {
  id: number
  channel: string
  file: { status: string }
  license: { slug: string } | null
  release_notes: Record<string, string> | null
  version: string
}


async function uploadXpi(
  apiKey: string,
  apiSecret: string,
  xpiPath: string,
  channel: 'listed' | 'unlisted',
): Promise<UploadResponse> {
  const form = new FormData()
  const data = readFileSync(xpiPath)
  form.append('upload', new Blob([data], { type: 'application/x-xpinstall' }), basename(xpiPath))
  form.append('channel', channel)

  const response = await fetch(`${BASE_URL}/addons/upload/`, {
    method: 'POST',
    headers: { Authorization: `JWT ${makeJwt(apiKey, apiSecret)}` },
    body: form,
  })
  await assertOk(response, 'Firefox upload')
  return (await response.json()) as UploadResponse
}

async function pollUpload(
  apiKey: string,
  apiSecret: string,
  uuid: string,
  intervalMs = 5_000,
  timeoutMs = 300_000,
): Promise<UploadResponse> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, intervalMs))

    const response = await fetch(`${BASE_URL}/addons/upload/${uuid}/`, {
      headers: { Authorization: `JWT ${makeJwt(apiKey, apiSecret)}` },
    })
    await assertOk(response, 'Firefox upload poll')
    const upload = (await response.json()) as UploadResponse
    core.info(`  Processed: ${upload.processed}, Valid: ${upload.valid}`)

    if (upload.processed) return upload
  }

  throw new Error(`Firefox upload timed out after ${timeoutMs / 1000}s`)
}

async function createVersion(
  apiKey: string,
  apiSecret: string,
  extensionId: string,
  uploadUuid: string,
  license: string | undefined,
  approvalNotes: string | undefined,
  releaseNotes: string | undefined,
  compatibility: Record<string, unknown> | undefined,
): Promise<VersionResponse> {
  const body: Record<string, unknown> = { upload: uploadUuid }

  if (license) body['license'] = license
  if (approvalNotes) body['approval_notes'] = approvalNotes

  if (releaseNotes) {
    try {
      body['release_notes'] = JSON.parse(releaseNotes)
    } catch {
      body['release_notes'] = { 'en-US': releaseNotes }
    }
  }

  if (compatibility) body['compatibility'] = compatibility

  const response = await fetch(`${BASE_URL}/addons/addon/${extensionId}/versions/`, {
    method: 'POST',
    headers: {
      Authorization: `JWT ${makeJwt(apiKey, apiSecret)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  await assertOk(response, 'Firefox create version')
  return (await response.json()) as VersionResponse
}

export async function publishToFirefox(): Promise<void> {
  const apiKey = core.getInput('firefox-api-key')
  const apiSecret = core.getInput('firefox-api-secret')
  const extensionId = core.getInput('firefox-extension-id')
  const xpiPath = core.getInput('firefox-xpi-path')

  if (!apiKey && !apiSecret && !extensionId && !xpiPath) {
    core.info('Firefox Add-ons: No inputs provided, skipping')
    return
  }

  const channel = (core.getInput('firefox-channel') || 'listed') as 'listed' | 'unlisted'
  const license = core.getInput('firefox-license') || undefined
  const approvalNotes = core.getInput('firefox-approval-notes') || undefined
  const releaseNotes = core.getInput('firefox-release-notes') || undefined

  const compatibility: Record<string, unknown> = {}
  for (const [platform, inputName] of [
    ['firefox', 'firefox-compatibility-firefox'],
    ['android', 'firefox-compatibility-android'],
  ] as const) {
    const raw = core.getInput(inputName).trim()
    if (!raw) continue
    if (raw === 'true') {
      compatibility[platform] = {}
    } else {
      const [min, max] = raw.split(',').map(s => s.trim())
      compatibility[platform] = { ...(min && { min }), ...(max && { max }) }
    }
  }
  if (compatibility['android'] && !compatibility['firefox']) {
    compatibility['firefox'] = {}
  }
  const resolvedCompatibility = Object.keys(compatibility).length > 0 ? compatibility : undefined

  // Upload
  core.info(`Firefox Add-ons: Uploading ${xpiPath} (channel: ${channel})`)
  let upload = await uploadXpi(apiKey, apiSecret, xpiPath, channel)
  core.info(`  UUID: ${upload.uuid}`)

  // Poll until processed
  if (!upload.processed) {
    core.info('Firefox Add-ons: Waiting for validation')
    upload = await pollUpload(apiKey, apiSecret, upload.uuid)
  }

  core.setOutput('firefox-upload-uuid', upload.uuid)

  if (!upload.valid) {
    throw new Error(`Firefox Add-ons: Upload failed validation\n${JSON.stringify(upload.validation, null, 2)}`)
  }

  core.info('Firefox Add-ons: Upload valid, creating version')

  // Create version
  const version = await createVersion(apiKey, apiSecret, extensionId, upload.uuid, license, approvalNotes, releaseNotes, resolvedCompatibility)

  core.setOutput('firefox-version-id', String(version.id))
  core.setOutput('firefox-version-state', version.file.status)
  core.info(`Firefox Add-ons: Done, version: ${version.version}, state: ${version.file.status}`)
}
