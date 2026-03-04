import type { Express, Request, Response } from 'express'
import { HistoryStore, type HistoryGroup } from '../services/historyStore.js'
import { SessionManager } from '../services/sessionManager.js'
import { resolveAllowedPath } from '../utils/paths.js'

export function registerSessionRoutes(
  app: Express,
  sessionManager: SessionManager,
  historyStore: HistoryStore,
  allowedRoots: string[],
): void {
  const fallbackRoot = allowedRoots[0]

  app.post('/api/exec', async (request: Request, response: Response) => {
    const command = typeof request.body?.command === 'string' ? request.body.command.trim() : ''

    if (!command) {
      response.status(400).json({ message: 'Command is required' })
      return
    }

    try {
      const cwd = resolveAllowedPath(
        typeof request.body?.cwd === 'string' ? request.body.cwd : undefined,
        allowedRoots,
        fallbackRoot,
      )

      const group = parseGroup(request.body?.group)
      const session = sessionManager.create(command, cwd)
      await historyStore.add(command, cwd, group ?? 'default')
      response.status(201).json({ sessionId: session.id })
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Failed to start session',
      })
    }
  })

  app.get('/api/sessions/:id', (request: Request, response: Response) => {
    const session = sessionManager.get(request.params.id)

    if (!session) {
      response.status(404).json({ message: 'Session not found' })
      return
    }

    response.json(session)
  })

  app.post('/api/sessions/:id/kill', (request: Request, response: Response) => {
    const killed = sessionManager.kill(request.params.id)

    if (!killed) {
      response.status(404).json({ message: 'Running session not found' })
      return
    }

    response.status(202).json({ ok: true })
  })
}

function parseGroup(value: unknown): HistoryGroup | null {
  if (value === 'default' || value === 'system' || value === 'custom') {
    return value
  }

  return null
}
