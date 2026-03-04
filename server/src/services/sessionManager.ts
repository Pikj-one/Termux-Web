import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export type SessionStatus = 'running' | 'completed' | 'failed' | 'terminated'

export type SessionEvent =
  | { type: 'stdout'; data: string; createdAt: string }
  | { type: 'stderr'; data: string; createdAt: string }
  | { type: 'exit'; exitCode: number | null; createdAt: string }

export type SessionSummary = {
  id: string
  command: string
  cwd: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  status: SessionStatus
  exitCode: number | null
  events: SessionEvent[]
}

type SessionRecord = SessionSummary & {
  process: ChildProcessWithoutNullStreams
  subscribers: Set<(event: SessionEvent) => void>
  killRequested: boolean
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>()

  create(command: string, cwd: string): SessionSummary {
    const childProcess = spawn('sh', ['-lc', command], {
      cwd,
      env: process.env,
      stdio: 'pipe',
      detached: true,
    })

    const sessionId = randomUUID()
    const session: SessionRecord = {
      id: sessionId,
      command,
      cwd,
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: null,
      status: 'running',
      exitCode: null,
      events: [],
      process: childProcess,
      subscribers: new Set(),
      killRequested: false,
    }

    this.sessions.set(sessionId, session)

    childProcess.stdout.on('data', (chunk) => {
      this.publish(sessionId, {
        type: 'stdout',
        data: chunk.toString(),
        createdAt: new Date().toISOString(),
      })
    })

    childProcess.stderr.on('data', (chunk) => {
      this.publish(sessionId, {
        type: 'stderr',
        data: chunk.toString(),
        createdAt: new Date().toISOString(),
      })
    })

    childProcess.on('close', (exitCode) => {
      session.exitCode = exitCode
      session.status = session.killRequested ? 'terminated' : exitCode === 0 ? 'completed' : 'failed'
      session.endedAt = new Date().toISOString()
      session.durationMs = Date.parse(session.endedAt) - Date.parse(session.startedAt)
      this.publish(sessionId, {
        type: 'exit',
        exitCode,
        createdAt: session.endedAt,
      })
    })

    return this.toSummary(session)
  }

  get(sessionId: string): SessionSummary | null {
    const session = this.sessions.get(sessionId)
    return session ? this.toSummary(session) : null
  }

  kill(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)

    if (!session || session.status !== 'running') {
      return false
    }

    session.killRequested = true

    try {
      process.kill(-session.process.pid!, 'SIGTERM')
    } catch {
      session.process.kill('SIGTERM')
    }

    setTimeout(() => {
      const current = this.sessions.get(sessionId)

      if (!current || current.status !== 'running') {
        return
      }

      try {
        process.kill(-current.process.pid!, 'SIGKILL')
      } catch {
        current.process.kill('SIGKILL')
      }
    }, 500)

    return true
  }

  subscribe(sessionId: string, listener: (event: SessionEvent) => void): (() => void) | null {
    const session = this.sessions.get(sessionId)

    if (!session) {
      return null
    }

    for (const event of session.events) {
      listener(event)
    }

    session.subscribers.add(listener)
    return () => {
      session.subscribers.delete(listener)
    }
  }

  private publish(sessionId: string, event: SessionEvent): void {
    const session = this.sessions.get(sessionId)

    if (!session) {
      return
    }

    session.events.push(event)

    for (const listener of session.subscribers) {
      listener(event)
    }
  }

  private toSummary(session: SessionRecord): SessionSummary {
    return {
      id: session.id,
      command: session.command,
      cwd: session.cwd,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: session.durationMs,
      status: session.status,
      exitCode: session.exitCode,
      events: [...session.events],
    }
  }
}
