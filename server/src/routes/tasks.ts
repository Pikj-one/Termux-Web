import type { Express, Request, Response } from 'express'
import { type HistoryGroup } from '../services/historyStore.js'
import { TaskQueue, type TaskStatus } from '../services/taskQueue.js'
import { resolveAllowedPath } from '../utils/paths.js'

export function registerTaskRoutes(app: Express, taskQueue: TaskQueue, allowedRoots: string[]): void {
  const fallbackRoot = allowedRoots[0]

  app.post('/api/tasks', async (request: Request, response: Response) => {
    const command = typeof request.body?.command === 'string' ? request.body.command.trim() : ''

    if (!command) {
      response.status(400).json({ message: 'Command is required' })
      return
    }

    const group = parseGroup(request.body?.group)

    if (!group) {
      response.status(400).json({ message: 'Invalid group' })
      return
    }

    try {
      const cwd = resolveAllowedPath(
        typeof request.body?.cwd === 'string' ? request.body.cwd : undefined,
        allowedRoots,
        fallbackRoot,
      )

      const task = await taskQueue.create(command, cwd, group)
      response.status(201).json(task)
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : 'Failed to create task',
      })
    }
  })

  app.get('/api/tasks', (request: Request, response: Response) => {
    const status = parseStatus(request.query.status)

    if (request.query.status !== undefined && !status) {
      response.status(400).json({ message: 'Invalid status filter' })
      return
    }

    const items = taskQueue.list(status ?? undefined)
    response.json({ items })
  })

  app.get('/api/tasks/:id', (request: Request, response: Response) => {
    const task = taskQueue.get(request.params.id)

    if (!task) {
      response.status(404).json({ message: 'Task not found' })
      return
    }

    response.json(task)
  })

  app.post('/api/tasks/:id/kill', async (request: Request, response: Response) => {
    const killed = await taskQueue.kill(request.params.id)

    if (!killed) {
      response.status(404).json({ message: 'Task not found or not killable' })
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

function parseStatus(value: unknown): TaskStatus | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'failed' || value === 'terminated') {
    return value
  }

  return null
}
