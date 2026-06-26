<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/gatelite/horizontal-dark.svg">
    <img alt="GateLite" src="public/brand/gatelite/horizontal-light.svg" width="260">
  </picture>

  <h1>GateLite</h1>

  <p><strong>把 Traefik 的域名、证书和路由管理，变成一个轻量控制台。</strong></p>
  <p><strong>Turn Traefik domains, certificates, and route operations into a lightweight control plane.</strong></p>

  <p>
    <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
    <a href="https://github.com/lizhelang/GateLite/releases/tag/v0.1.1"><img alt="Release: v0.1.1" src="https://img.shields.io/badge/release-v0.1.1-brightgreen.svg"></a>
    <a href="https://github.com/users/lizhelang/packages/container/package/gatelite"><img alt="Registry: GHCR" src="https://img.shields.io/badge/registry-GHCR-24292f.svg"></a>
    <img alt="Platform: Docker and Traefik" src="https://img.shields.io/badge/platform-Docker%20%7C%20Traefik-24a1c1.svg">
    <img alt="Language: TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178c6.svg">
    <img alt="Runtime: Node.js" src="https://img.shields.io/badge/runtime-Node.js-43853d.svg">
  </p>

  <p>
    <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
  </p>
</div>

GateLite 是一个面向 Traefik OSS 的轻量管理面板。它不是 Traefik 的 fork，也不替代 Traefik 的反向代理、TLS、ACME、Docker provider、file provider 或 Kubernetes 集成。GateLite 位于 Traefik 之上，负责把常见运维动作做成更直观、更可回滚、更适合人和 Agent 使用的控制面。

## 适合谁用

- 想填写域名、后端地址和证书方式，然后保存生效，而不是手写 Traefik YAML 的人。
- 需要稳定 HTTP API 来创建、更新、删除、审计路由和证书的 AI Agent 或自动化脚本。
- 已经使用 Traefik，希望有一个更轻、更明确边界的自托管伴侣面板的人。

## 当前能力

1. Web 服务 / 反向代理规则
   - 展示当前已使用的域名。
   - 在一行里查看前端域名、后端 IP:port、下行/上行流量和连接状态。
   - 关联 router、service、entrypoint、middleware、TLS 模式、provider 和健康状态。
   - 生成 Traefik file provider 动态配置。

2. SSL/TLS 证书管理
   - 支持 self-signed、上传 PEM、已有路径证书、ACME resolver 映射和 sync 接收。
   - 解析有效期、SAN、issuer/subject，并标记 valid、expiring、expired、invalid、pending。
   - Web 服务绑定文件证书时，会校验证书存在、启用、未过期，并覆盖绑定域名。
   - 删除证书默认只删元数据；管理员可以选择清理 GateLite 管理的 PEM 文件。

3. Traefik 运行时观测
   - 从 Traefik API 读取 routers、services、middlewares、TLS 对象、providers、entrypoints 和运行状态。
   - 保持 Traefik OSS 作为运行时事实来源。
   - 通过 Prometheus metrics 展示 managed domain 的流量概览。

4. Agent 友好的 API
   - 提供稳定 HTTP API。
   - 支持 dry-run、diff、apply、rollback 等运维路径。
   - 返回机器可读的校验错误，方便 Agent 自动修复请求。

## 非目标

- 不 fork Traefik。
- 不重写 Traefik 的代理引擎。
- 不把高级 Traefik 概念藏起来。
- 不在没有预览、校验和回滚的情况下直接改生产配置。
- 不接管 ACME 申请、DNS challenge、续期和 DNS provider token。

## 截图

![GateLite dashboard overview](docs/assets/screenshots/dashboard.png)

| Web services | SSL/TLS certificates |
| --- | --- |
| ![GateLite Web services table](docs/assets/screenshots/web-services.png) | ![GateLite SSL/TLS certificate table](docs/assets/screenshots/certificates.png) |

## 三分钟自托管部署

