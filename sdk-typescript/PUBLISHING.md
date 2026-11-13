# npm SDK 发布

候选包名 `@detailx/sdk`。需要拥有 npm `detailx` scope；若采用其他 scope，同步修改本包、Provider 的依赖和 import，并重新编译测试。包名可用性和组织归属需登录 npm 确认。

```bash
npm install
npm run build
npm test
npm pack --dry-run
npm publish --access public
```

先发布本 SDK，再发布 AI SDK Provider。根目录 `artifacts` 也会提供 `.tgz`，可供本地安装，无需提前发布 npm。独立源码目录中请安装 TypeScript、Vitest、`@types/node` 开发依赖，或直接使用根 workspace。

检查 LICENSE、README、dist 和版本号，禁止把 `.env` 或状态带进包。生产发布推荐 npm trusted publishing；不要把 npm token 放进脚本。本次交付只做本地构建和打包。
