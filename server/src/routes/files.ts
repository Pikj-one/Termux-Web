import type { Express, Request, Response } from 'express'
import { access, readdir, stat, writeFile } from 'node:fs/promises'
import multer from 'multer'
import path from 'node:path'
import { resolveAllowedPath } from '../utils/paths.js'

const upload = multer({ storage: multer.memoryStorage() })

export function registerFileRoutes(app: Express, allowedRoots: string[]): void {
  const fallbackRoot = allowedRoots[0]

  app.get('/api/files', async (request: Request, response: Response) => {
    try {
      const targetPath = resolveAllowedPath(
        typeof request.query.path === 'string' ? request.query.path : undefined,
        allowedRoots,
        fallbackRoot,
      )

      const entries = await readdir(targetPath)
      const items = await Promise.all(
        entries.map(async (name) => {
          const fullPath = path.join(targetPath, name)
          const info = await stat(fullPath)

          return {
            name,
            path: fullPath,
            isDirectory: info.isDirectory(),
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
          }
        }),
      )

      response.json({
        path: targetPath,
        items: items.sort(
          (left, right) => Number(right.isDirectory) - Number(left.isDirectory) || left.name.localeCompare(right.name),
        ),
      })
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Failed to list files',
      })
    }
  })

  app.post('/api/files/upload', upload.single('file'), async (request: Request, response: Response) => {
    try {
      const targetPath = resolveAllowedPath(
        typeof request.body?.path === 'string' ? request.body.path : undefined,
        allowedRoots,
        fallbackRoot,
      )
      const targetInfo = await stat(targetPath)

      if (!targetInfo.isDirectory()) {
        response.status(400).json({ message: 'Upload target must be a directory' })
        return
      }

      if (!request.file) {
        response.status(400).json({ message: 'File is required' })
        return
      }

      const fileName = path.basename(request.file.originalname)
      const filePath = path.join(targetPath, fileName)

      try {
        await access(filePath)
        response.status(409).json({ message: 'File already exists' })
        return
      } catch {
        // File does not exist yet.
      }

      await writeFile(filePath, request.file.buffer)
      const fileInfo = await stat(filePath)

      response.status(201).json({
        name: fileName,
        path: filePath,
        isDirectory: false,
        size: fileInfo.size,
        modifiedAt: fileInfo.mtime.toISOString(),
      })
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Failed to upload file',
      })
    }
  })

  app.get('/api/files/download', async (request: Request, response: Response) => {
    try {
      const targetPath = resolveAllowedPath(
        typeof request.query.path === 'string' ? request.query.path : undefined,
        allowedRoots,
        fallbackRoot,
      )
      const targetInfo = await stat(targetPath)

      if (targetInfo.isDirectory()) {
        response.status(400).json({ message: 'Only files can be downloaded' })
        return
      }

      response.download(targetPath, path.basename(targetPath))
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Failed to download file',
      })
    }
  })
}