如果你已经有 Traefik、Docker network、file provider 动态配置目录和证书目录，可以按这个路径启动：

1. 拉取镜像：

   ```bash
   docker pull ghcr.io/lizhelang/gatelite:0.1.1
   ```

2. 复制 `deploy/portainer/gatelite/docker-compose.yml`，并按你的环境设置：

   ```env
   GATELITE_IMAGE=ghcr.io/lizhelang/gatelite:0.1.1
   GATELITE_HOST=gatelite.example.com
   GATELITE_AUTH_ENABLED=true
   GATELITE_AUTH_USERNAME=admin
   GATELITE_AUTH_PASSWORD=<strong-password>
   ```

   如果你的 Traefik 动态配置目录和证书目录不是 `/data/compose/1/dynamic` 与 `/data/compose/1/certs`，请同步调整 compose 里的 volume。

3. 启动并验证：

   ```bash
   docker compose up -d
   GATELITE_PUBLIC_URLS=https://gatelite.example.com npm run verify:domains
   ```

离线安装可以下载 GitHub Release 里的 `gatelite-<version>.tar.gz`，然后执行：

```bash
docker load < gatelite-<version>.tar.gz
```

## 本地开发

安装依赖：

```bash
npm install
```

启动本地 Traefik 和示例后端：

```bash
npm run compose:up
```

启动 GateLite：

```bash
npm run dev
```

本地入口：

- GateLite frontend: http://localhost:5173
- GateLite API: http://localhost:3001/api/health
- Traefik dashboard/API: http://localhost:18081
- Traefik Prometheus metrics: http://localhost:18081/metrics
- HTTP test route: http://whoami.localhost:18080
- HTTPS test route: https://secure.localhost:18443

常用检查：

```bash
npm run typecheck
npm run build
npm run test
npm run audit:prod
npm run verify:release
npm run verify:local
npm run verify:ui-i18n
npm run verify:crud
```

## 证书边界

GateLite 不是 CA、ACME client 或续期守护进程。证书链路仍由各自系统负责：

- Traefik 负责 TLS 终止、ACME challenge、签发、续期和 `acme.json`。
- Cloudflare 或其他 CDN 可能在浏览器到源站之间先做 TLS 终止。
- DDNS 工具负责更新 DNS 记录或公网 IP 指向，不负责签发证书。
- GateLite 负责路由和证书的绑定意图、本地 PEM 元数据、上传或 sync 到 `GATELITE_CERT_DIR` 的 PEM 文件、resolver 引用，以及挂载 Traefik 配置/存储后的只读 ACME 状态展示。

不要把 DNS provider API token 存在 GateLite。ACME challenge 所需的敏感凭据应该留在 Traefik 或基础设施层。

证书删除默认只删除 GateLite 元数据。管理员可以选择清理 `self-signed`、`upload`、`sync` 来源的 GateLite 管理 PEM 文件；`path` 证书和 Traefik ACME 存储不会被 GateLite 删除。

## 访问控制

GateLite 内置鉴权默认关闭。开启 Basic auth：

```bash
GATELITE_AUTH_ENABLED=true
GATELITE_AUTH_USERNAME=admin
GATELITE_AUTH_PASSWORD=<strong-password>
```

API 客户端可以使用不同角色的 Bearer token，例如 `GATELITE_VIEWER_TOKEN`、`GATELITE_AGENT_TOKEN`、`GATELITE_OPERATOR_TOKEN` 和 `GATELITE_ADMIN_TOKEN`。更多说明见 [security.md](docs/security.md)。

## 发布与部署

GateLite 的 release 是项目发布，不是任何维护者私有域名的部署。你部署自己的实例时，需要把 `GATELITE_HOST`、`TRAEFIK_API_URL`、`GATELITE_DYNAMIC_FILE`、`GATELITE_CERT_DIR` 和可选 ACME 观测挂载指向你自己的 Traefik 环境。

更多发布、版本和回滚说明见 [release.md](docs/release.md)。

## License

MIT. See [LICENSE](LICENSE).
