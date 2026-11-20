**Clash Verge AI 的发行记录见[版本说明与修改记录](docs/release-notes.md)。** 下文保留上游 Clash Verge Rev 的更新日志。

<!-- Release-notes skeleton. Entries accumulate in ./Changelog.md as PRs land;
     before publishing a release, distill them:
     - user-visible changes only — no dev tooling, CI fixes, or refactors whose
       effect is already covered by another entry
     - describe outcomes, not internals: no internal module names, IPC or
       protocol details, or implementation mechanics — write what the user
       observes, not how the code achieves it
     - one line per theme: merge entries that share a root cause
     - each entry fits a single readable line (about 60 CJK characters); if it
       overflows, it is packing multiple themes or detail that belongs in the
       linked issue/PR — split it or drop the detail
     - line grammar: open with a verb (修复/新增/优化), with the platform
       first (Windows/macOS/Linux) when the change is platform-specific;
       merge sub-symptoms as 主题：症状、症状; full-width punctuation,
       「」 for UI labels, backticks for config keys and commands
     - platform entries sit under their platform heading (bold, emoji
       prefixed, ordered Windows/macOS/Linux, combined for pairs like
       macOS/Linux) at the end of their section;
       scripts-workflow/group_platforms.sh regroups, --check verifies
     HTML comments are stripped by the update dialog's sanitizer and hidden on
     GitHub, so they never reach users. -->
## 本地测试版

- 支持在 Windows 使用浏览器 PAC 让指定网站经物理网卡直连，其他流量继续由 TUN 接管

- 由模型依据官网查询结果确定网页分流范围，支持机构子域与多服务资源分别核对

- 支持用软件俗称匹配本机快捷方式、可执行文件及关联辅助进程，缺少线索时查询公开别名

- 支持按公共网站名称联网查找官网，并将核实的网页域名加入分流预览

- 支持配置模型 API、模型 ID 和前置提示词，一次请求解析多条规则意图

- 核对自然语言分流的应用和域名范围，支持按需查询官方资源及比对活跃连接

- 新增 Windows 服务模式构建，支持用本地 AI 客户端接管 TUN 流量

- 新增自然语言规则输入，支持按应用和网站生成直连或代理规则

## v2.5.10

<details>
<summary><strong> 🐞 修复问题 </strong></summary>

- 修复全局模式缺少 `GLOBAL` 策略组，无法单独选择全局出口
- 修复服务模式下，SSH 节点的 `private-key` 使用私钥文件时内核无法启动
- 修复服务模式下，内核更新的 GEO 数据库不会同步回应用目录，导致使用新分类的规则无法通过校验
- 修复订阅的 DNS 配置变化后，「DNS 覆写」实际已关闭但开关仍显示开启且没有提示

**🖥️ Windows**

- Windows：修复安装程序重新安装或覆盖时未提示退出运行中应用，导致卸载报错或覆盖失败

</details>

<details>
<summary><strong> ✨ 新增功能 </strong></summary>


</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>


</details>
