import type { Express, Request, Response } from 'express'
import { HistoryStore, type HistoryGroup } from '../services/historyStore.js'

export function registerHistoryRoutes(app: Express, historyStore: HistoryStore): void {
  app.get('/api/history', async (_request: Request, response: Response) => {
    const history = await historyStore.list()
    response.json({ items: history })
  })

  app.post('/api/history/pin', async (request: Request, response: Response) => {
    const id = typeof request.body?.id === 'string' ? request.body.id : ''
    const pinned = Boolean(request.body?.pinned)
    const updated = await historyStore.setPinned(id, pinned)

    if (!updated) {
      response.status(404).json({ message: 'History entry not found' })
      return
    }

    response.json(updated)
  })

  app.post('/api/history/group', async (request: Request, response: Response) => {
    const id = typeof request.body?.id === 'string' ? request.body.id : ''
    const group = parseGroup(request.body?.group)

    if (!group) {
      response.status(400).json({ message: 'Invalid group' })
      return
    }

    const updated = await historyStore.setGroup(id, group)

    if (!updated) {
      response.status(404).json({ message: 'History entry not found' })
      return
    }

    response.json(updated)
  })
}

function parseGroup(value: unknown): HistoryGroup | null {
  if (value === 'default' || value === 'system' || value === 'custom') {
    return value
  }

  return null
}
