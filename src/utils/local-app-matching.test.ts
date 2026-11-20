import { describe, expect, it } from 'vitest'

import { apiPlan, modelRequest } from './api-rule-plan'
import { appHints, matchLocalApps } from './local-app-matching'
import { resolvePlan } from './routing-coverage'

const input = '让我电脑中微信和QQ都走直连'
const apps = { QQ: 'D:\\TestApps\\QQ' }
const weixin = {
  path: 'D:\\TestApps\\Weixin\\Weixin\\Weixin.exe',
  names: ['微信', 'Weixin'],
  helpers: ['C:\\Tools\\xwechat\\WeChatAppEx.exe'],
}
const qq = { path: 'D:\\TestApps\\QQ\\QQ.exe', names: ['QQ'], helpers: [] }
const inventory = [weixin, qq]
const stop = async () => {
  throw Error('unexpected lookup or choice')
}
const encode = (...rules: object[]) => JSON.stringify({ rules })
describe('local app identities', () => {
  it('grounds the original Chinese instruction even when the model uses alternate executable names', async () => {
    const wire = modelRequest(
      input,
      apps,
      undefined,
      appHints(input, inventory),
    )
    expect(JSON.parse(wire).localApps).toEqual([
      { name: '微信', program: 'Weixin.exe' },
      { name: 'QQ', program: 'QQ.exe' },
    ])
    expect(wire).not.toContain('D:')
    const raw = encode(
      { target: 'WeChat.exe', route: 'direct', quote: input },
      {
        target: 'QQ.exe',
        app: 'QQ',
        appNames: ['QQNT'],
        route: 'direct',
        quote: input,
      },
    )
    const local = await matchLocalApps(raw, input, apps, inventory, stop, stop)
    const plan = apiPlan(local.raw, input, local.apps, null, [])
    expect(
      await resolvePlan(plan, '', null, new AbortController().signal),
    ).toEqual([
      'PROCESS-PATH-REGEX,(?i)^D:\\\\TestApps\\\\Weixin\\\\Weixin\\\\,DIRECT',
      'PROCESS-PATH,C:\\Tools\\xwechat\\WeChatAppEx.exe,DIRECT',
      'PROCESS-PATH-REGEX,(?i)^D:\\\\TestApps\\\\QQ\\\\,DIRECT',
    ])
  })
  it('does not silently drop WeChat when the model returns just QQ', async () => {
    const p = await matchLocalApps(
      encode({ target: 'QQ', quote: input, route: 'direct' }),
      input,
      apps,
      inventory,
      stop,
      stop,
    )
    expect(() => apiPlan(p.raw, input, p.apps, null, [])).toThrow(/遗漏/)
  })
  it('grounds a colloquial process restriction without routing unrelated applications', async () => {
    const text = '只让微信里的 example.com 走代理'
    const p = await matchLocalApps(
      encode({
        target: 'example.com',
        process: 'WeChat.exe',
        quote: text,
        route: 'proxy',
      }),
      text,
      apps,
      inventory,
      stop,
      stop,
    )
    const rules = await resolvePlan(
      apiPlan(p.raw, text, p.apps, null, ['A'], undefined, p.scopes),
      'A',
      null,
      new AbortController().signal,
    )
    expect(rules.length).toBe(2)
    expect(
      rules.every(
        (r) =>
          r.startsWith('AND,((PROCESS-PATH') &&
          r.includes('(DOMAIN,example.com)'),
      ),
    ).toBe(true)
  })
  it('resolves an unfamiliar nickname through model hints or public aliases backed by a local executable', async () => {
    const text = '小海豚走代理',
      entry = {
        path: 'D:\\Shared\\OceanClient.exe',
        names: ['OceanClient'],
        helpers: [],
      }
    const rule = {
      target: '小海豚',
      app: '小海豚',
      quote: text,
      route: 'proxy',
    }
    for (const remote of [false, true]) {
      const result = await matchLocalApps(
        encode({ ...rule, appNames: remote ? [] : ['OceanClient'] }),
        text,
        {},
        [entry],
        remote
          ? async (term) => {
              expect(term).toBe('小海豚')
              return ['OceanClient']
            }
          : stop,
        stop,
      )
      expect(
        (
          await resolvePlan(
            apiPlan(result.raw, text, result.apps, null, []),
            'Group',
            null,
            new AbortController().signal,
          )
        )[0],
      ).toBe('PROCESS-PATH,D:\\Shared\\OceanClient.exe,Group')
    }
    await expect(
      matchLocalApps(
        encode(rule),
        text,
        {},
        [],
        async () => ['OceanClient'],
        stop,
      ),
    ).rejects.toThrow(/本机/)
  })
  it('lets the user disambiguate two actual installations and never expands a web or explicit process target', async () => {
    const text = '微信直连',
      other = { ...weixin, path: 'E:\\Weixin\\Weixin.exe', helpers: [] }
    const result = await matchLocalApps(
      encode({ target: '微信', quote: text, route: 'direct' }),
      text,
      {},
      [weixin, other],
      stop,
      async (_, items) => {
        expect(items).toHaveLength(2)
        return other
      },
    )
    expect(result.apps['微信']).toEqual([
      'PROCESS-PATH-REGEX,(?i)^E:\\\\Weixin\\\\',
    ])
    for (const [target, quote, webSearch] of [
      ['QQ邮箱', 'QQ邮箱网页端直连', true],
      ['QQ.exe', 'QQ.exe 直连', false],
    ] as const) {
      const raw = encode({ target, quote, webSearch, route: 'direct' })
      expect(
        (await matchLocalApps(raw, quote, apps, inventory, stop, stop)).notes,
      ).toEqual([])
    }
  })
})
