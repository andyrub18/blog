import { join } from 'node:path'

/**
 * Where every uploaded file lives: application dossiers and companion PDFs.
 * **Server only** (it reads the environment and the working directory).
 *
 * `UPLOAD_ROOT` if set, `./uploads` otherwise. One setting for all of them, read
 * at call time: the dossiers used to hard-code `./uploads` while companions
 * honoured `UPLOAD_ROOT`, so a server whose persistent volume was mounted there
 * would have kept the PDFs and lost every CV and essay on its next redeploy.
 */
export function uploadRoot(): string {
  return process.env.UPLOAD_ROOT || join(process.cwd(), 'uploads')
}
