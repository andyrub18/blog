// @vitest-environment node
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitApplicationPdf,
  discardApplicationUploads,
  stageApplicationPdf,
} from './uploads'

/**
 * Dossiers go where `UPLOAD_ROOT` says. They used to be hard-coded to
 * `./uploads` while companion PDFs honoured the setting, so a server with its
 * persistent volume mounted at `UPLOAD_ROOT` would have lost every CV and essay
 * on its next redeploy.
 */
describe('where a dossier is written', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'klea-dossiers-'))
    vi.stubEnv('UPLOAD_ROOT', root)
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  it('writes and discards under UPLOAD_ROOT', async () => {
    const pdf = new File([new TextEncoder().encode('%PDF-1.7\n%%EOF')], 'cv.pdf')
    const staged = await stageApplicationPdf('cv', pdf)
    const stored = await commitApplicationPdf('user-1', staged)

    expect(existsSync(join(root, stored))).toBe(true)
    await discardApplicationUploads('user-1')
    expect(existsSync(join(root, 'member-applications', 'user-1'))).toBe(false)
  })
})
