# @detailx/sdk

Node.js 20+ 的 DetailX 公共 SDK，支持报价、持久化幂等提交、任务查询/轮询及分片上传。推荐 Node 22 或 24。

```ts
import { DetailXClient } from '@detailx/sdk';

const client = new DetailXClient({ stateDir: '/persistent/detailx' });
// DETAILX_API_KEY 从服务器环境读取。
const prepared = await client.prepareGeneration(
  { uploadId: 'OWNED_ASSET_ID' },
  { resolution: '4K', fps: -1, detail: '2' },
  { requestId: 'order-100', maxPrechargeCredits: 100 },
);
console.log(prepared.quote);
// 用户或平台授权后才提交：
const job = await client.submit(prepared);
console.log(job.id);
const completed = await client.wait(job.id);
console.log(completed.results);
```

同一业务操作保持 requestId；新操作更换 ID。SDK 把报价、价格版本、完整请求和幂等键先落盘，再请求扣费接口。超时后用相同 ID 恢复；价格变化不会自动重新报价提交。`maxPrechargeCredits` 约束预扣，不能限制后续按实际时长结算的补扣。

默认 `FileRequestStore` 使用原子快照和账号哈希作用域，不保存 Key。部署到无持久磁盘的 Vercel Functions 时必须提供基于事务数据库的 `RequestStore`，或把 SDK 放在有持久存储的任务服务中。不能用普通内存 Map 承担生产幂等保证。按 Key 的限流器仅覆盖当前实例，多实例需在网关统一限流。

内置 PostgreSQL 适配器可跨进程恢复，需额外安装 `pg`，并为数据库连接配置 TLS、连接池与访问权限：

```ts
import pg from 'pg';
import { PostgresRequestStore } from '@detailx/sdk/postgres';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const durableClient = new DetailXClient({ store: new PostgresRequestStore(pool) });
// 在宿主进程退出时执行 await pool.end()。
```

TypeScript 使用 `detailx_ts_requests`，Python 使用 `detailx_requests`，两者快照格式独立。业务 ID 应包含渠道前缀；跨语言迁移须保留原请求和幂等键，不能直接复用另一语言的数据库记录。

## 本地文件上传

`uploadFile(path, {requestId, metadata, thumbnail})` 实现完整分片协议。`metadata` 必须由可信媒体解码器取得，`thumbnail` 必须是实际视频第一帧 JPEG。Node 包不伪造时长或分辨率，不内置 FFmpeg 二进制。可运行公共 Python SDK 的 `tools/prepare_media.py`，得到 `metadata.json` 和 `thumbnail.jpg`，再在 Node 侧传入；准备阶段不会上传或扣费。

```ts
import { readFile } from 'node:fs/promises';
const metadata = JSON.parse(await readFile('metadata.json', 'utf8'));
const thumbnail = await readFile('thumbnail.jpg');
const upload = await client.uploadFile('source.mp4', {
  requestId: 'order-100:upload', metadata, thumbnail,
});
// upload.asset_id 才是 generation 所需的 uploadId。
```

TypeScript 上传会检查实时策略、SHA256、Base64 MD5、精确 Content-Length 和断点版本；PUT 不携带 API Bearer。它接受受信任 API 返回的签名 HTTPS 地址。处理用户 URL 的下载与探测建议交给隔离媒体 worker，不要在浏览器暴露服务 Key。

`wait` AbortSignal 和超时仅中止本地等待。不要用删除接口实现取消或退款。结果 URL 会过期；通过 `getGeneration(id)` 刷新，不把链接当永久资源。

源码验证：`npm run build && npm test`。发布流程见 `PUBLISHING.md`。
