import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'

import { configureRuleApi, requestRulePlan } from '@/services/cmds'
import {
  readApiSettings,
  saveApiSettings,
  clearApiSettings,
  type ApiSettings,
} from '@/services/rule-api-settings'
import { apiPlan, modelRequest } from '@/utils/api-rule-plan'

export function RuleApiSettings({
  initial,
  onSaved,
  onClose,
}: {
  initial: ApiSettings
  onSaved: (value: ApiSettings) => void
  onClose: () => void
}) {
  const [cfg, setCfg] = useState(initial)
  const [key, setKey] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const change = (field: keyof ApiSettings, value: string) => {
    setCfg({ ...cfg, [field]: value })
    setStatus('')
  }
  async function save(test: boolean) {
    setBusy(true)
    setStatus('')
    try {
      const saved = {
        ...cfg,
        address: cfg.address.trim(),
        model: cfg.model.trim(),
      }
      if (!saved.model || !saved.address)
        throw Error('请填写 API 地址和模型 ID。')
      await configureRuleApi(saved.address, key || null)
      saveApiSettings(saved)
      setKey('')
      onSaved(saved)
      if (!test) {
        onClose()
        return
      }
      const sample = 'example.com 直连'
      apiPlan(
        await requestRulePlan(
          saved.address,
          saved.model,
          saved.prompt,
          modelRequest(sample, {}),
        ),
        sample,
        {},
        null,
        [],
      )
      setStatus('测试通过，模型已正确解析 example.com 的直连规则。')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  async function clearKey() {
    setBusy(true)
    try {
      await configureRuleApi(initial.address, '')
      clearApiSettings()
      const blank = readApiSettings()
      setCfg(blank)
      onSaved(blank)
      setKey('')
      setStatus('已清除当前配置及其密钥。')
    } catch (e) {
      setStatus(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>模型 API 设置</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '12px !important' }}>
        <TextField
          label="API 地址"
          value={cfg.address}
          onChange={(e) => change('address', e.target.value)}
          disabled={busy}
          placeholder="https://api.example.com/v1"
          helperText="支持 Chat Completions 兼容接口，可填基础地址或完整的 /chat/completions 地址。"
        />
        <TextField
          label="模型 ID"
          value={cfg.model}
          onChange={(e) => change('model', e.target.value)}
          disabled={busy}
        />
        <TextField
          label="API Key"
          type="password"
          autoComplete="new-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          disabled={busy}
          helperText="Windows 使用凭据管理器按接口保存。留空沿用已存密钥，也可使用免密接口。"
        />
        <TextField
          label="前置提示词"
          multiline
          minRows={3}
          value={cfg.prompt}
          onChange={(e) => change('prompt', e.target.value)}
          disabled={busy}
        />
        <Typography variant="caption">
          模型会收到你的指令和相关目标名称。应用路径、订阅内容和连接记录在本机处理。
        </Typography>
        {status && <Typography role="status">{status}</Typography>}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}>
        <Button disabled={busy || !initial.address} onClick={clearKey}>
          清除已保存配置
        </Button>
        <Button disabled={busy} onClick={onClose}>
          关闭
        </Button>
        <Button disabled={busy} onClick={() => save(true)}>
          保存并测试
        </Button>
        <Button variant="contained" disabled={busy} onClick={() => save(false)}>
          保存设置
        </Button>
      </DialogActions>
    </Dialog>
  )
}
