import path from 'node:path'
import { readFile } from 'node:fs/promises'

export type AppConfig = {
  listenHost: string
  listenPort: number
  allowedRoots: string[]
  taskConcurrency: number
}

export async function loadConfig(serverRoot: string): Promise<AppConfig> {
  const configPath = path.resolve(serverRoot, 'data/config.json')
  const raw = await readFile(configPath, 'utf8')
  const parsed = JSON.parse(raw) as Partial<AppConfig>

  const parsedConcurrency =
    typeof parsed.taskConcurrency === 'number' && Number.isInteger(parsed.taskConcurrency) && parsed.taskConcurrency > 0
      ? parsed.taskConcurrency
      : 1

  return {
    listenHost:
      typeof parsed.listenHost === 'string' && parsed.listenHost.trim() ? parsed.listenHost.trim() : '127.0.0.1',
    listenPort: typeof parsed.listenPort === 'number' ? parsed.listenPort : 3000,
    allowedRoots: Array.isArray(parsed.allowedRoots)
      ? parsed.allowedRoots.map((item) => path.resolve(String(item)))
      : [path.resolve(serverRoot)],
    taskConcurrency: parsedConcurrency,
  }
}
