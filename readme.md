# GLaDOS 每日签到

GitHub Actions 每天北京时间约 08:23 尝试在 [GLaDOS](https://glados.rocks/console/checkin) 签到。GitHub 的定时任务可能延迟或偶尔漏跑；官网若要求 Cloudflare 人机验证，云端签到会报告失败，需要在官网浏览器中手动完成。

## 配置

1. 在仓库 **Settings → Secrets and variables → Actions → Secrets** 中设置 `GLADOS`，填写从已登录浏览器获取的完整 Cookie。当前会话应包含 `gld:sess` 和 `gld:sess.sig`。多个账号可按行填写。
2. 如果运行日志提示设备校验失败，在同一个已登录浏览器中读取完整 User-Agent，并在 **Actions → Variables** 中设置 `GLADOS_USER_AGENT`。浏览器更新或重新登录后，可能需要同步更新 Cookie 和 User-Agent。
3. 在 **Actions → GLaDOS daily check-in → Run workflow** 中手动运行一次，然后查看 `checkin` 任务日志。日志仅输出账号序号和脱敏结果；`success` 表示签到请求成功或今日已签到，`failure` 表示至少一个账号未完成签到。最终积分请在官网核对。

Cookie、User-Agent 和通知密钥不要写入仓库文件或公开日志。User-Agent 可以用仓库 Variable 保存，Cookie 必须用 Secret。

## 可选通知

在 Actions Secrets 中设置 `NOTIFY`，可按行配置多个：

- `wxpusher:{token}:{uid}`
- `pushplus:{token}`
- `qyweixin:{key}`
- `console:log`

即使不设置 `NOTIFY`，Actions 日志也会显示脱敏结果。

## 故障排查

- **未设置 GLADOS Secret / Cookie 缺少当前会话字段**：重新登录官网并更新 Secret。
- **设备校验失败**：更新 Cookie 和 `GLADOS_USER_AGENT`，确保它们来自同一次浏览器会话。
- **官网要求人机验证**：在官网浏览器中手动签到；GitHub 云端运行无法保证通过该验证。
- **Actions 没有按时运行**：GitHub 定时任务可能延迟或漏跑。可先手动运行，并检查工作流是否启用。

