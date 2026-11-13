## Background

DetailX users need an AI SDK entry point for enhancing owned videos with super-resolution and optional frame interpolation. The independently maintained provider implements the experimental AI SDK 7 V4 video interface.

## Summary

Adds the DetailX community-provider page with installation, server-side key configuration, enhancement and asynchronous start/status examples, durable request recovery, source preparation and billing limits. The page explicitly describes this as video enhancement and does not claim language-model, text-to-video or image-to-video support.

- Provider: https://www.npmjs.com/package/@detailx/ai-sdk-provider
- Node.js client: https://www.npmjs.com/package/@detailx/sdk
- Source: https://github.com/wl-AILab/detailx-ai-sdk
- Real-service acceptance: https://github.com/wl-AILab/detailx-ai-sdk/blob/main/ai-sdk-provider/VERIFICATION.md

Validation: the docs PropertiesTable validator passes across 561 MDX files; the nine docs content-transform tests pass; the new MDX compiles and passes the repository formatter. The source-to-site transform includes `detailx` in the community navigation. Provider and client build/type checks and eight tests pass.

Real-service acceptance used an owned two-second video, uploaded through the Node client, started through AI SDK, then recovered in a new process using independently installed package tarballs. Decoded output was 1280 x 720, 24 fps, 48 frames with audio; one billing transaction settled at 2 credits.

Both `0.1.0` packages are publicly available on npm. A fresh registry installation matches the verified tarball integrity values, imports the main and optional PostgreSQL exports, and successfully recovers and downloads the same real-service task without a second billing transaction.

This is a docs-only contribution with no AI SDK runtime or package changes, so no changeset is included.

## Checklist

- [x] All commits are signed (PRs with unsigned commits cannot be merged)
- [ ] Tests have been added / updated (for bug fixes / features)
- [x] Documentation has been added / updated (for bug fixes / features)
- [ ] A _patch_ changeset for relevant packages has been added (for bug fixes / features - run `pnpm changeset` in the project root)
- [x] I have reviewed this pull request (self-review)
