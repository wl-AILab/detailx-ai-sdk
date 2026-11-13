# AI SDK 社区 Provider 发布与维护

公开源码：[wl-AILab/detailx-ai-sdk](https://github.com/wl-AILab/detailx-ai-sdk)。npm 包为 `@detailx/sdk` 和 `@detailx/ai-sdk-provider`。真实生产 API 验收范围见 [VERIFICATION.md](VERIFICATION.md)。

AI SDK 社区文档收录需要维护者审核；npm 发布与社区 PR 合并是不同状态，也不代表已接入 AI Gateway。

## 发布流程

1. 在公开仓库根目录执行 `npm ci`、`npm run build`、`npm run check`、`npm test`，等待 Node.js 22 和 24 的 GitHub Actions 检查通过。
2. 检查版本、依赖和变更日志。依赖中必须保留 npm 版本号，不使用本地 `file:` 路径。
3. 运行两个 workspace 的 `npm pack --dry-run`，确认不含凭据、私有状态、账号数据和素材。
4. 将两个包打包到 `artifacts/`；如 SDK 有新版本，先发布 SDK，再发布依赖该版本的 Provider。发布命令为 `npm publish artifacts/<package>.tgz --access public`。
5. 从 npm registry 在独立目录安装正式版本，验证入口、类型和真实任务恢复；以同一业务 ID 恢复验收任务，避免新增扣费。
6. 为版本创建 GitHub Release，附上已验证的两个 tgz 和 SHA256 校验。
7. 将 `community-provider.mdx` 放入 `vercel/ai` 当前的社区文档目录，运行文档校验后提交签名 commit 和社区文档 PR。`community-pr.md` 为 PR 文案。

## 真实验收

`scripts/acceptance.mjs` 分 `start` 和 `finish` 两个进程执行。使用自有三秒以内样片、稳定业务 ID、私有持久状态目录和最多 10 积分预扣预算。先准备真实媒体元数据和首帧 JPEG。`start` 会创建真实收费任务；`finish` 恢复原任务，核对账单并下载，不应新建任务。

测试 Key 只从服务器环境读取，不上传 GitHub Secret 或公共包。失败、退款、价格变化、过期链接及高并发场景应持续补充验收；本地等待超时不表示取消或退款。

官方：[Custom Providers](https://ai-sdk.dev/providers/community-providers/custom-providers)、[Generate Video](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-video)。
