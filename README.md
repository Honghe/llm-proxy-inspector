# LLM Proxy Inspector

OpenAI-compatible 反向代理 + 请求/响应可视化查看器。

当前版本已拆分为独立前端与后端：

- `backend/` 负责 OpenAI-compatible 反向代理、SSE 转发、sqlite 持久化、会话 API
- `frontend/` 负责独立 UI 展示，通过 HTTP 调用后端 `/api/*`
- 前端已改为 `Vite + React + TypeScript + React Router + TanStack Query`

## 安装

```bash
pip install -r requirements.txt
cd frontend && npm install
```

## 启动

```bash
# 一键同时启动前后端
./start.sh

# 单独启动后端
python backend/app.py
python backend/app.py --host 127.0.0.1 --upstream http://127.0.0.1:8000 --proxy-port 7654 --db-path data/proxy.db

# 单独构建前端
cd frontend && npm run build

# 单独启动前端静态服务
python frontend/server.py --host 127.0.0.1 --port 7655

# 前端开发模式
cd frontend && npm run dev
```

默认端口：

- 后端代理与 API：`http://127.0.0.1:7654`
- 前端 UI：`http://127.0.0.1:7655`

## 使用

- 客户端将 API 地址指向 `http://<your-host>:7654`
- 浏览器打开 `http://<your-host>:7655` 查看请求/响应
- UI 会自动把连续对话归并成一个 session，按时间线查看每一轮请求/响应
- 支持显式透传 `x-session-id` / `x-conversation-id` / `x-thread-id` 来强制归组
- 前端默认会把 API 指向同主机的 `:7654`

## 截图

**消息双栏视图（Request / Response）**

![消息视图](docs/message.png)

**Raw JSON 视图**

![Raw JSON](docs/rawjson.png)

**SSE Chunks 视图**

![SSE Chunks](docs/sse-chunks.png)

## 功能

- [x] 透传所有 HTTP 方法，原始数据不变
- [x] 流式 SSE 实时转发，结束后自动合并解析
- [x] 非流式 JSON 响应直接展示
- [x] 消息双栏视图（Request / Response）
- [x] Raw JSON 视图，支持一键复制
- [x] SSE Chunks 视图，支持一键复制
- [x] 思考链（reasoning）折叠展示
- [x] 工具调用（tool call）折叠展示
- [x] 侧边栏 5 秒局部刷新，不影响当前 tab
- [x] URL 格式 `/ids/<record_id>` 可分享
- [x] sqlite 持久化，重启后历史不丢
- [x] 会话视图，连续对话按 session 聚合展示

## License

[MIT](LICENSE)

## 目录结构

```
llm-proxy-inspector/
├── backend/
│   └── app.py        # 后端：代理 + 数据 API
├── frontend/
│   ├── src/          # React + TypeScript 源码
│   ├── dist/         # Vite 构建产物（生成）
│   ├── package.json
│   ├── index.html    # Vite 入口模板
│   └── server.py     # 前端静态服务（托管 dist，支持 SPA fallback）
├── Dockerfile.backend
├── Dockerfile.frontend
├── requirements.txt
└── start.sh
```

## OpenAI SDK 做法

关于 SSE stream 转 JSON, OpenAI Python SDK 不用通用的 _merge_delta，而是用强类型的 Pydantic 模型 + 专用 accumulate_delta 函数，按字段路径硬编码规则：

```
# openai/lib/_parsing/_completions.py 简化逻辑
# 只有这些路径会做拼接：
#   choice.delta.content
#   choice.delta.tool_calls[i].function.arguments
# 其余字段（type, id, role, name...）只在首次出现时设置，后续 chunk 不重复发送
```

关键在于：OpenAI 流式协议本身保证 type/id/role 这类字段只在首个 chunk 出现，后续 chunk 里就不会再有这些字段，所以官方 SDK 根本不用处理"重复覆盖"的问题。

而第三方 OpenAI-compatible 上游返回的 SSE 流可能在每个 chunk 里都带了 type: "function"，这本身是上游行为问题，但代理需要容错处理。
