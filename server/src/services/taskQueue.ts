import { randomUUID } from 'node:crypto'
import { type HistoryGroup, HistoryStore } from './historyStore.js'
import { LogStore } from './logStore.js'
import { SessionManager, type SessionEvent } from './sessionManager.js'

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'terminated'

export type TaskSummary = {
  id: string
  command: string
  cwd: string
  group: HistoryGroup
  status: TaskStatus
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  exitCode: number | null
  sessionId: string | null
  logId: string | null
}

type TaskRecord = TaskSummary & {
  killRequested: boolean
}

export class TaskQueue {
  private readonly tasks = new Map<string, TaskRecord>()
  private readonly pendingQueue: string[] = []
  private runningCount = 0

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly historyStore: HistoryStore,
    private readonly logStore: LogStore,
    private readonly concurrency: number,
  ) {}

  async create(command: string, cwd: string, group: HistoryGroup): Promise<TaskSummary> {
    const now = new Date().toISOString()
    const id = randomUUID()
    const task: TaskRecord = {
      id,
      command,
      cwd,
      group,
      status: 'pending',
      createdAt: now,
      startedAt: null,
      endedAt: null,
      durationMs: null,
      exitCode: null,
      sessionId: null,
      logId: null,
      killRequested: false,
    }

    this.tasks.set(id, task)
    this.pendingQueue.push(id)
    this.tryStartNext()
    return this.toSummary(task)
  }

  list(status?: TaskStatus): TaskSummary[] {
    const items = Array.from(this.tasks.values())
      .filter((item) => (status ? item.status === status : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))

    return items.map((item) => this.toSummary(item))
  }

  get(taskId: string): TaskSummary | null {
    const task = this.tasks.get(taskId)
    return task ? this.toSummary(task) : null
  }

  async kill(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId)

    if (!task) {
      return false
    }

    if (task.status === 'pending') {
      const endedAt = new Date().toISOString()
      task.status = 'terminated'
      task.startedAt = task.createdAt
      task.endedAt = endedAt
      task.durationMs = Date.parse(endedAt) - Date.parse(task.startedAt)
      task.exitCode = null
      task.logId = task.id
      this.removePending(taskId)

      await this.logStore.beginTask({
        id: task.id,
        taskId: task.id,
        sessionId: '',
        command: task.command,
        cwd: task.cwd,
        group: task.group,
        startedAt: task.startedAt,
      })

      await this.logStore.finishTask(task.logId, {
        status: 'terminated',
        endedAt,
        durationMs: task.durationMs,
        exitCode: null,
      })

      return true
    }

    if (task.status !== 'running' || !task.sessionId) {
      return false
    }

    task.killRequested = true
    return this.sessionManager.kill(task.sessionId)
  }


  private tryStartNext(): void {
    while (this.runningCount < this.concurrency && this.pendingQueue.length > 0) {
      const taskId = this.pendingQueue.shift()

      if (!taskId) {
        continue
      }

      const task = this.tasks.get(taskId)

      if (!task || task.status !== 'pending') {
        continue
      }

      void this.startTask(task)
    }
  }

  private async startTask(task: TaskRecord): Promise<void> {
    this.runningCount += 1
    task.status = 'running'
    task.startedAt = new Date().toISOString()

    try {
      const session = this.sessionManager.create(task.command, task.cwd)
      task.sessionId = session.id
      task.logId = task.id

      await Promise.all([
        this.historyStore.add(task.command, task.cwd, task.group),
        this.logStore.beginTask({
          id: task.id,
          taskId: task.id,
          sessionId: session.id,
          command: task.command,
          cwd: task.cwd,
          group: task.group,
          startedAt: task.startedAt,
        }),
      ])

      let unsubscribe: (() => void) | null = null
      unsubscribe = this.sessionManager.subscribe(session.id, (event) => {
        void this.handleSessionEvent(task.id, event, () => {
          if (unsubscribe) {
            unsubscribe()
            unsubscribe = null
          }
        })
      })

      if (!unsubscribe) {
        throw new Error('Failed to subscribe session events')
      }
    } catch {
      task.status = 'failed'
      task.endedAt = new Date().toISOString()
      task.durationMs = task.startedAt ? Date.parse(task.endedAt) - Date.parse(task.startedAt) : null
      task.exitCode = null
      this.runningCount = Math.max(0, this.runningCount - 1)
      this.tryStartNext()
    }
  }

  private async handleSessionEvent(
    taskId: string,
    event: SessionEvent,
    onFinished: () => void,
  ): Promise<void> {
    const task = this.tasks.get(taskId)

    if (!task || task.status !== 'running') {
      return
    }

    if (task.logId) {
      await this.logStore.appendEvent(task.logId, event)
    }

    if (event.type !== 'exit') {
      return
    }

    task.exitCode = event.exitCode
    task.endedAt = event.createdAt
    task.durationMs = task.startedAt ? Date.parse(task.endedAt) - Date.parse(task.startedAt) : null
    task.status = task.killRequested || event.exitCode === null ? 'terminated' : event.exitCode === 0 ? 'completed' : 'failed'

    if (task.logId) {
      await this.logStore.finishTask(task.logId, {
        status: task.status,
        endedAt: task.endedAt,
        durationMs: task.durationMs,
        exitCode: task.exitCode,
      })
    }

    onFinished()
    this.runningCount = Math.max(0, this.runningCount - 1)
    this.tryStartNext()
  }


  private removePending(taskId: string): void {
    const index = this.pendingQueue.indexOf(taskId)

    if (index >= 0) {
      this.pendingQueue.splice(index, 1)
    }
  }

  private toSummary(task: TaskRecord): TaskSummary {
    return {
      id: task.id,
      command: task.command,
      cwd: task.cwd,
      group: task.group,
      status: task.status,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
      durationMs: task.durationMs,
      exitCode: task.exitCode,
      sessionId: task.sessionId,
      logId: task.logId,
    }
  }
}
