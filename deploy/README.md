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
| `fan-bus.service` | systemd 单元，管进程和自动重启 |
| `deploy.sh` | 拉代码 → 装依赖 → 构建 → 重启 → 健康检查 |

## 首次安装

```bash
# 1. Node 22.13+ （package.json 的 engines 要求）
node -v

# 2. nginx
sudo yum install -y nginx        # 阿里云 Linux / CentOS
# sudo apt install -y nginx      # Ubuntu / Debian

# 3. 站点配置，把 APP_DOMAIN 换成真实域名
sudo cp deploy/nginx.conf /etc/nginx/conf.d/fan-bus.conf
sudo sed -i 's/APP_DOMAIN/your-domain.com/' /etc/nginx/conf.d/fan-bus.conf
sudo nginx -t && sudo systemctl enable --now nginx

# 4. 应用服务
sudo cp deploy/fan-bus.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fan-bus

# 5. HTTPS
sudo certbot --nginx -d your-domain.com
```

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
