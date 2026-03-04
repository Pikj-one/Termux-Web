import type { Express, Request, Response } from 'express'
import { LogStore, type TaskLogStatus } from '../services/logStore.js'

export function registerLogRoutes(app: Express, logStore: LogStore): void {
  app.get('/api/logs', async (request: Request, response: Response) => {
    const status = parseStatus(request.query.status)

    if (request.query.status !== undefined && !status) {
      response.status(400).json({ message: 'Invalid status filter' })
      return
    }

    const keyword = typeof request.query.keyword === 'string' ? request.query.keyword : undefined
    const from = typeof request.query.from === 'string' ? request.query.from : undefined
    const to = typeof request.query.to === 'string' ? request.query.to : undefined

    const items = await logStore.list({ keyword, status: status ?? undefined, from, to })
    response.json({ items })
  })

  app.get('/api/logs/:id', async (request: Request, response: Response) => {
    const log = await logStore.get(request.params.id)

    if (!log) {
      response.status(404).json({ message: 'Log not found' })
      return
    }

    response.json(log)
  })

  app.get('/api/logs/:id/export', async (request: Request, response: Response) => {
    const format = parseFormat(request.query.format)

    if (!format) {
      response.status(400).json({ message: 'Invalid export format' })
      return
    }

    try {
      const exported = await logStore.export(request.params.id, format)
      response.setHeader('Content-Type', exported.contentType)
      response.setHeader('Content-Disposition', `attachment; filename="${exported.fileName}"`)
      response.send(exported.body)
    } catch {
      response.status(404).json({ message: 'Log not found' })
    }
  })
}

function parseStatus(value: unknown): TaskLogStatus | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }

  if (value === 'running' || value === 'completed' || value === 'failed' || value === 'terminated') {
    return value
  }

  return null
}

function parseFormat(value: unknown): 'txt' | 'json' | null {
  if (value === 'txt' || value === 'json') {
    return value
  }

  return null
}
