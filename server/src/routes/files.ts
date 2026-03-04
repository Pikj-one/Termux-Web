import type { Express, Request, Response } from 'express'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveAllowedPath } from '../utils/paths.js'

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
        items: items.sort((left, right) => Number(right.isDirectory) - Number(left.isDirectory) || left.name.localeCompare(right.name)),
      })
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Failed to list files',
      })
    }
  })
}
