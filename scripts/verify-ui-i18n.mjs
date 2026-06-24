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
    await assertBody(page, language === "zh" ? /前端域名/ : /Frontend domain/, `${language} Web service frontend column`);
    await assertBody(page, language === "zh" ? /后端 IP:端口/ : /Backend IP:port/, `${language} Web service backend column`);
    await assertBody(page, language === "zh" ? /下行/ : /\bDown\b/, `${language} Web service downstream column`);
    await assertBody(page, language === "zh" ? /上行/ : /\bUp\b/, `${language} Web service upstream column`);
    await assertBody(page, language === "zh" ? /连接/ : /Conn\./, `${language} Web service connection column`);
    await assertVisibleButton(page, language === "zh" ? /拖拽分组/ : /Drag group/, `${language} Web service group drag handle`);

    await openView(page, language === "zh" ? /SSL\/TLS 证书/ : /SSL\/TLS/);
    await assertBody(page, language === "zh" ? /添加证书/ : /Add certificate/, `${language} certificate create action`);
    await assertBody(page, language === "zh" ? /域名 \/ SAN/ : /Domains \/ SANs/, `${language} certificate SAN column`);
    await assertBody(page, language === "zh" ? /绑定/ : /Bindings/, `${language} certificate binding column`);
    await assertCertificateBindingExpansion(page, language);

    console.log(`[ok] ${language} UI labels verified for Web services and SSL/TLS certificates.`);
  } finally {
    await page.close();
  }
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
