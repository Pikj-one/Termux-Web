import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

export type HistoryEntry = {
  id: string
  command: string
  cwd: string
  createdAt: string
  pinned: boolean
}

export class HistoryStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<HistoryEntry[]> {
    const entries = await this.readEntries()
    return entries.sort(
      (left, right) => Number(right.pinned) - Number(left.pinned) || right.createdAt.localeCompare(left.createdAt),
    )
  }

  async add(command: string, cwd: string): Promise<HistoryEntry> {
    const entries = await this.readEntries()
    const entry: HistoryEntry = {
      id: randomUUID(),
      command,
      cwd,
      createdAt: new Date().toISOString(),
      pinned: false,
    }

    entries.push(entry)
    await this.writeEntries(entries)
    return entry
  }

  async setPinned(id: string, pinned: boolean): Promise<HistoryEntry | null> {
    const entries = await this.readEntries()
    const entry = entries.find((item) => item.id === id)

    if (!entry) {
      return null
    }

    entry.pinned = pinned
    await this.writeEntries(entries)
    return entry
  }

  private async readEntries(): Promise<HistoryEntry[]> {
    const raw = await readFile(this.filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : []
  }

  private async writeEntries(entries: HistoryEntry[]): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(entries, null, 2) + '\n', 'utf8')
  }
}
