# 项目维护约定

- 每次修改扩展并交付时，按 Asia/Shanghai 当前时间更新 `manifest.json`：`version_name` 使用 `YYYYMMDDHHmm`（年月日时分，例如 `202610290907`），供扩展管理页显示；`version` 使用 Chrome 合法格式 `年.月.日.时分整数`（例如 `2026.10.29.907`），各段不补零。不要再用当日修订号。
- 打包时保证源码、CRX、ZIP 内的版本一致。沿用 `release/` 产出目录及固定文件名 `xhs-chrome-extension.crx`、`xhs-chrome-extension.zip`。
- 重新打包沿用 `release/xhs-chrome-extension.pem` 签名密钥，不重新生成、不提交或分发私钥。
- Git 提交信息默认使用中文。
