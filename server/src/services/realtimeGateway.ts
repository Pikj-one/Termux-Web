import type { Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { SessionManager } from '../services/sessionManager.js'

export function attachRealtimeGateway(server: Server, sessionManager: SessionManager): void {
  const webSocketServer = new WebSocketServer({ server })

  webSocketServer.on('connection', (socket, request) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const match = requestUrl.pathname.match(/^\/ws\/sessions\/([^/]+)$/)

    if (!match) {
      socket.close(1008, 'Invalid session path')
      return
    }

    const sessionId = match[1]
    const unsubscribe = sessionManager.subscribe(sessionId, (event) => {
      socket.send(JSON.stringify(event))
    })

    if (!unsubscribe) {
      socket.close(1008, 'Session not found')
      return
    }

    socket.on('close', () => {
      unsubscribe()
    })
  })
}
