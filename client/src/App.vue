<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const currentPath = ref('/data/data/com.termux/files/home/storage/downloads')
const command = ref('')
const sessionId = ref('')
const status = ref('idle')
const lines = ref([])
const historyItems = ref([])
const fileItems = ref([])
const loadingFiles = ref(false)
const loadingHistory = ref(false)
const loadingRuntime = ref(false)
const errorText = ref('')
const outputRef = ref(null)
const runtime = ref({
  host: '127.0.0.1',
  port: 3001,
  localhostOnly: true,
  commandMode: 'direct-shell',
})

let socket = null

const statusLabelMap = {
  idle: '空闲',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  terminated: '已中断',
}

const pinnedHistoryItems = computed(() => historyItems.value.filter((item) => item.pinned))
const recentHistoryItems = computed(() => historyItems.value.filter((item) => !item.pinned))
const riskMessage = computed(() =>
  runtime.value.localhostOnly
    ? '本机可访问，命令会直接在当前目录执行，请确认后再执行。'
    : '非本机绑定，存在暴露风险，请先停用服务并改回 127.0.0.1。',
)

function closeSocket() {
  if (socket) {
    socket.close()
    socket = null
  }
}

async function loadRuntime() {
  loadingRuntime.value = true

  try {
    const response = await fetch('/api/runtime')
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || '读取运行信息失败')
    }

    runtime.value = {
      host: data.host,
      port: data.port,
      localhostOnly: data.localhostOnly,
      commandMode: data.commandMode,
    }
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '读取运行信息失败'
  } finally {
    loadingRuntime.value = false
  }
}

async function loadHistory() {
  loadingHistory.value = true

  try {
    const response = await fetch('/api/history')
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || '读取历史失败')
    }

    historyItems.value = data.items ?? []
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '读取历史失败'
  } finally {
    loadingHistory.value = false
  }
}

async function togglePin(item) {
  errorText.value = ''

  try {
    const response = await fetch('/api/history/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, pinned: !item.pinned }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || '收藏更新失败')
    }

    historyItems.value = historyItems.value
      .map((entry) => (entry.id === item.id ? { ...entry, pinned: data.pinned } : entry))
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.createdAt.localeCompare(left.createdAt))
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '收藏更新失败'
  }
}

async function loadFiles(pathValue = currentPath.value) {
  loadingFiles.value = true
  errorText.value = ''

  try {
    const response = await fetch(`/api/files?path=${encodeURIComponent(pathValue)}`)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || '读取目录失败')
    }

    currentPath.value = data.path
    fileItems.value = data.items ?? []
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '读取目录失败'
  } finally {
    loadingFiles.value = false
  }
}

async function openParentDirectory() {
  const segments = currentPath.value.split('/').filter(Boolean)

  if (segments.length <= 1) {
    return
  }

  await loadFiles(`/${segments.slice(0, -1).join('/')}`)
}

function connectSocket(id) {
  closeSocket()

  socket = new WebSocket(`${window.location.origin.replace('http', 'ws')}/ws/sessions/${id}`)

  socket.onmessage = (event) => {
    const payload = JSON.parse(event.data)

    if (payload.type === 'stdout' || payload.type === 'stderr') {
      lines.value.push({ type: payload.type, data: payload.data })
    }

    if (payload.type === 'exit') {
      status.value = payload.exitCode === 0 ? 'completed' : payload.exitCode === null ? 'terminated' : 'failed'
      lines.value.push({ type: 'system', data: `\n[exit ${payload.exitCode}]\n` })
      closeSocket()
    }
  }

  socket.onerror = () => {
    errorText.value = '实时连接失败'
  }
}

async function runCommand() {
  const text = command.value.trim()

  if (!text) {
    return
  }

  errorText.value = ''
  closeSocket()
  sessionId.value = ''
  lines.value = []
  status.value = 'running'

  try {
    const response = await fetch('/api/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: text, cwd: currentPath.value }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || '执行失败')
    }

    sessionId.value = data.sessionId
    connectSocket(sessionId.value)
    await loadHistory()
  } catch (error) {
    status.value = 'idle'
    errorText.value = error instanceof Error ? error.message : '执行失败'
  }
}

