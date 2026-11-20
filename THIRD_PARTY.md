# 上游与运行组件

本项目基于 [Clash Verge Rev v2.5.10](https://github.com/clash-verge-rev/clash-verge-rev/tree/c83f7ad529c7c9cb3d2d54a0955ef8c1b22a411b)。保留上游 GPLv3 许可证和源文件版权声明。公开快照加入了 AI 规则编辑、联网核对、本机应用匹配及 Windows 浏览器物理出口选项。前端和 Rust 依赖版本见 pnpm-lock.yaml 和 Cargo.lock。

Windows ZIP 内包含本项目构建的客户端。启动时从用户已有的官方安装目录或[上游固定版本安装包](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/v2.5.10)取得下列运行文件，各组件沿用其原作者的许可。

| 组件 | 用途和出处 |
| --- | --- |
| verge-mihomo、verge-mihomo-alpha | [Mihomo](https://github.com/MetaCubeX/mihomo)，负责规则处理、代理和 TUN |
| clash-verge-service、install、uninstall | [上游 Windows 服务](https://github.com/clash-verge-rev/clash-verge-service-ipc)，负责服务安装与管理 |
| ASN.mmdb、Country.mmdb、geoip.dat、geosite.dat | 上游随客户端提供的地址及域名数据，构建时的资源来源见 [prebuild.mjs](scripts/prebuild.mjs) |
| enableLoopback.exe | 上游随附的 Windows UWP 回环辅助工具 |

用于获取组件的官方安装包 SHA-256 为 `929DA9303B643B80CE309AB29F618E37A5562F515D1FA55EBF5B86C822504450`。十个文件的路径和 SHA-256 在 [upstream-files.json](scripts/upstream-files.json) 中。准备脚本不会执行下载的安装包。Windows 桌面运行环境使用 Microsoft Edge WebView2。
