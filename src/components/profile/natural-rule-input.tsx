import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'

import type { AppEvidence, WebsiteResult } from '@/services/bindings'
import {
  claudeCliEndpoint,
  requestRulePlan,
  ruleApplicationFolders,
  ruleAppEvidence,
  publicAppAliases,
  searchRuleWebsite,
} from '@/services/cmds'
import { readApiSettings } from '@/services/rule-api-settings'
import { readRuleEvidence, type Evidence } from '@/services/rule-evidence'
import { apiPlan, modelRequest } from '@/utils/api-rule-plan'
import { appHints, matchLocalApps } from '@/utils/local-app-matching'
import { openExternalUrl } from '@/utils/open-external-url'
import { resolvePlan, type RequestPlan } from '@/utils/routing-coverage'
import { discoverWebsites } from '@/utils/website-discovery'

import { RuleApiSettings } from './rule-api-settings'

export function NaturalRuleInput({
  groups,
  add,
}: {
  groups: string[]
  add: (rules: string[]) => void
}) {
  const [settings, setSettings] = useState(readApiSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [text, setText] = useState('')
  const [selection, setSelection] = useState('')
  const [online, setOnline] = useState(false)
  const [status, setStatus] = useState('')
  const [sources, setSources] = useState<WebsiteResult[]>([])
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<{
    plan: RequestPlan
    evidence: Evidence[]
  } | null>(null)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [choice, setChoice] = useState<{
    name: string
    items: AppEvidence[]
    select: (item?: AppEvidence) => void
  } | null>(null)
  const jobRef = useRef<AbortController | null>(null)
  const group = groups.includes(selection) ? selection : (groups[0] ?? '')
  useEffect(() => () => jobRef.current?.abort(), [])
  function reset() {
    setSources([])
    setReview(null)
    setSelected({})
    setStatus('')
  }

  async function generate(refresh = false) {
    if (!text.trim() || jobRef.current) return
    const ctrl = new AbortController()
    jobRef.current = ctrl
    setBusy(true)
    setStatus('')
    const timer = window.setTimeout(() => ctrl.abort(), 90000)
    try {
      const judge = (request: string) =>
        requestRulePlan(
          settings.address,
          settings.model,
          settings.prompt,
          request,
        )
      let plan = review?.plan
      if (!plan) {
        if (!settings.address || !settings.model) {
          setSettingsOpen(true)
          return
        }
        let inventoryNote = ''
        const [apps, inventory] = await Promise.all([
          ruleApplicationFolders(),
          ruleAppEvidence().catch(() => {
            inventoryNote =
              '此次未能读取快捷方式和运行进程，已使用安装记录核对。'
            return []
          }),
        ])
        const hints = appHints(text, inventory)
        ctrl.signal.throwIfAborted()
        const reply = await requestRulePlan(
          settings.address,
          settings.model,
          settings.prompt,
          modelRequest(text, apps, undefined, hints),
        )
        ctrl.signal.throwIfAborted()
        const local = await matchLocalApps(
          reply,
          text,
          apps,
          inventory,
          publicAppAliases,
          (name, items) =>
            new Promise((resolve, reject) => {
              ctrl.signal.throwIfAborted()
              clearTimeout(timer)
              function cancel() {
                select()
              }
              function select(app?: AppEvidence) {
                ctrl.signal.removeEventListener('abort', cancel)
                setChoice(null)
                if (app) resolve(app)
                else reject(Error('已取消本次应用选择。'))
              }
              ctrl.signal.addEventListener('abort', cancel, { once: true })
              setChoice({ name, items, select })
            }),
        )
        ctrl.signal.throwIfAborted()
        plan = apiPlan(
          local.raw,
          text,
          local.apps,
          /claude\s*code/i.test(reply) ? await claudeCliEndpoint() : null,
          groups,
          undefined,
          local.scopes,
        )
        plan.notes.push(...local.notes)
        if (inventoryNote) plan.notes.push(inventoryNote)
        plan = await discoverWebsites(
          plan,
          searchRuleWebsite,
          ctrl.signal,
          judge,
        )
      } else if (refresh) {
        plan = await discoverWebsites(
          plan,
          searchRuleWebsite,
          ctrl.signal,
          judge,
        )
      }
      setSources(plan.websites ?? [])
      const services = [
        ...new Set(
          plan.jobs.flatMap((j) =>
            j.service && (online || j.reviewResources) ? [j.service] : [],
          ),
        ),
      ]
      let selections = review ? selected : null
      if (services.length && (!review || refresh)) {
        const evidence = await Promise.all(
          services.map((service) => readRuleEvidence(plan, service)),
        )
        ctrl.signal.throwIfAborted()
        if (evidence.some((e) => e.hosts.some((h) => !h.included))) {
          setReview({ plan, evidence })
          setSelected((old) =>
            Object.fromEntries(
              evidence.map((e) => [
                e.service,
                (old[e.service] ?? []).filter((c) =>
                  e.hosts.some((h) => h.condition === c && !h.included),
                ),
              ]),
            ),
          )
          return
        }
        selections = Object.fromEntries(evidence.map((e) => [e.service, []]))
        plan.notes.push('已核对来源，列出的域名已由基础规则覆盖。')
      }
      const rules = await resolvePlan(plan, group, selections, ctrl.signal)
      ctrl.signal.throwIfAborted()
      add(rules)
      setReview(null)
      setSelected({})
      setStatus(
        [
          ...plan.notes,
          '已生成 ' + rules.length + ' 条前置规则，请核对右侧列表后保存。',
        ].join(' '),
      )
    } catch (error) {
      if (refresh) {
        setReview(null)
        setSelected({})
      }
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(timer)
      jobRef.current = null
      setBusy(false)
    }
  }
  return (
    <Box sx={{ display: 'grid', gap: 1, mb: 2 }}>
      <Button
        size="small"
        disabled={busy}
        onClick={() => setSettingsOpen(true)}
      >
        模型 API 设置
      </Button>
      {settingsOpen && (
        <RuleApiSettings
          initial={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(value) => {
            setSettings(value)
            reset()
          }}
        />
      )}
      <TextField
        label="用自然语言添加规则"
        value={text}
        disabled={busy}
        multiline
        minRows={2}
        size="small"
        slotProps={{ htmlInput: { maxLength: 1200 } }}
        placeholder="只让 Edge 中的 Gemini 走代理，其他应用访问它时直连"
        onChange={(e) => {
          setText(e.target.value)
          reset()
        }}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={online}
            disabled={busy}
            onChange={(e) => {
              setOnline(e.target.checked)
              reset()
            }}
          />
        }
        label="核对附加资源域名"
      />
      {choice && (
        <Box>
          <Typography variant="body2">
            本机找到多个与「{choice.name}」相符的程序，请选择：
          </Typography>
          {choice.items.map((app) => (
            <Button key={app.path} onClick={() => choice.select(app)}>
              {app.path}
            </Button>
          ))}
          <Button onClick={() => choice.select()}>取消选择</Button>
        </Box>
      )}
      {sources.map((s) => (
        <Box key={s.name}>
          <Typography variant="body2">
            {s.name} 网页入口：{s.hosts.join('、')}
          </Typography>
          <Button
            size="small"
            onClick={() =>
              void openExternalUrl(s.source).catch((e) => setStatus(String(e)))
            }
          >
            查看网站来源
          </Button>
          {s.source !== s.website && (
            <Button
              size="small"
              onClick={() =>
                void openExternalUrl(s.website).catch((e) =>
                  setStatus(String(e)),
                )
              }
            >
              打开官网入口
            </Button>
          )}
          {s.optional.length > 0 && (
            <Typography variant="caption">
              共享资源 {s.optional.join('、')} 可在「核对附加资源域名」中选择。
            </Typography>
          )}
        </Box>
      ))}
      {review && (
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          {review.evidence.map((evidence) => (
            <Box key={evidence.service}>
              <Typography variant="body2">
                {evidence.fallback ?? evidence.origin} {evidence.source}
                。基础规则会保留。勾选要补充的域名，共享登录或 CDN
                域名也可能被其他服务使用。
              </Typography>
              <Typography variant="caption">
                {evidence.snapshot
                  ? '列出查询时本机匹配的活跃连接。未观察到的功能仍需实际访问验证。'
                  : '本次未能读取活跃连接，仅展示官方来源。'}
              </Typography>
              <Box sx={{ maxHeight: 160, overflowY: 'auto' }}>
                {evidence.hosts.map((h) => (
                  <Box key={h.host}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          disabled={busy || h.included}
                          checked={
                            h.included ||
                            (selected[evidence.service] ?? []).includes(
                              h.condition,
                            )
                          }
                          onChange={(e) =>
                            setSelected((old) => ({
                              ...old,
                              [evidence.service]: e.target.checked
                                ? [
                                    ...(old[evidence.service] ?? []),
                                    h.condition,
                                  ]
                                : (old[evidence.service] ?? []).filter(
                                    (c) => c !== h.condition,
                                  ),
                            }))
                          }
                        />
                      }
                      label={h.host + (h.included ? '（基础规则已覆盖）' : '')}
                    />
                    <Typography variant="caption" component="div">
                      {h.observed.length
                        ? h.observed.join('；')
                        : evidence.snapshot
                          ? '未观察到活跃连接'
                          : '连接状态未知'}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
          <Button size="small" disabled={busy} onClick={() => generate(true)}>
            刷新来源和连接
          </Button>
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          select
          size="small"
          label="代理组"
          value={group}
          disabled={busy || !groups.length}
          sx={{ flex: 1 }}
          onChange={(e) => setSelection(e.target.value)}
        >
          {groups.map((name) => (
            <MenuItem key={name} value={name}>
              {name}
            </MenuItem>
          ))}
        </TextField>
        <Button
          disabled={busy || !text.trim()}
          onClick={() => generate()}
          variant="outlined"
        >
          {busy
            ? '正在核对…'
            : review
              ? review.evidence.some((e) => e.fallback)
                ? '采用快照所选资源并生成'
                : '采用所选资源并生成'
              : '生成前置规则'}
        </Button>
      </Box>
      {status && (
        <Typography role="status" variant="body2">
          {status}
        </Typography>
      )}
    </Box>
  )
}
