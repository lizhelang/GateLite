import { chromium } from "playwright";

const appUrl = process.env.GATELITE_UI_URL || "http://localhost:5173";

try {
  const browser = await chromium.launch({ headless: true });
  try {
    await verifyLanguage(browser, "zh");
    await verifyLanguage(browser, "en");
  } finally {
    await browser.close();
  }
  console.log("[ok] GateLite UI bilingual verification passed.");
} catch (error) {
  console.error(`[fail] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function verifyLanguage(browser, language) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  try {
    await page.addInitScript((nextLanguage) => {
      window.localStorage.setItem("gatelite.language", nextLanguage);
    }, language);

    await page.goto(appUrl, { waitUntil: "networkidle" });
    await assertBody(page, language === "zh" ? /仪表盘/ : /Dashboard/, `${language} dashboard navigation`);

    await openView(page, language === "zh" ? /Web 服务/ : /Web Services/);
    await assertBody(page, language === "zh" ? /新建规则/ : /New rule/, `${language} Web service create action`);
    await assertBody(page, language === "zh" ? /新建子规则/ : /New sub-rule/, `${language} Web service sub-rule action`);
    await assertBody(page, language === "zh" ? /规则名称/ : /Rule name/, `${language} Web service rule-name column`);
    await assertBody(page, language === "zh" ? /前端域名/ : /Frontend domain/, `${language} Web service frontend column`);
    await assertBody(page, language === "zh" ? /后端 IP:端口/ : /Backend IP:port/, `${language} Web service backend column`);
    await assertBody(page, language === "zh" ? /下行/ : /\bDown\b/, `${language} Web service downstream column`);
    await assertBody(page, language === "zh" ? /上行/ : /\bUp\b/, `${language} Web service upstream column`);
    await assertBody(page, language === "zh" ? /连接/ : /Conn\./, `${language} Web service connection column`);
    await assertBody(page, /whoami\.localhost/, `${language} Web service frontend domain row`);
    await assertBody(page, /whoami:80/, `${language} Web service backend host-port row`);
    await assertVisibleButton(page, language === "zh" ? /拖拽分组/ : /Drag group/, `${language} Web service group drag handle`);
    await verifyWebServicePreview(page, language);

    await openView(page, language === "zh" ? /SSL\/TLS 证书/ : /SSL\/TLS/);
    await assertBody(page, language === "zh" ? /添加证书/ : /Add certificate/, `${language} certificate create action`);
    await assertBody(page, language === "zh" ? /域名 \/ SAN/ : /Domains \/ SANs/, `${language} certificate SAN column`);
    await assertBody(page, language === "zh" ? /绑定/ : /Bindings/, `${language} certificate binding column`);
    await verifyCertificatePreview(page, language);
    await assertCertificateBindingExpansion(page, language);

    await openView(page, language === "zh" ? /Traefik 运行时/ : /Traefik Runtime/);
    await assertBody(page, language === "zh" ? /协议/ : /Protocol/, `${language} runtime protocol column`);
    await assertBody(page, language === "zh" ? /TLS 运行时视图/ : /TLS runtime surface/, `${language} runtime TLS surface`);
    await assertBody(page, language === "zh" ? /TLS 清单/ : /TLS inventory/, `${language} runtime TLS inventory`);

    console.log(`[ok] ${language} UI labels verified for Web services, SSL/TLS certificates, and runtime parity.`);
  } finally {
    await page.close();
  }
}

async function verifyWebServicePreview(page, language) {
  const domain = `ui-preview-${language}-${Date.now()}.localhost`;
  await page.getByRole("button", { name: language === "zh" ? /^新建规则$/ : /^New rule$/ }).click();
  await page.getByLabel(language === "zh" ? /^前端域名$/ : /^Frontend domain$/).fill(domain);
  await page.getByLabel(language === "zh" ? /^后端 IP:端口$/ : /^Backend IP:port$/).fill("whoami:80");
  await page.getByRole("button", { name: language === "zh" ? /预览配置/ : /Preview config/ }).click();
  await page.getByText(language === "zh" ? "配置预览" : "Configuration preview").waitFor({ timeout: 5000 });
  await assertBody(page, language === "zh" ? /配置预览/ : /Configuration preview/, `${language} Web service config preview panel`);
  await assertBody(page, new RegExp(escapeRegex(domain)), `${language} Web service config preview domain`);
  await page.getByRole("button", { name: language === "zh" ? /^取消$/ : /^Cancel$/ }).click();
}

async function verifyCertificatePreview(page, language) {
  const certificatePaths = await readReadableCertificatePaths(page);
  if (!certificatePaths) {
    throw new Error(`${language} certificate preview needs a readable local certificate path.`);
  }

  const name = `UI preview ${language} ${Date.now()}`;
  await page.getByRole("button", { name: language === "zh" ? /添加证书/ : /Add certificate/ }).click();
  await page.getByRole("menuitem", { name: language === "zh" ? /已有路径/ : /Existing path/ }).click();
  await page.getByLabel(language === "zh" ? /^证书名称$/ : /^Certificate name$/).fill(name);
  await page.getByLabel(language === "zh" ? /^证书路径$/ : /^Certificate path$/).fill(certificatePaths.certPath);
  await page.getByLabel(language === "zh" ? /^私钥路径$/ : /^Private key path$/).fill(certificatePaths.keyPath);
  await page.getByRole("button", { name: language === "zh" ? /预览配置/ : /Preview config/ }).click();
  await page.getByText(language === "zh" ? "配置预览" : "Configuration preview").waitFor({ timeout: 5000 });
  await assertBody(page, language === "zh" ? /配置预览/ : /Configuration preview/, `${language} certificate config preview panel`);
  await assertBody(page, new RegExp(escapeRegex(name)), `${language} certificate config preview name`);
  await page.getByRole("button", { name: language === "zh" ? /^取消$/ : /^Cancel$/ }).click();
}

async function readReadableCertificatePaths(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/dashboard");
    if (!response.ok) return null;
    const dashboard = await response.json();
    const certificate = dashboard.certificates?.find((item) => item.certPath && item.keyPath);
    return certificate ? { certPath: certificate.certPath, keyPath: certificate.keyPath } : null;
  });
}

async function openView(page, namePattern) {
  await page.getByRole("button", { name: namePattern }).click();
  await page.waitForLoadState("networkidle");
}

async function assertCertificateBindingExpansion(page, language) {
  const expandButtons = page.getByRole("button", {
    name: language === "zh" ? /展开 .* 的绑定明细/ : /Show bindings for/
  });
  const count = await expandButtons.count();
  if (count < 1) {
    throw new Error(`${language} certificate binding expand button was not visible.`);
  }

  await expandButtons.first().click();
  await page.waitForTimeout(150);
  await assertBody(page, language === "zh" ? /已绑定反代规则/ : /Bound reverse proxy rules/, `${language} inline certificate bindings`);
  await assertBody(page, language === "zh" ? /已覆盖|未覆盖/ : /covered|not covered/, `${language} binding coverage`);
}

async function assertBody(page, pattern, label) {
  const text = await page.locator("body").innerText();
  if (!pattern.test(text)) {
    throw new Error(`Missing ${label}.`);
  }
}

async function assertVisibleButton(page, namePattern, label) {
  const count = await page.getByRole("button", { name: namePattern }).count();
  if (count < 1) {
    throw new Error(`Missing ${label}.`);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
