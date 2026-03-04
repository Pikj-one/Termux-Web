import express from 'express'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerFileRoutes } from './routes/files.js'
import { registerHistoryRoutes } from './routes/history.js'
import { registerSessionRoutes } from './routes/sessions.js'
import { HistoryStore } from './services/historyStore.js'
import { attachRealtimeGateway } from './services/realtimeGateway.js'
import { SessionManager } from './services/sessionManager.js'
import { loadConfig } from './utils/config.js'

const currentFilePath = fileURLToPath(import.meta.url)
const sourceRoot = path.dirname(currentFilePath)
const serverRoot = path.resolve(sourceRoot, '..')
const clientDistPath = path.resolve(serverRoot, '../client/dist')

async function bootstrap(): Promise<void> {
  const config = await loadConfig(serverRoot)
  const historyStore = new HistoryStore(path.resolve(serverRoot, 'data/history.json'))
  const sessionManager = new SessionManager()

  const app = express()
  app.use(express.json())

  app.get('/api/health', (_request, response) => {
    response.json({
      ok: true,
      host: config.listenHost,
      port: config.listenPort,
      localhostOnly: config.listenHost === '127.0.0.1',
      commandMode: 'direct-shell',
    })
  })

  app.get('/api/runtime', (_request, response) => {
    response.json({
      host: config.listenHost,
      port: config.listenPort,
      localhostOnly: config.listenHost === '127.0.0.1',
      commandMode: 'direct-shell',
    })
  })

  registerSessionRoutes(app, sessionManager, historyStore, config.allowedRoots)
  registerHistoryRoutes(app, historyStore)
  registerFileRoutes(app, config.allowedRoots)

  app.use(express.static(clientDistPath))
  app.get('*', (_request, response) => {
    response.sendFile(path.resolve(clientDistPath, 'index.html'))
  })

  const server = http.createServer(app)
  attachRealtimeGateway(server, sessionManager)

  server.listen(config.listenPort, config.listenHost, () => {
    console.log(`Termux Web server listening on http://${config.listenHost}:${config.listenPort}`)
  })
}

bootstrap().catch((error) => {
  console.error('Failed to start server', error)
  process.exit(1)
})
