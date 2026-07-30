# 部署（阿里云 ECS + nginx）

架构：nginx 在前面处理静态文件、TLS 和 Range 请求，`vinext start` 只监听
`127.0.0.1:3000` 负责 SSR 和动态路由。

```
浏览器 ──► nginx :80/:443
             ├─ /assets/  /audio/  *.svg  →  直接读 dist/client/（支持 Range）
             └─ 其余                      →  proxy_pass 127.0.0.1:3000
```

## 文件

| 文件 | 用途 |
|---|---|
| `nginx.conf` | 站点配置，装到 `/etc/nginx/conf.d/` |
| `service.sh` | **纯启停**：start / stop / restart / status / logs |
| `fan-bus.service` | systemd 单元（可选，替代 `service.sh` 做开机自启） |
| `deploy.sh` | 部署：拉代码 → 装依赖 → 构建 → 重启 → 健康检查 |

## 启停（`service.sh`）

```bash
./deploy/service.sh start      # 先起 nginx，再起应用
./deploy/service.sh stop
./deploy/service.sh restart
./deploy/service.sh status     # 两者状态 + HTTP 健康码
./deploy/service.sh logs       # 跟踪应用日志
```

**它完全不碰 git**——不拉代码、不切分支、不构建，只启动 `dist/` 里现有的东西。
换代码版本用 `deploy.sh`，两者职责分开。

不需要装 systemd 单元也能用：应用进程由脚本自己管（pid 文件在 `.run/app.pid`，
日志在 `.run/app.log`），nginx 有 systemd 就走 `systemctl`，没有就直接调 `nginx`
二进制。

环境变量可覆盖：

| 变量 | 默认 | 说明 |
|---|---|---|
| `APP_HOST` | `127.0.0.1` | 应用监听地址，只给 nginx 连 |
| `APP_PORT` | `3000` | 应用端口 |
| `MANAGE_NGINX` | `1` | 设 `0` 则只管应用，不碰 nginx |

启动顺序是 **nginx 先、应用后**：应用起来前的几秒 nginx 会返回 502，但站点至少
是可达的，比整个连接被拒绝更好排查。

脚本会在启动前挡掉两种常见故障：`dist/` 缺失（提示先 `npm run build`）和端口被
占用（提示可能有残留进程）。

## 首次安装

```bash
# 1. Node 22.13+ （package.json 的 engines 要求）
node -v

# 2. nginx
sudo yum install -y nginx        # 阿里云 Linux / CentOS
# sudo apt install -y nginx      # Ubuntu / Debian

# 3. 站点配置。默认是 default_server + server_name _，
#    所以直接用公网 IP 访问 http://<IP>/ 就能通，不需要域名。
sudo cp deploy/nginx.conf /etc/nginx/conf.d/fan-bus.conf
sudo nginx -t && sudo systemctl enable --now nginx

#    若报 "a duplicate default server"，是发行版自带的默认站点占了 80：
#    sudo mv /etc/nginx/conf.d/default.conf{,.disabled}   # RHEL / 阿里云 Linux
#    sudo rm /etc/nginx/sites-enabled/default             # Debian / Ubuntu

# 4. 应用服务
sudo cp deploy/fan-bus.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fan-bus

# 5. HTTPS（需要真实域名，certbot 无法为裸 IP 签发）
#    先把域名写进 nginx.conf 的 server_name，再：
sudo certbot --nginx -d your-domain.com
```

访问 `http://<公网IP>/` 即可。若不通，依次查：nginx 是否在跑、应用是否在跑
（`./deploy/service.sh status`）、阿里云**安全组**是否放开了 80 端口入方向。
最后这条最容易漏 —— 服务器本机 `curl localhost` 通但外网打不开，基本都是安全组。

Ubuntu/Debian 的 nginx 用 `sites-available/` + `sites-enabled/` 软链，不是
`conf.d/`，第 3 步要相应调整。

## 日常部署

```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh
```

构建失败时脚本会直接退出且**不重启服务**，线上跑的还是上一个正常版本。

## 常用命令

```bash
sudo systemctl status fan-bus
journalctl -u fan-bus -f          # 应用日志
sudo tail -f /var/log/nginx/error.log
```

## 这个项目特有的几个坑

**1. 不能用 `npm ci --omit=dev`**

`vinext` 和 `wrangler` 都在 `devDependencies` 里。砍掉 dev 依赖后连构建工具都没了。

**2. nginx 必须转发 `X-Forwarded-Host` / `X-Forwarded-Proto`**

`app/layout.tsx` 用这两个头拼 `metadataBase`：

```ts
const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
```

不转发的话，分享到微信/微博的卡片图会指向 `localhost:3000`。

**3. nginx 必须关 `proxy_buffering`**

vinext 走流式 SSR。开着缓冲会等整个文档生成完才发出去，表现为白屏变长。

**4. `dist/client/_headers` 对 nginx 无效**

那是 Cloudflare 格式的头文件，vinext 构建时生成。nginx 不认，所以
`nginx.conf` 里手写了等效的 `/assets/` 缓存规则。

**5. 原生二进制可能静默损坏**

网络不好时 npm 可能装进一个被截断的 `.node` 文件——安装不报错，但 `dlopen`
失败，错误会延迟到构建时才冒出来，且信息很误导（提示你删 lockfile 重装）。
`deploy.sh` 会在构建前逐个 `require()` 验证。手动排查：

```bash
find node_modules -name '*.node' -exec sh -c 'node -e "require(\"$PWD/$1\")" 2>/dev/null || echo "BAD: $1"' _ {} \;
```

**6. 音频目前会被下载两次**

`app/page.tsx` 里内置歌曲先 `fetch` 一次做节拍分析，然后又把原始 URL 交给
`new Audio()` 再走一次 HTTP 流式请求。`guaihuo.mp3` 有 7.8MB，等于每次选歌
传 15.6MB，并且第二个流式请求会在浏览器缓冲够时中断，日志里留下
`Static file stream error: Premature close`。

nginx 支持 Range 后播放不会出错，但双下载依然浪费。根治办法是复用第一次
fetch 到的字节：

```ts
const blob = await response.blob();
const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
sourceUrl: URL.createObjectURL(blob),
objectUrl: true,
```

注意顺序：`decodeAudioData` 会转移（detach）传入的 ArrayBuffer，必须先拿
blob 再从 blob 派生 arrayBuffer。

## 备案提醒

在大陆的服务器上用 80/443 对外提供服务，域名需要完成 ICP 备案，否则会被拦截。
