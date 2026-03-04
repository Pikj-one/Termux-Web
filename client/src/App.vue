<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const currentPath = ref('/data/data/com.termux/files/home/storage/downloads')
const command = ref('')
const historyGroup = ref('default')
const tabs = ref([createTab('终端 1')])
const activeTabId = ref(tabs.value[0].id)
const historyItems = ref([])
const fileItems = ref([])
const loadingFiles = ref(false)
const loadingHistory = ref(false)
const loadingRuntime = ref(false)
const uploading = ref(false)
const errorText = ref('')
const outputRef = ref(null)
const uploadInputRef = ref(null)
const runtime = ref({
  host: '127.0.0.1',
  port: 3001,
  localhostOnly: true,
  commandMode: 'direct-shell',
})

const statusLabelMap = {
  idle: '空闲',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  terminated: '已中断',
}

const groupLabelMap = {
  default: '默认',
  system: '系统',
  custom: '自定义',
}

const pinnedHistoryItems = computed(() => historyItems.value.filter((item) => item.pinned))
const recentHistoryItems = computed(() => historyItems.value.filter((item) => !item.pinned))
const riskMessage = computed(() =>
  runtime.value.localhostOnly
    ? '本机可访问，命令会直接在当前目录执行，请确认后再执行。'
    : '非本机绑定，存在暴露风险，请先停用服务并改回 127.0.0.1。',
)
const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value) ?? tabs.value[0])

function createTab(name) {
  return {
    id: crypto.randomUUID(),
    name,
    sessionId: '',
    status: 'idle',
    lines: [],
    command: '',
    startedAt: '',
    endedAt: '',
    durationMs: null,
    exitCode: null,
    socket: null,
  }
}

function ensureActiveTab() {
  const tab = activeTab.value
  if (!tab) {
    const created = createTab(`终端 ${tabs.value.length + 1}`)
    tabs.value.push(created)
    activeTabId.value = created.id
    return created
  }
  return tab
}

function closeSocket(tab) {
  if (tab.socket) {
    tab.socket.close()
    tab.socket = null
  }
}

