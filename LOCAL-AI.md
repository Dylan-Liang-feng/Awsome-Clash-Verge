# Clash Verge AI 使用与构建

基于 Clash Verge Rev 2.5.10，适用于 Windows x64。

## Windows 整机接管

日常使用版通过 `ai-desktop` 构建，使用原版 Windows 服务通道、原版配置目录和当前用户的已有订阅。退出原版客户端后启动本版，在「代理」选择「规则」，在首页开启「虚拟网卡模式」。普通应用发起的连接可在「连接」页查看命中规则。需要恢复原版时，从托盘退出本版，再启动原来的 Clash Verge。两者共用日常设置。

下方构建命令中将 `--features local-ai` 改为 `--features ai-desktop`，并给打包脚本加上 `-ServiceMode`，即可构建整机版。便携测试版使用独立配置和端口，适合同时运行作比较。

## 便携测试版使用

双击便携目录里的 `clash-verge.exe`。进入「订阅」，右键 **Local AI Demo**，选择「编辑规则」。在自然语言输入框里描述想分流的应用或网站，选好代理组，点「生成前置规则」。在右侧核对目标和策略后点「保存」。点「取消」会放弃这次编辑。

可以直接试这些说法：

- 让无畏契约和 WeGame 直连，Gemini 网页走代理
- 以后打开 Gemini 时通过我的代理节点访问
- example.com 直连，Game.exe 走节点

输入日常称呼即可，例如「让我电脑中微信和QQ都走直连」。客户端读取 Windows 安装记录、桌面和开始菜单快捷方式、进程及文件产品名；模型可建议英文名或旧称，再和本机文件核对。缺少本机线索时按公开软件名查 Wikidata 别名，并再次匹配。若多个安装版本都符合条件，可在候选中点选。程序目录外的辅助进程仅在有同厂商、父子进程和文件证据时纳入。输入具体域名时匹配该主机；输入内置的网站名称时会在列表中展示对应的一个或多个域名。代理目标使用界面选中的代理组。

在「编辑规则 → 模型 API 设置」填写兼容 Chat Completions 的接口地址、模型 ID 和 API Key，并编辑前置提示词。基础地址会补上 `/chat/completions`，也可以直接填完整地址。点「保存并测试」会向所选服务发送一个简单的规则请求。Windows 按接口把密钥保存在当前用户的凭据管理器里，地址、模型名和提示词保存在客户端。其他系统的密钥仅在当前进程内保存。

每次生成会将整句需求和相关目标名称发送给你配置的模型，客户端核对返回的结构化任务，再把规则加入预览。接口地址、模型和提示词可随时更换。点击「保存」前请核对预览的目标、出站方向和匹配范围。

## 模型如何判断范围

模型 API 先把整句需求解析为目标、线路和匹配范围。对尚未核实的机构或服务名，客户端按实体名查官网（研究机构可查询 ROR，其他网站查询 Wikidata），再把入口主机、来源链接以及可选后缀交回同一个模型复核。一次生成涉及多个网站时，域名范围复核合并为一次 API 请求。普通明确地址只需第一轮。自定义前置提示词会随两轮请求发送。

模型选择精确主机或官网及其子域名，客户端检查是否能从证据编译出该规则。只会从官网主机移除 `www.` 别名，不会从产品子域名逐级上推。公共后缀（包含私有托管后缀）和已知的共享平台根域不能作为机构专属后缀。资源核对按服务分别进行，只有额外域名需要选择时才打开选择器。域名以外的独立站点不能仅因品牌相关而自动纳入。

## 按网站名联网补全

在「规则编辑器」输入「让我的QQ邮箱网页端走直连」并点「生成前置规则」。客户端用公开产品名检索 Wikidata 的官方网站字段；对 QQ 邮箱还会读取腾讯登录页，确认页面引用的邮箱专用主机。模型根据需求选择出站方式，客户端仅用检索核实的精确域名生成预览。点「保存」后生效。来源可在预览中打开。需要共享资源时勾选「核对附加资源域名」，按需选择。

其他公开网站也可按名查询。如果目录没有同名条目、存在歧义或只登记了共享网站的某一路径，需要提供具体网页域名。查询不需要额外的搜索 API Key；Wikidata 接收产品名。

## Windows 浏览器按网站绕过虚拟网卡

