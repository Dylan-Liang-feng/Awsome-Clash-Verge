import { expect, it } from 'vitest'

import { apiPlan } from './api-rule-plan'
import { resolvePlan } from './routing-coverage'

const plan = (text: string, more: object = {}) =>
  apiPlan(
    JSON.stringify({
      rules: [
        {
          target: 'sample.edu.cn',
          quote: text,
          route: 'direct',
          bypassTun: true,
          subdomains: true,
          ...more,
        },
      ],
    }),
    text,
    {},
    null,
    [],
  )
it('uses a loopback HTTP marker only when a browser bypass was explicitly requested', async () => {
  expect(
    await resolvePlan(
      plan('sample.edu.cn 和子域名完全绕过 TUN'),
      '',
      null,
      new AbortController().signal,
    ),
  ).toEqual([
    'AND,((IN-TYPE,HTTP/HTTPS),(SRC-IP-CIDR,127.0.0.1/32),(DOMAIN-SUFFIX,sample.edu.cn)),DIRECT',
  ])
  expect(() => plan('sample.edu.cn 和子域名直连')).toThrow()
  expect(() => plan('sample.edu.cn 绕过 TUN', { route: 'proxy' })).toThrow()
})