function closeAllSockets() {
  tabs.value.forEach((tab) => closeSocket(tab))
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

async function updateGroup(item, group) {
  errorText.value = ''

  try {
    const response = await fetch('/api/history/group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, group }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || '分组更新失败')
    }

    historyItems.value = historyItems.value.map((entry) => (entry.id === item.id ? { ...entry, group: data.group } : entry))
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '分组更新失败'
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

function triggerUpload() {
  uploadInputRef.value?.click()
}

async function uploadSelectedFile(event) {
  const target = event.target
  const file = target.files?.[0]

  if (!file) {
    return
  }

  uploading.value = true
  errorText.value = ''

  try {
    const formData = new FormData()
    formData.append('path', currentPath.value)
    formData.append('file', file)

    const response = await fetch('/api/files/upload', {
      method: 'POST',
      body: formData,
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || '上传失败')
    }

    await loadFiles(currentPath.value)
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '上传失败'
  } finally {
    uploading.value = false
    target.value = ''
  }
}

function downloadFile(item) {
  window.open(`/api/files/download?path=${encodeURIComponent(item.path)}`, '_blank')
}

function connectSocket(tab, id) {
  closeSocket(tab)

  tab.socket = new WebSocket(`${window.location.origin.replace('http', 'ws')}/ws/sessions/${id}`)

  tab.socket.onmessage = (event) => {
    const payload = JSON.parse(event.data)

    if (payload.type === 'stdout' || payload.type === 'stderr') {
      tab.lines.push({ type: payload.type, data: payload.data })
    }

    if (payload.type === 'exit') {
      tab.exitCode = payload.exitCode
      tab.status = payload.exitCode === 0 ? 'completed' : payload.exitCode === null ? 'terminated' : 'failed'
      tab.endedAt = payload.createdAt || new Date().toISOString()
      tab.durationMs = Date.parse(tab.endedAt) - Date.parse(tab.startedAt)
      tab.lines.push({ type: 'system', data: `\n[exit ${payload.exitCode}]\n` })
      closeSocket(tab)
    }
  }

  tab.socket.onerror = () => {
    errorText.value = '实时连接失败'
  }
}

async function runCommand() {
  const tab = ensureActiveTab()
  const text = tab.command.trim()

  if (!text) {
    return
  }

  errorText.value = ''
  closeSocket(tab)
  tab.sessionId = ''
  tab.lines = []
  tab.status = 'running'
  tab.startedAt = new Date().toISOString()
  tab.endedAt = ''
  tab.durationMs = null
  tab.exitCode = null

  try {
    const response = await fetch('/api/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: text, cwd: currentPath.value, group: historyGroup.value }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || '执行失败')
    }

    tab.sessionId = data.sessionId
    connectSocket(tab, tab.sessionId)
    await loadHistory()
  } catch (error) {
    tab.status = 'idle'
    errorText.value = error instanceof Error ? error.message : '执行失败'
  }
}

async function stopCommand() {
  const tab = ensureActiveTab()

  if (!tab.sessionId) {
    return
  }

  const response = await fetch(`/api/sessions/${tab.sessionId}/kill`, { method: 'POST' })

  if (!response.ok) {
    const data = await response.json()
    errorText.value = data.message || '中断失败'
  }
}

function useHistory(item) {
  const tab = ensureActiveTab()
  tab.command = item.command
  currentPath.value = item.cwd
  historyGroup.value = item.group || 'default'
}

function addTab() {
  const created = createTab(`终端 ${tabs.value.length + 1}`)
  tabs.value.push(created)
  activeTabId.value = created.id
}

function switchTab(tabId) {
  activeTabId.value = tabId
}

function removeTab(tabId) {
  if (tabs.value.length === 1) {
    return
  }

  const index = tabs.value.findIndex((tab) => tab.id === tabId)
  if (index < 0) {
    return
  }

  closeSocket(tabs.value[index])
  tabs.value.splice(index, 1)

  if (activeTabId.value === tabId) {
    activeTabId.value = tabs.value[Math.max(0, index - 1)].id
  }
}

function formatDateTime(value) {
  if (!value) {
    return '--'
  }
  return new Date(value).toLocaleString()
}

function formatDuration(ms) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) {
    return '--'
  }
  if (ms < 1000) {
    return `${ms}ms`
  }
  return `${(ms / 1000).toFixed(2)}s`
}

watch(
  () => activeTab.value?.lines,
  async () => {
    await nextTick()

    if (outputRef.value) {
      outputRef.value.scrollTop = outputRef.value.scrollHeight
    }
  },
  { deep: true },
)

onBeforeUnmount(() => {
  closeAllSockets()
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
        <small class="muted">{{ loadingRuntime ? '读取中...' : runtime.localhostOnly ? '本机模式' : '非本机模式' }}</small>
      </div>
      <p>{{ riskMessage }}</p>
    </section>

    <section class="panel">
      <label>工作目录</label>
      <input v-model="currentPath" />
      <div class="row wrap">
        <button @click="loadFiles(currentPath)">刷新目录</button>
        <button @click="openParentDirectory">上级目录</button>
        <button @click="triggerUpload" :disabled="uploading">{{ uploading ? '上传中...' : '上传文件' }}</button>
        <input ref="uploadInputRef" class="hidden-input" type="file" @change="uploadSelectedFile" />
      </div>
      <p v-if="loadingFiles" class="muted">目录加载中...</p>
      <p v-if="errorText" class="error">{{ errorText }}</p>
      <ul class="list compact-list">
        <li v-for="item in fileItems" :key="item.path">
          <span class="item-name">{{ item.isDirectory ? '[DIR]' : '[FILE]' }} {{ item.name }}</span>
          <div class="row tight-row">
            <button v-if="item.isDirectory" class="action-btn" @click="loadFiles(item.path)">进入</button>
            <button v-else class="action-btn" @click="downloadFile(item)">下载</button>
          </div>
        </li>
      </ul>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>终端标签</h2>
        <button class="action-btn" @click="addTab">新增标签</button>
      </div>
      <div class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab-btn"
          :class="{ active: tab.id === activeTabId }"
          @click="switchTab(tab.id)"
        >
          <span>{{ tab.name }} · {{ statusLabelMap[tab.status] }}</span>
          <span class="tab-close" @click.stop="removeTab(tab.id)">×</span>
        </button>
      </div>
    </section>

    <section class="panel">
      <label>命令</label>
      <textarea v-model="activeTab.command" rows="3" placeholder="输入命令，如: pwd 或 ls -la"></textarea>
      <div class="row wrap">
        <button @click="runCommand" :disabled="activeTab.status === 'running'">执行</button>
        <button @click="stopCommand" :disabled="activeTab.status !== 'running'">中断</button>
        <button @click="loadHistory">刷新历史</button>
        <select v-model="historyGroup" class="group-select">
          <option value="default">默认分组</option>
          <option value="system">系统分组</option>
          <option value="custom">自定义分组</option>
        </select>
      </div>
      <p class="muted" :class="{ 'status-failed': activeTab.status === 'failed' }">状态: {{ statusLabelMap[activeTab.status] }}</p>
      <p v-if="activeTab.sessionId" class="muted">会话: {{ activeTab.sessionId }}</p>
      <p class="muted">开始: {{ formatDateTime(activeTab.startedAt) }}</p>
      <p class="muted">结束: {{ formatDateTime(activeTab.endedAt) }}</p>
      <p class="muted">耗时: {{ formatDuration(activeTab.durationMs) }}</p>
      <p class="muted" :class="{ 'status-failed': activeTab.exitCode !== null && activeTab.exitCode !== 0 }">退出码: {{ activeTab.exitCode ?? '--' }}</p>
    </section>

    <section class="panel output">
      <div class="section-head">
        <h2>输出</h2>
        <small class="muted">{{ activeTab.lines.length }} 条</small>
      </div>
      <pre ref="outputRef">
<code v-for="(line, index) in activeTab.lines" :key="index" :class="line.type">{{ line.data }}</code>
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
            <small class="history-path">{{ item.cwd }} · {{ groupLabelMap[item.group || 'default'] }}</small>
          </div>
          <div class="row tight-row">
            <select class="group-select" :value="item.group || 'default'" @change="updateGroup(item, $event.target.value)">
              <option value="default">默认</option>
              <option value="system">系统</option>
              <option value="custom">自定义</option>
            </select>
            <button class="action-btn" @click="togglePin(item)">取消收藏</button>
          </div>
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
            <small class="history-path">{{ item.cwd }} · {{ groupLabelMap[item.group || 'default'] }}</small>
          </div>
          <div class="row tight-row">
            <select class="group-select" :value="item.group || 'default'" @change="updateGroup(item, $event.target.value)">
              <option value="default">默认</option>
              <option value="system">系统</option>
              <option value="custom">自定义</option>
            </select>
            <button class="action-btn" @click="togglePin(item)">收藏</button>
          </div>
        </li>
      </ul>
    </section>
  </main>
</template>
