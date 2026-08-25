# 夜后修复 Web Push Worker

这个 Worker 负责保存浏览器推送订阅、按分钟扫描待发送提醒，并发送不含健康数据的通用文案。

## 数据边界

Worker 只保存：

- 匿名设备标识
- 浏览器 Push endpoint 与加密公钥
- 提醒类型（例如 `light`、`caffeine`）
- UTC 执行时间

它不接收提醒标题和描述，也不接收睡眠、症状、情绪、归因、实验结果或补剂记录。订阅记录最长保留 60 天，单次待发送索引最长保留 48 小时；无效订阅会在推送服务返回 404/410 时删除。

## 首次部署

要求：Node.js 20+、Cloudflare 账户与 Wrangler 登录状态。

```bash
cd worker
npm install
npx web-push generate-vapid-keys --json
npx wrangler kv namespace create PUSH_SUBSCRIPTIONS
npx wrangler kv namespace create PUSH_SUBSCRIPTIONS --preview
```

然后：

1. 把 KV 命令返回的生产与预览 ID 写入 `wrangler.jsonc`。
2. 把 VAPID 公钥写入 `VAPID_PUBLIC_KEY`，把有效联系邮箱写入 `VAPID_SUBJECT`。
3. 运行 `npx wrangler secret put VAPID_PRIVATE_KEY`，粘贴 VAPID 私钥。
4. 运行 `npm run deploy`。
5. 将部署得到的 HTTPS Worker 地址写入根目录的 `push-config.js`：

```js
window.NIGHT_REPAIR_PUSH_CONFIG = Object.freeze({
  workerUrl: "https://night-repair-push.YOUR_SUBDOMAIN.workers.dev",
});
```

6. 再发布静态站。若更换站点域名，同时更新 `ALLOWED_ORIGINS` 与 `APP_URL`。

不要把 VAPID 私钥写进 `wrangler.jsonc`、`push-config.js` 或 Git。`.dev.vars` 已被忽略，本地调试可从 `.dev.vars.example` 复制后填写。

## 本地检查

```bash
npm test
npm run dev
```

Worker 的 `/health` 可用于存活检查；浏览器必须从安全上下文使用 Web Push。iPhone/iPad 需要先把网站添加到主屏幕，再从主屏幕内开启通知。
