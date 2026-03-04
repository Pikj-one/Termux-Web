import type { Express, Request, Response } from 'express'
import { HistoryStore } from '../services/historyStore.js'

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
}
