# Windows 离线测试版 v0.1.1 的组件

Clash Verge AI 基于 [Clash Verge Rev 2.5.10](https://github.com/clash-verge-rev/clash-verge-rev/tree/c83f7ad529c7c9cb3d2d54a0955ef8c1b22a411b)，修改版源代码和上游版权声明按随附 GPLv3 许可提供。完整的对应源代码可从本项目 v0.1.1 标签取得。锁定的桌面应用依赖见 Cargo.lock 与 pnpm-lock.yaml。

| 随包文件 | 来源和许可 |
| --- | --- |
| 两个 Mihomo x64 内核 | [稳定版 v1.19.33](https://github.com/MetaCubeX/mihomo/tree/v1.19.33) 和 [alpha 69c1631](https://github.com/MetaCubeX/mihomo/tree/69c16319b12d10ec1ed05eefca3a482357f5ffbb)，GPLv3。文件取自 [Clash Verge Rev 官方 v2.5.10 安装包](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/v2.5.10) |
| Windows 服务及安装、卸载工具 | [clash-verge-service-ipc v2.7.7](https://github.com/clash-verge-rev/clash-verge-service-ipc/tree/v2.7.7)，GPLv3，来自同一个官方安装包 |
| Country.mmdb 和 ASN.mmdb | 2026 年 11 月版 [IP Geolocation by DB-IP](https://db-ip.com/)，分别来自 DB-IP Country Lite 和 ASN Lite。按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 分发，解压并重命名 |
| geoip.dat | [v2fly/geoip 202611080027](https://github.com/v2fly/geoip/releases/tag/202611080027)，使用 DB-IP Lite 国家数据，产物按 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 分发 |
| geosite.dat | [v2fly/domain-list-community 20261120151928](https://github.com/v2fly/domain-list-community/releases/tag/20261120151928) 的 dlc.dat，仅重命名，MIT。版权和许可在 docs/offline-licenses/domain-list-MIT.txt |
| WebView2 | 微软签名的 [Evergreen Standalone Installer x64](https://developer.microsoft.com/microsoft-edge/webview2/)，按 Microsoft Edge WebView2 Runtime 分发条款原样嵌入。用户可在[微软分发文档](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)查阅安装与更新方式 |

v0.1.1 使用上述公开规则库作为新安装的初始数据。特定发行方扩展的 GEOIP 或 GEOSITE 类别需核对订阅所需的数据源。UI 中的地理数据更新及用户选择的订阅另行按其配置获取。安装器只写入程序目录、两个 AI 版快捷方式及专属卸载项。共享的系统服务由客户端设置管理。
