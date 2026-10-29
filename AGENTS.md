# 项目维护约定

- 每次修改扩展并交付时，按 Asia/Shanghai 当前时间更新 `manifest.json`：`version_name` 使用 `YYYYMMDDHHmm`（年月日时分，例如 `202610290907`），供扩展管理页显示；`version` 使用 Chrome 合法格式 `年.月.日.时分整数`（例如 `2026.10.29.907`），各段不补零。不要再用当日修订号。
- 打包时保证源码、CRX、ZIP 内的版本一致。沿用 `release/` 产出目录及固定文件名 `xhs-chrome-extension.crx`、`xhs-chrome-extension.zip`。
- 重新打包沿用 `release/xhs-chrome-extension.pem` 签名密钥，不重新生成、不提交或分发私钥。
- Git 提交信息默认使用中文。

- 每次生成或更新 CRX 安装包后，必须完成对应代码和文档的 Git 提交、推送，并将 CRX 上传至该版本的 GitHub Release（标签 `v<version_name>`，指向对应提交）。用户已授权此常规流程，无需每次再次询问。不能只更新本地 `release/` 就宣告交付完成。
- 发布前验证测试、包内版本和源码一致性；发布后核对远端提交及 Release 附件。CRX 通过 GitHub Release 分发，不把 `release/` 产物或 `.pem` 私钥提交到 Git。
