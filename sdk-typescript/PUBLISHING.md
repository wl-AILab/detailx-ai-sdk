# npm SDK 发布

包名 `@detailx/sdk`，npm 账号 `detailx` 与 scope 发布权限已确认。公开源码为 [wl-AILab/detailx-ai-sdk](https://github.com/wl-AILab/detailx-ai-sdk)，本包位于 `sdk-typescript/`。Provider 发布与真实验收记录见 [AI SDK 上架说明](../ai-sdk-provider/PUBLISHING.md)。

[`@detailx/sdk@0.1.0`](https://www.npmjs.com/package/@detailx/sdk) 已于 2026-11-13 正式发布，独立 registry 安装的 integrity 与验收 tarball 一致，真实任务恢复、下载和单笔结算复验通过。

```bash
npm install
npm run build
npm test
npm pack --dry-run
npm publish --access public
```

先发布本 SDK，再发布 AI SDK Provider。根目录 `artifacts` 也会提供 `.tgz`，可供本地安装，无需提前发布 npm。独立源码目录中请安装 TypeScript、Vitest、`@types/node` 开发依赖，或直接使用根 workspace。

检查 LICENSE、README、dist 和版本号，禁止把 `.env` 或状态带进包。npm 正式发布要求交互式 2FA 或具有相应发布权限的凭据；后续自动发布可配置 npm trusted publishing，不要把 npm token 放进脚本。
