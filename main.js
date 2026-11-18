import { createHash } from 'node:crypto'

const origin = 'https://glados.rocks'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const defaultUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

class CheckinError extends Error {}

const describeFailure = (result) => {
  const reason = String(result?.reason || '').toLowerCase()
  const message = String(result?.message || '').toLowerCase()
  if (reason === 'turnstile' || message.includes('cloudflare verification failed')) {
    return '官网要求人机验证，请在浏览器中手动签到'
  }
  if (reason === 'device-mismatch' || message.includes('automated check-in detected')) {
    return '设备校验失败，请更新 GLADOS_USER_AGENT 并重新登录获取 Cookie'
  }
  if (result?.httpStatus === 401 || result?.httpStatus === 403 ||
      result?.code === -2 || message.includes('没有权限')) {
    return '会话认证失败，请更新 GLADOS Cookie'
  }
  const code = Number.isInteger(result?.code) ? ` (code=${result.code})` : ''
  const status = Number.isInteger(result?.httpStatus) ? ` (HTTP ${result.httpStatus})` : ''
  return `签到接口拒绝请求${code}${status}`
}

const request = async (path, cookie, method = 'GET', body) => {
  const response = await fetch(origin + path, {
    method,
    headers: {
      cookie,
      referer: origin + '/console/checkin',
      'user-agent': process.env.GLADOS_USER_AGENT || defaultUserAgent,
      accept: 'application/json, text/plain, */*',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  })
  let data
  try {
    data = await response.json()
  } catch {
    throw new CheckinError(`官网返回了非 JSON 响应 (HTTP ${response.status})`)
  }
  if (!data || typeof data !== 'object') {
    throw new CheckinError('官网返回了无效响应')
  }
  return { ...data, httpStatus: response.status }
}

const checkin = async (cookie) => {
  const challenge = await request('/api/user/checkin/challenge', cookie)
  const challengeMessage = String(challenge.message || '').toLowerCase()
  const challengeRepeated = challengeMessage.includes('checkin repeats') ||
    challengeMessage.includes("today's observation logged")
  if (!challengeRepeated) {
    if (challenge.httpStatus !== 200 || challenge.code !== 0) {
      throw new CheckinError(describeFailure(challenge))
    }
    const { nonce, ttl = 300000 } = challenge
    if (typeof nonce !== 'string' || nonce.length < 1 || nonce.length > 4096 ||
        typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 2700) {
      throw new CheckinError('官网未提供有效签到 challenge')
    }
    const proof = createHash('sha256')
      .update(nonce + '.glados-observe-v1')
      .digest('hex')
    await delay(2700)
    const result = await request('/api/user/checkin', cookie, 'POST', {
      token: 'glados.rocks',
      nonce,
      proof,
    })
    const message = String(result.message || '').toLowerCase()
    const repeated = message.includes('checkin repeats') ||
      message.includes("today's observation logged")
    const success = result.httpStatus === 200 &&
      (result.code === 0 || repeated || message.includes('checkin! got'))
    if (!success || result.reason === 'turnstile' ||
        result.reason === 'device-mismatch' ||
        message.includes('cloudflare verification failed') ||
        message.includes('automated check-in detected')) {
      throw new CheckinError(describeFailure(result))
    }
    return repeated ? '今日已签到' : '签到请求已成功'
  }
  return '今日已签到'
}

const glados = async () => {
  const cookies = String(process.env.GLADOS || '').split(/\r?\n/).map((v) => v.trim()).filter(Boolean)
  if (!cookies.length) throw new CheckinError('未设置 GLADOS Secret')
  const notice = []
  let failures = 0
  for (const [index, cookie] of cookies.entries()) {
    const label = `账号 ${index + 1}`
    try {
      if (!cookie.includes('gld:sess=') || !cookie.includes('gld:sess.sig=')) {
        throw new CheckinError('Cookie 缺少当前会话字段 gld:sess / gld:sess.sig')
      }
      const outcome = await checkin(cookie)
      notice.push(`${label}: ${outcome}`)
      try {
        const status = await request('/api/user/status', cookie)
        const days = Number(status?.data?.leftDays)
        if (status.httpStatus === 200 && status.code === 0 && Number.isFinite(days)) {
          notice.push(`${label}: 剩余 ${days} 天`)
        }
      } catch {
        notice.push(`${label}: 状态查询不可用，请在官网核对入账`)
      }
    } catch (error) {
      failures++
      const reason = error instanceof CheckinError
        ? error.message
        : '网络请求失败或超时，请检查官网状态'
      notice.push(`${label}: 签到失败：${reason}`)
    }
  }
  return { notice, failures }
}

const notify = async (notice) => {
  if (!process.env.NOTIFY || !notice) return
  for (const option of String(process.env.NOTIFY).split('\n')) {
    if (!option) continue
    try {
      if (option.startsWith('console:')) {
        for (const line of notice) {
          console.log(line)
        }
      } else if (option.startsWith('wxpusher:')) {
        await fetch(`https://wxpusher.zjiecode.com/api/send/message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            appToken: option.split(':')[1],
            summary: notice[0],
            content: notice.join('<br>'),
            contentType: 3,
            uids: option.split(':').slice(2),
          }),
        })
      } else if (option.startsWith('pushplus:')) {
        await fetch(`https://www.pushplus.plus/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: option.split(':')[1],
            title: notice[0],
            content: notice.join('<br>'),
            template: 'markdown',
          }),
        })
      } else if (option.startsWith('qyweixin:')) {
        const qyweixinToken = option.split(':')[1]
        const qyweixinNotifyRebotUrl = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=' + qyweixinToken;
        await fetch(qyweixinNotifyRebotUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'markdown',
            markdown: {
                content: notice.join('<br>')
            }
          }),
        })
      } else {
        // fallback
        await fetch(`https://www.pushplus.plus/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: option,
            title: notice[0],
            content: notice.join('<br>'),
            template: 'markdown',
          }),
        })
      }
    } catch (error) {
      throw error
    }
  }
}


const main = async () => {
  try {
    const { notice, failures } = await glados()
    for (const line of notice) console.log(line)
    try {
      await notify(notice)
    } catch {
      console.error('通知发送失败')
    }
    if (failures) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof CheckinError ? error.message : '签到程序发生异常')
    process.exitCode = 1
  }
}

await main()

