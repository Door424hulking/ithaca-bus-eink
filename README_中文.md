# Ithaca 公交墨水屏：云端运行版

版本 0.2.0；上线日期 2026-11-13（伊萨卡时间）。

## 当前状态

已部署到用户自己的 Render 账户。云端任务已启用，电脑关机不影响查询与上传。

- 私有源码：https://github.com/Door424hulking/ithaca-bus-eink
- 运行记录：https://dashboard.render.com/cron/crn-dbrro63l550s73elgrqg/runs
- 日志：https://dashboard.render.com/cron/crn-dbrro63l550s73elgrqg/logs
- 设置：https://dashboard.render.com/cron/crn-dbrro63l550s73elgrqg/settings
- 服务 ID：crn-dbrro63l550s73elgrqg
- 首次部署的程序提交：be73f4a97137fa5ddb38eea66166f2ebd135b561

验证记录（2026-11-13 EST）：

1. 20:40:58，Render 服务器运行测试：21 项通过、0 项失败。
2. 20:41:31，手动触发的云端任务成功上传极趣云第 2 页，程序退出码为 0；20:41:34 平台记录运行成功。
3. 随后停用 Windows 的 IthacaBusEink 任务，确认 Enabled=false、State=Disabled，且没有遗留的本项目 Node 更新进程。
4. 20:43，Render 按计划自动触发，20:43:16 成功上传新画面并以 0 退出，20:43:20 平台记录运行成功。这一轮没有手动触发。

## 日常使用

墨水屏保持供电并连接 Wi-Fi 即可，不需要连接电脑传输数据。若目前通过电脑 USB 供电，关机后请确保它仍有电，例如改用独立 USB 电源或设备电池。

Render 每小时第 3、13、23、33、43、53 分钟启动一次程序。每次重新获取 TCAT 数据，固定查询 Ithaca Commons 到 Carpenter Hall / Sage Hall 的直达班次，显示最近三班，再由下车站步行到 Rhodes Hall。

程序生成 400×300 黑白图片并上传极趣云第 2 页；极趣云保存图片，墨水屏通过 Wi-Fi 按自身同步周期取回。云端上传成功不等于实体屏幕此刻已刷新；本次已验证云端定时运行和上传，未重新目视验证实体屏幕的自动刷新。

屏幕上的剩余分钟数以 AS OF 时间为准，不是持续倒计时。请同时看绝对发车时间。LIVE 表示新鲜的实时预测；SCHED 表示时刻表。

不要再次启动原电脑的 Start_Background_Windows.cmd，否则会恢复第二套上传任务。

## 实际部署配置

| 配置 | 值 |
| --- | --- |
| 服务类型 | 单个 Render Cron Job |
| 运行环境 | Node.js 24.21.0 |
| 区域 | Virginia |
| 计算规格 | 0.5 CPU / 512 MB |
| 构建命令 | `node --test test/*.test.mjs` |
| 执行命令 | `node Cloud_Update.mjs` |
| 时间表 | `3,13,23,33,43,53 * * * *` |
| 自动部署代码变更 | Off |
| 显示目标页 | 2 |

密钥和设备 ID 已作为 Render 环境变量保存，不在仓库中。不要提交 .env、缓存或运行日志。

任务执行完即退出，超过 90 秒会终止子进程，必要时在 3 秒后强制结束。失败或超时返回非零退出码，方便平台记录失败。无需数据库、常驻 Web 服务或持久磁盘。

Render 参考费率为 USD 0.00016/运行分钟，每个 Cron Job 每月至少 USD 1；以实际账单为准，并非固定收费或已设置硬性费用封顶。
官方说明：https://render.com/docs/cronjobs

## 维护与故障检查

1. 在 Runs 查看最近一次运行；成功项应显示 Scheduled 或 Manual，以及成功状态。
2. 在 Logs 查看最近的 AS OF、Uploaded to page 2 和 exit=0。
3. 若云端上传成功但屏幕未变化，检查墨水屏供电、Wi-Fi、当前页及同步周期，并尝试设备的同步操作。
4. 修改代码后先运行测试，再在 Render 手动部署；当前关闭了自动部署。
5. 如需暂停云端更新，在 Settings 使用 Suspend Cron Job。暂停不会删除源码或设备已有画面。

## 本地开发

```sh
node --test test/*.test.mjs
node Cloud_Update.mjs --dry-run
```

`--dry-run` 从真实 TCAT 数据生成 output/board.png 和 output/board.json，不上传极趣云。正常执行 `node Cloud_Update.mjs` 会上传，需要提供 ZECTRIX_API_KEY 和 ZECTRIX_DEVICE_ID 环境变量。设备 ID 使用 MAC，不使用型号名称。

## 边界

- 按发车先后列出直达班次，不计算换乘或总步行时间。
- 超过 3 分钟的实时数据降级为时刻表，排除取消班次和不合适的上下车站。
- 时刻表过期或数据失败时明确显示问题，不把旧数据当成当前预测。
- 每次全新启动均可重新获取时刻表；进程内缓存只用于降低重复读取。
- Dockerfile 是迁移备用入口，未验证 Docker 构建。当前已验证并使用 Render 原生 Node 环境。
