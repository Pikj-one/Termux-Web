# Termux Web

一个运行在 **Termux（无 Root）** 环境中的移动端 Web 终端界面。

它提供：
- 前台命令执行与实时输出
- 多终端标签
- 后台任务队列
- 历史命令、收藏、分组
- 文件浏览 / 上传 / 下载
- 日志检索与导出
- 移动端主题切换与快捷操作

默认面向 **手机本机浏览器** 使用，服务监听 `127.0.0.1`。

---

## 1. 运行环境

- Android
- Termux
- 无 Root
- 手机存储已映射到 `storage/downloads`
- Node.js / npm 可用

建议先完成 Termux 存储授权：

```bash
termux-setup-storage
```

---

## 2. 项目结构

```text
Web/
  README.md
  plan.md
  server/
  client/
```

---

## 3. 安装依赖

分别安装前后端依赖：

```bash
npm install --prefix /data/data/com.termux/files/home/Web/server
npm install --prefix /data/data/com.termux/files/home/Web/client
```

---

## 4. 配置说明

配置文件位置：

```text
/data/data/com.termux/files/home/Web/server/data/config.json
```

当前配置项：

- `listenHost`：监听地址，默认建议 `127.0.0.1`
- `listenPort`：监听端口，例如 `3001`
- `allowedRoots`：允许访问的目录根路径
- `taskConcurrency`：后台任务并发数，默认 `1`

示例：

```json
{
  "listenHost": "127.0.0.1",
  "listenPort": 3001,
  "allowedRoots": [
    "/data/data/com.termux/files/home/Web",
    "/data/data/com.termux/files/home/storage/downloads"
  ],
  "taskConcurrency": 1
}
```

---

## 5. 构建

先构建前后端：

```bash
npm run build --prefix /data/data/com.termux/files/home/Web/server
npm run build --prefix /data/data/com.termux/files/home/Web/client
```

---

## 6. 启动方式

### 6.1 开发模式

后端开发启动：

```bash
npm run dev --prefix /data/data/com.termux/files/home/Web/server
```

前端开发模式如果单独调试，也可以启动：

```bash
npm run dev --prefix /data/data/com.termux/files/home/Web/client
```

### 6.2 生产/本地使用方式

推荐先构建，再启动后端服务：

```bash
npm run build --prefix /data/data/com.termux/files/home/Web/server
npm run build --prefix /data/data/com.termux/files/home/Web/client
npm run start --prefix /data/data/com.termux/files/home/Web/server
```

启动后，在手机本机浏览器打开：

```text
http://127.0.0.1:3001
```

如果你修改了端口，请按实际端口访问。

---

## 7. 基本使用方法

### 7.1 前台执行命令

1. 打开页面
2. 在“工作目录”中选择或输入目录
3. 在“命令”输入框填写命令
4. 点击“执行”
5. 在“输出”面板查看实时结果

支持：
- 实时 stdout / stderr 输出
- 中断运行中的前台命令
- 会话状态、耗时、退出码展示

### 7.2 多终端标签

- 点击“新增标签”创建新终端标签
- 不同标签可分别保留各自命令与输出上下文
- 可关闭不需要的标签

### 7.3 后台任务

适合长时间任务，不阻塞当前终端交互。

使用方法：
1. 输入命令
2. 点击“提交后台”
3. 在“后台任务”面板查看状态
4. 可查看：
   - `pending`
   - `running`
   - `completed`
   - `failed`
   - `terminated`
5. 可从任务面板跳转到关联会话输出
6. 可中断运行中或排队中的任务

### 7.4 历史命令 / 收藏 / 分组

- 执行过的命令会进入历史记录
- 可将常用命令加入收藏
- 可设置分组：
  - 默认
  - 系统
  - 自定义
- 点击历史命令可回填到当前输入区

### 7.5 文件浏览 / 上传 / 下载

在“工作目录”与文件面板中可：
- 浏览允许目录下的文件
- 进入子目录
- 返回上级目录
- 上传文件到当前目录
- 下载文件

默认重点使用目录：

```text
/data/data/com.termux/files/home/storage/downloads
```

### 7.6 日志检索与导出

后台任务完成后可在日志面板中：
- 按关键字检索
- 按状态筛选
- 按时间范围筛选
- 查看单条日志详情
- 导出日志：
  - `txt`
  - `json`

---

## 8. 常见操作示例

### 查看当前目录

```bash
pwd
```

### 查看文件列表

```bash
ls -la
```

### 后台执行长任务

```bash
sleep 10 && echo done
```

### 查看 Termux 存储目录

```bash
cd /data/data/com.termux/files/home/storage/downloads && ls
```

---

## 9. 数据落盘位置

### 历史记录

```text
/data/data/com.termux/files/home/Web/server/data/history.json
```

### 运行配置

```text
/data/data/com.termux/files/home/Web/server/data/config.json
```

### 后台任务日志

```text
/data/data/com.termux/files/home/Web/server/data/logs/index.json
/data/data/com.termux/files/home/Web/server/data/logs/entries/
```

---

## 10. 安全说明

本项目当前设计为：
- 默认仅监听 `127.0.0.1`
- 不做访客/管理员权限模型
- 命令由当前设备本机用户直接执行

这意味着：
- **不要**随意改成公网或局域网暴露
- 输入的命令会直接在 Termux 中执行
- 请自行确认命令风险

---

## 11. 故障排查

### 页面打不开

先确认服务是否启动：

```bash
npm run start --prefix /data/data/com.termux/files/home/Web/server
```

然后确认端口配置是否为 `3001`，再访问：

```text
http://127.0.0.1:3001
```

### 无法访问 `storage/downloads`

请先执行：

```bash
termux-setup-storage
```

并确认配置文件 `allowedRoots` 中包含：

```text
/data/data/com.termux/files/home/storage/downloads
```

### 前端内容没有更新

重新构建 client：

```bash
npm run build --prefix /data/data/com.termux/files/home/Web/client
```

### 服务端改动后没有生效

重新构建并启动 server：

```bash
npm run build --prefix /data/data/com.termux/files/home/Web/server
npm run start --prefix /data/data/com.termux/files/home/Web/server
```

---

## 12. 当前阶段说明

当前主功能已覆盖：
- 多标签终端
- 上传下载
- 历史分组与收藏
- 后台任务队列
- 日志检索与导出
- 移动端主题与快捷操作

---

## 13. 开发校验命令

```bash
npm run build --prefix /data/data/com.termux/files/home/Web/server
npm run build --prefix /data/data/com.termux/files/home/Web/client
```

如果需要启动后直接检查接口：

```bash
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3001/api/runtime
```