async function stopCommand() {
  if (!sessionId.value) {
    return
  }

  const response = await fetch(`/api/sessions/${sessionId.value}/kill`, { method: 'POST' })

  if (!response.ok) {
    const data = await response.json()
    errorText.value = data.message || '中断失败'
  }
}

function useHistory(item) {
  command.value = item.command
  currentPath.value = item.cwd
}

watch(
  lines,
  async () => {
    await nextTick()

    if (outputRef.value) {
      outputRef.value.scrollTop = outputRef.value.scrollHeight
    }
  },
  { deep: true },
)

onBeforeUnmount(() => {
  closeSocket()
})

loadRuntime()
loadHistory()
loadFiles(currentPath.value)
</script>

<template>
  <main class="layout">
    <header class="panel">
      <h1>Termux Web</h1>
      <p class="sub">本机访问 · {{ runtime.host }}:{{ runtime.port }}</p>
      <p class="muted">执行模式：{{ runtime.commandMode }}</p>
    </header>

    <section class="panel risk-panel" :class="runtime.localhostOnly ? 'risk-safe' : 'risk-danger'">
      <div class="section-head">
        <h2>执行风险提示</h2>
        <small class="muted">{{ loadingRuntime ? '读取中...' : (runtime.localhostOnly ? '本机模式' : '非本机模式') }}</small>
      </div>
      <p>{{ riskMessage }}</p>
    </section>

    <section class="panel">
      <label>工作目录</label>
      <input v-model="currentPath" />
      <div class="row wrap">
        <button @click="loadFiles(currentPath)">刷新目录</button>
        <button @click="openParentDirectory">上级目录</button>
      </div>
      <p v-if="loadingFiles" class="muted">目录加载中...</p>
      <p v-if="errorText" class="error">{{ errorText }}</p>
      <ul class="list compact-list">
        <li v-for="item in fileItems" :key="item.path">
          <span class="item-name">{{ item.isDirectory ? '[DIR]' : '[FILE]' }} {{ item.name }}</span>
          <button v-if="item.isDirectory" class="action-btn" @click="loadFiles(item.path)">进入</button>
        </li>
      </ul>
    </section>

    <section class="panel">
      <label>命令</label>
      <textarea v-model="command" rows="3" placeholder="输入命令，如: pwd 或 ls -la"></textarea>
      <div class="row wrap">
        <button @click="runCommand" :disabled="status === 'running'">执行</button>
        <button @click="stopCommand" :disabled="status !== 'running'">中断</button>
        <button @click="loadHistory">刷新历史</button>
      </div>
      <p class="muted">状态: {{ statusLabelMap[status] }}</p>
      <p v-if="sessionId" class="muted">会话: {{ sessionId }}</p>
    </section>

    <section class="panel output">
      <div class="section-head">
        <h2>输出</h2>
        <small class="muted">{{ lines.length }} 条</small>
      </div>
      <pre ref="outputRef">
<code v-for="(line, index) in lines" :key="index" :class="line.type">{{ line.data }}</code>
      </pre>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>收藏命令</h2>
        <small class="muted">{{ loadingHistory ? '刷新中...' : `${pinnedHistoryItems.length} 条` }}</small>
      </div>
      <p v-if="!loadingHistory && pinnedHistoryItems.length === 0" class="muted">暂无收藏命令</p>
      <ul v-else class="list compact-list">
        <li v-for="item in pinnedHistoryItems" :key="item.id">
          <div class="history-meta">
            <button class="link" @click="useHistory(item)">{{ item.command }}</button>
            <small class="history-path">{{ item.cwd }}</small>
          </div>
          <button class="action-btn" @click="togglePin(item)">取消收藏</button>
        </li>
      </ul>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>历史命令</h2>
        <small class="muted">{{ loadingHistory ? '刷新中...' : `${recentHistoryItems.length} 条` }}</small>
      </div>
      <ul class="list compact-list">
        <li v-for="item in recentHistoryItems" :key="item.id">
          <div class="history-meta">
            <button class="link" @click="useHistory(item)">{{ item.command }}</button>
            <small class="history-path">{{ item.cwd }}</small>
          </div>
          <button class="action-btn" @click="togglePin(item)">收藏</button>
        </li>
      </ul>
    </section>
  </main>
</template>
