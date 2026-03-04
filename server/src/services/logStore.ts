import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { HistoryGroup } from './historyStore.js'
import type { SessionEvent } from './sessionManager.js'

export type TaskLogStatus = 'running' | 'completed' | 'failed' | 'terminated'

export type TaskLogEvent =
  | { type: 'stdout'; data: string; createdAt: string }
  | { type: 'stderr'; data: string; createdAt: string }
  | { type: 'exit'; exitCode: number | null; createdAt: string }

export type TaskLogSummary = {
  id: string
  taskId: string
  sessionId: string
  command: string
  cwd: string
  group: HistoryGroup
  status: TaskLogStatus
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  exitCode: number | null
  createdAt: string
  updatedAt: string
}

export type TaskLogRecord = TaskLogSummary & {
  events: TaskLogEvent[]
}

export type LogFilters = {
  keyword?: string
  status?: TaskLogStatus
  from?: string
  to?: string
}

export type LogExportFormat = 'txt' | 'json'

export class LogStore {
  private readonly indexPath: string
  private readonly detailDir: string
  private storageReady: Promise<void> | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly rootDir: string) {
    this.indexPath = path.join(rootDir, 'index.json')
    this.detailDir = path.join(rootDir, 'entries')
  }

  async beginTask(input: {
    id: string
    taskId: string
    sessionId: string
    command: string
    cwd: string
    group: HistoryGroup
    startedAt: string
  }): Promise<TaskLogRecord> {
    return this.queueWrite(async () => {
      await this.ensureStorage()
      const now = new Date().toISOString()
      const record: TaskLogRecord = {
        id: input.id,
        taskId: input.taskId,
        sessionId: input.sessionId,
        command: input.command,
        cwd: input.cwd,
        group: input.group,
        status: 'running',
        startedAt: input.startedAt,
        endedAt: null,
        durationMs: null,
        exitCode: null,
        createdAt: now,
        updatedAt: now,
        events: [],
      }

      const index = await this.readIndex()
      const nextIndex = index.filter((item) => item.id !== record.id)
      nextIndex.unshift(this.toSummary(record))
      await Promise.all([this.writeDetail(record), this.writeIndex(nextIndex)])
      return record
    })
  }

  async appendEvent(logId: string, event: SessionEvent): Promise<void> {
    await this.queueWrite(async () => {
      await this.ensureStorage()
      const record = await this.readDetail(logId)

      if (!record) {
        return
      }

      record.events.push(this.toLogEvent(event))
      record.updatedAt = new Date().toISOString()
      await this.writeDetail(record)
    })
  }

  async finishTask(
    logId: string,
    input: {
      status: TaskLogStatus
      endedAt: string
      durationMs: number | null
      exitCode: number | null
    },
  ): Promise<TaskLogRecord | null> {
    return this.queueWrite(async () => {
      await this.ensureStorage()
      const record = await this.readDetail(logId)

      if (!record) {
        return null
      }

      record.status = input.status
      record.endedAt = input.endedAt
      record.durationMs = input.durationMs
      record.exitCode = input.exitCode
      record.updatedAt = new Date().toISOString()

      const index = await this.readIndex()
      const nextIndex = index.map((item) => (item.id === logId ? this.toSummary(record) : item))
      await Promise.all([this.writeDetail(record), this.writeIndex(nextIndex)])
      return record
    })
  }

  async list(filters: LogFilters = {}): Promise<TaskLogSummary[]> {
    await this.waitForWrites()
    await this.ensureStorage()

    let items = await this.readIndex()

    if (filters.status) {
      items = items.filter((item) => item.status === filters.status)
    }

    if (filters.from) {
      const fromValue = Date.parse(filters.from)
      if (!Number.isNaN(fromValue)) {
        items = items.filter((item) => Date.parse(item.startedAt) >= fromValue)
      }
    }

    if (filters.to) {
      const toValue = Date.parse(filters.to)
      if (!Number.isNaN(toValue)) {
        items = items.filter((item) => Date.parse(item.startedAt) <= toValue)
      }
    }

    if (filters.keyword?.trim()) {
      const keyword = filters.keyword.trim().toLowerCase()
      const matched: TaskLogSummary[] = []

      for (const item of items) {
        const haystack = `${item.command}\n${item.cwd}\n${item.group}`.toLowerCase()
        if (haystack.includes(keyword)) {
          matched.push(item)
          continue
        }

        const detail = await this.readDetail(item.id)
        const output = detail?.events
          .map((event) => ('data' in event ? event.data : String(event.exitCode ?? '')))
          .join('\n')
          .toLowerCase()

        if (output?.includes(keyword)) {
          matched.push(item)
        }
      }

      items = matched
    }

    return items.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  }

  async get(logId: string): Promise<TaskLogRecord | null> {
    await this.waitForWrites()
    await this.ensureStorage()
    return this.readDetail(logId)
  }

  async export(logId: string, format: LogExportFormat): Promise<{ fileName: string; contentType: string; body: string }> {
    await this.waitForWrites()
    await this.ensureStorage()
    const record = await this.readDetail(logId)

    if (!record) {
      throw new Error('Log not found')
    }

    if (format === 'json') {
      return {
        fileName: `${logId}.json`,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(record, null, 2) + '\n',
      }
    }

    return {
      fileName: `${logId}.txt`,
      contentType: 'text/plain; charset=utf-8',
      body: this.toText(record),
    }
  }

  private async waitForWrites(): Promise<void> {
    await this.writeQueue
  }

  private queueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation)
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async ensureStorage(): Promise<void> {
    if (!this.storageReady) {
      this.storageReady = (async () => {
        await mkdir(this.detailDir, { recursive: true })

        try {
          await readFile(this.indexPath, 'utf8')
        } catch {
          await writeFile(this.indexPath, '[]\n', 'utf8')
        }
      })()
    }

    await this.storageReady
  }

  private async readIndex(): Promise<TaskLogSummary[]> {
    try {
      const raw = await readFile(this.indexPath, 'utf8')
      const parsed = JSON.parse(raw)

      if (!Array.isArray(parsed)) {
        return []
      }

      return parsed.map((item) => ({
        id: String(item.id),
        taskId: String(item.taskId),
        sessionId: String(item.sessionId),
        command: String(item.command),
        cwd: String(item.cwd),
        group: this.normalizeGroup(item.group),
        status: this.normalizeStatus(item.status),
        startedAt: String(item.startedAt),
        endedAt: item.endedAt ? String(item.endedAt) : null,
        durationMs: typeof item.durationMs === 'number' ? item.durationMs : null,
        exitCode: typeof item.exitCode === 'number' || item.exitCode === null ? item.exitCode : null,
        createdAt: String(item.createdAt),
        updatedAt: String(item.updatedAt),
      }))
    } catch {
      return []
    }
  }

  private async writeIndex(items: TaskLogSummary[]): Promise<void> {
    await writeFile(this.indexPath, JSON.stringify(items, null, 2) + '\n', 'utf8')
  }

  private async readDetail(logId: string): Promise<TaskLogRecord | null> {
    try {
      const raw = await readFile(this.detailPath(logId), 'utf8')
      const parsed = JSON.parse(raw)
      const summary: TaskLogSummary = {
        id: String(parsed.id),
        taskId: String(parsed.taskId),
        sessionId: String(parsed.sessionId),
        command: String(parsed.command),
        cwd: String(parsed.cwd),
        group: this.normalizeGroup(parsed.group),
        status: this.normalizeStatus(parsed.status),
        startedAt: String(parsed.startedAt),
        endedAt: parsed.endedAt ? String(parsed.endedAt) : null,
        durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : null,
        exitCode: typeof parsed.exitCode === 'number' || parsed.exitCode === null ? parsed.exitCode : null,
        createdAt: String(parsed.createdAt),
        updatedAt: String(parsed.updatedAt),
      }

      const events = Array.isArray(parsed.events)
        ? parsed.events
            .filter((item: unknown) => item && typeof item === 'object')
            .map((item: unknown) => this.toLogEvent(item as SessionEvent))
        : []

      return {
        ...summary,
        events,
      }
    } catch {
      return null
    }
  }

  private async writeDetail(record: TaskLogRecord): Promise<void> {
    await writeFile(this.detailPath(record.id), JSON.stringify(record, null, 2) + '\n', 'utf8')
  }

  private detailPath(logId: string): string {
    return path.join(this.detailDir, `${logId}.json`)
  }

  private toSummary(record: TaskLogRecord): TaskLogSummary {
    return {
      id: record.id,
      taskId: record.taskId,
      sessionId: record.sessionId,
      command: record.command,
      cwd: record.cwd,
      group: record.group,
      status: record.status,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      durationMs: record.durationMs,
      exitCode: record.exitCode,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }

  private normalizeGroup(value: unknown): HistoryGroup {
    return value === 'system' || value === 'custom' ? value : 'default'
  }

  private normalizeStatus(value: unknown): TaskLogStatus {
    return value === 'completed' || value === 'failed' || value === 'terminated' ? value : 'running'
  }

  private toLogEvent(event: SessionEvent): TaskLogEvent {
    if (event.type === 'exit') {
      return {
        type: 'exit',
        exitCode: event.exitCode,
        createdAt: String(event.createdAt),
      }
    }

    return {
      type: event.type,
      data: String(event.data),
      createdAt: String(event.createdAt),
    }
  }

  private toText(record: TaskLogRecord): string {
    const lines = [
      `Task: ${record.taskId}`,
      `Session: ${record.sessionId}`,
      `Status: ${record.status}`,
      `Command: ${record.command}`,
      `CWD: ${record.cwd}`,
      `Group: ${record.group}`,
      `Started: ${record.startedAt}`,
      `Ended: ${record.endedAt ?? '--'}`,
      `Duration: ${record.durationMs ?? '--'}`,
      `Exit Code: ${record.exitCode ?? '--'}`,
      '',
      'Output:',
    ]

    for (const event of record.events) {
      if (event.type === 'exit') {
        lines.push(`[${event.createdAt}] exit ${event.exitCode}`)
        continue
      }

      lines.push(`[${event.createdAt}] ${event.type}`)
      lines.push(event.data)
    }

    return lines.join('\n') + '\n'
  }
}
