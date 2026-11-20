# Clash Verge AI

Windows x64 桌面代理客户端，基于 Clash Verge Rev 2.5.10 和 Mihomo。你可以在规则编辑器里写「让 QQ 邮箱网页直连，Gemini 走代理」，核对客户端找到的域名、应用和出站策略，再保存到订阅。模型通过你配置的 API 调用。

[下载 Windows 版](https://github.com/Dylan-Liang-feng/clash-verge-ai/releases/latest) · [使用与源码构建](LOCAL-AI.md) · [开发过程与测试](docs/development-journey.md) · [数据与隐私](PRIVACY.md)

## 第一次启动

1. 从 Release 下载 Windows x64 ZIP，解压到一个可以长期保留、当前用户有写入权限的目录。压缩包内含编译好的 `clash-verge.exe`。
2. 从托盘退出正在运行的 Clash Verge。日常版与原版共用配置和 Windows 系统服务，两者轮流运行。需要保留现状时，可先使用客户端的配置备份功能。
3. 双击 `Start-Clash-Verge-AI.cmd`。脚本优先从已安装的官方 2.5.10 校验并复制十个运行组件。如果安装在自定义目录，可在解压目录执行 `.\prepare-windows.ps1 -UpstreamDirectory 'D:\Apps\Clash Verge'`。如果没有可用组件，安装 [7-Zip](https://www.7-zip.org/) 后再次运行启动脚本，它会下载固定版本的官方安装包、校验 SHA-256 并解压所需文件。系统需要 WebView2 Runtime。
4. 已有订阅的用户可以直接选择订阅。首次使用者请导入自己的订阅。需要整机接管时选择「规则」模式并开启「虚拟网卡模式」，按客户端提示安装服务。
5. 在「订阅」右键目标订阅，选择「编辑规则 → 模型 API 设置」，填写兼容 Chat Completions 的 API 地址、模型 ID 和自己的密钥，点「保存并测试」。回到编辑器，填写需求、选择代理组，点「生成前置规则」。核对右侧预览后点「保存」。

第一次准备完运行组件，以后可以直接启动 `clash-verge.exe`。切回原版时先从托盘退出本版；已保存的日常订阅规则会保留。Release 同时提供 SHA256SUMS.txt，下载后用 PowerShell 的 `Get-FileHash` 核对 ZIP。

## 规则示例

| 输入 | 预览时关注 |
| --- | --- |
| 让我的 QQ 邮箱网页直连 | 只给邮件服务入口加规则，检查有没有误选整个共享父域 |
| 让电脑上的微信走直连 | 检查匹配到的本机程序。如果有多个安装版本，可以选择目标 |
| 某大学官网和它的子域名走代理 | 核对官网来源、匹配后缀和所选代理组 |
| 只让浏览器访问某网站时完全绕过 TUN | 需要按使用指南启用专用系统 PAC，并使用遵循它的浏览器 |

普通 `DIRECT` 规则改变 Mihomo 的出站。已被 TUN 捕获的连接仍会出现在连接页。指定网页通过物理网卡出站另有 Windows 浏览器 PAC 模式，其适用条件见[操作说明](LOCAL-AI.md)。

## 来源与许可证

这是基于上游的独立修改版，保留原项目的 GPLv3 许可证和版权声明。源代码、上游基线与随运行环境取得的第三方组件见[来源说明](THIRD_PARTY.md)和[许可证](LICENSE)。