系统代理使用 PAC，主窗口使用规则模式并开启 TUN。在 PAC 脚本首行写入 `/* Local AI browser physical egress */` 可启用按规则生成的 PAC；下方可以保留 `function FindProxyForURL(){return "DIRECT";}` 作为普通客户端的默认行为。输入「访问某大学官网及子域名时完全绕过 TUN」可生成针对本机 HTTP 入口的规则。保存后，系统 PAC 把这些网页交给回环端口并由物理网卡发送，其他网页按系统路由进入 TUN。仅适用于采用系统 PAC 的浏览器连接。专用模式会替换原 PAC 的选路逻辑。

客户端在生成配置时读取当前有默认路由的物理网卡和 DNS。切换有线或无线网络后重新激活订阅即可重新选择。Windows 或浏览器有本机代理覆盖、已存在连接或旧 PAC 缓存时，应使用普通窗口重新连接；需要时完全退出并重开浏览器。恢复原网络方式可关闭系统代理并保留 TUN。

## 核对规则范围

- 输入「example.com 及其所有子域名都直连」生成 `DOMAIN-SUFFIX`。只输入主机名时精确匹配。
- 输入「只让 Edge 中的 example.com 走代理，其他应用访问它时直连」生成进程和域名的组合规则，以及同一域名的直连后备规则。
- 「Claude Code 走代理」读取本机启动器和用户级模型接口。npm 安装只能区分 Node 进程和接口域名；独占 CLI、未知运行时或无法表达的复杂条件会提示重写。
- 勾选「核对附加资源域名」，或输入「Gemini 和它的相关资源走代理」。客户端实时读取 Gemini 的公开首页、Claude 的桌面联网文档或 OpenAI 的 ChatGPT 网络清单，并显示查询时命中的活跃连接。附加域名由你勾选，随后核对前置规则并保存。ChatGPT 官网读取失败时会标明快照的核实日期，可单独选择采用；其他来源失败时不会添加本次规则。页面引用和活跃连接只反映已知或已访问的功能。

## 测试订阅

测试版把配置保存在可执行文件旁边的 `profile/`。内置示例监听 `127.0.0.1:17897`，默认关闭 TUN 和系统代理。**Test Proxy** 将请求转给 `127.0.0.1:7897` 上的现有代理。启动原版 Clash 后，即可用这个示例测试。需要独立节点时，在测试版导入自己的订阅。两套客户端共用一台机器，只在打算接管电脑流量的那一套上开启系统代理或 TUN。

## 构建 Windows 日常版

发行版以 `ai-desktop` 启用原版服务和日常配置。请先在 x64 的 Visual Studio Developer PowerShell 中准备 Rust MSVC、Windows SDK、CMake、Ninja，以及 `.tool-versions` 中的 Node 与 pnpm。从仓库根目录运行：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm run prebuild x86_64-pc-windows-msvc
corepack pnpm exec vitest run
corepack pnpm run web:build
$env:TAURI_CONFIG = Get-Content -Raw src-tauri/tauri.local.json
$env:CARGO_PROFILE_FAST_RELEASE_DEBUG = '0'
$env:CARGO_PROFILE_FAST_RELEASE_STRIP = 'symbols'
$env:CARGO_PROFILE_FAST_RELEASE_OPT_LEVEL = '1'
cargo build --profile fast-release --locked --features ai-desktop --bin clash-verge
```

生成的程序是 `target/fast-release/clash-verge.exe`。在新目录放入这个文件，以及 `scripts/` 下的 `Start-Clash-Verge-AI.cmd`、`prepare-windows.ps1` 和 `upstream-files.json`，即可用启动脚本准备与发行版一致的运行组件。公开包另附使用说明、隐私说明和许可证。

## 构建独立配置的测试版

准备仓库指定版本的 Node、pnpm 和 Rust，以及 Visual C++ x64 构建工具和 Windows SDK。在仓库根目录执行：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm run prebuild
corepack pnpm exec vitest run src/utils/natural-rules.test.ts
corepack pnpm run web:build
$env:TAURI_CONFIG = Get-Content -Raw src-tauri/tauri.local.json
cargo build --locked --features local-ai --bin clash-verge
```

打包时指定编译好的程序和输出目录：

```powershell
./scripts/package-local-ai.ps1 -Binary ./target/debug/clash-verge.exe -Destination C:/build/ClashVergeLocalAI
```

源码和打包产物各有独立目录。上传源码时，保管好便携目录中的 `profile/`；导入真实订阅后，里面可能有订阅链接及节点凭据。
