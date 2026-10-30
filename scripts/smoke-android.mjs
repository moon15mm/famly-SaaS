// Local debug APK only. Uses existing demo accounts without embedding their password.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { _android, expect } = require('playwright/test');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serial = process.env.ANDROID_TEST_SERIAL || 'emulator-5580';
assert.ok(serial.startsWith('emulator-'), 'This audit is restricted to an emulator');
const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const adbRun = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 30000 });
const secret = fs.readFileSync(path.join(root,'.env'),'utf8').match(/^DEMO_PASSWORD=(.+)$/m)?.[1]?.trim();
assert.ok(secret);
const origin = 'http://localhost:3000';
const health = await (await fetch(origin+'/api/health')).json();
assert.equal(health.environment,'development');
assert.equal(health.payments,'test');
const checks = [], errors = [];
let device;
const evidence = path.join(root,'data/android-run');
fs.mkdirSync(evidence,{recursive:true});
async function step(id, action) {
  console.log('ANDROID '+id);
  try { await action(); checks.push({id,status:'passed'}); }
  catch(error) { checks.push({id,status:'failed'}); throw error; }
}
function nativeXml() {
  adbRun('shell','uiautomator','dump','/sdcard/min-buyutna-ui.xml');
  return adbRun('shell','cat','/sdcard/min-buyutna-ui.xml');
}
function tapNode(predicate) {
  const xml=nativeXml();
  const nodes=[...xml.matchAll(/<node\b[^>]*>/g)].map(m=>Object.fromEntries([...m[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]])));
  const node=nodes.find(predicate);
  if(!node) throw new Error('Expected Android control missing');
  const b=node.bounds.match(/\d+/g).map(Number);
  adbRun('shell','input','tap',String(Math.floor((b[0]+b[2])/2)),String(Math.floor((b[1]+b[3])/2)));
}
async function saveNative(name) {
  await expect.poll(()=>nativeXml().includes('com.google.android.documentsui'),{timeout:30000}).toBe(true);
  tapNode(n=>/save_menu$/.test(n['resource-id']||'') || /^save$/i.test(n.text||''));
  await expect.poll(()=>{try{return adbRun('shell','ls','/sdcard/Download/'+name).includes(name);}catch{return false;}},{timeout:20000}).toBe(true);
  adbRun('pull','/sdcard/Download/'+name,path.join(evidence,name));
}
try {
  const devices=await _android.devices({omitDriverInstall:true});
  device=devices.find(d=>d.serial()===serial);
  assert.ok(device,'Test emulator missing');
  device.setDefaultTimeout(30000);
  const view=await device.webView({pkg:'sa.minbuyutna.app.local'},{timeout:60000});
  const page=await view.page();
  page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.message));
  async function login(email,route,heading) {
    await page.evaluate(async()=>{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});});
    await page.goto(origin+'/login');
    await page.getByLabel('البريد الإلكتروني',{exact:true}).fill(email);
    await page.getByLabel('كلمة المرور',{exact:true}).fill(secret);
    await page.getByRole('button',{name:'دخول',exact:true}).click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto(origin+route);
    await expect(page.getByRole('heading',{level:1,name:heading})).toBeVisible();
  }
  await step('home_rtl_bridge',async()=>{
    await page.goto(origin+'/');
    await expect(page.locator('html')).toHaveAttribute('dir','rtl');
    await expect(page.getByRole('heading',{level:1})).toContainText('دفء بيوتنا');
    await expect.poll(()=>page.evaluate(()=>window.__minBuyutnaNativeReady)).toBe(true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+2));
    fs.writeFileSync(path.join(root,'reports/android-home.png'),await device.screenshot());
  });
  await step('customer_login_session',async()=>{
    await login('customer@example.test','/account',/حيّاك يا/);
    await page.reload();
    await expect(page.getByRole('heading',{level:1})).toContainText('حيّاك يا');
  });
  await step('account_export_saved_by_android',async()=>{
    await expect.poll(()=>page.evaluate(()=>window.__minBuyutnaNativeReady)).toBe(true);
    await page.getByRole('button',{name:'تنزيل نسخة من بياناتي'}).click();
    await saveNative('my-account.json');
    const data=JSON.parse(fs.readFileSync(path.join(evidence,'my-account.json'),'utf8'));
    assert.equal(data.account.email,'customer@example.test');
    assert.doesNotMatch(JSON.stringify(data),/"password_hash"|"token_hash"|"totp"/);
  });
  await step('android_back_navigation',async()=>{
    await page.goto(origin+'/orders');
    await expect(page.getByRole('heading',{level:1,name:'الطلبات',exact:true})).toBeVisible();
    adbRun('shell','input','keyevent','KEYCODE_BACK');
    await expect(page).toHaveURL(origin+'/account');
  });
  await step('owner_dashboard',async()=>{
    await login('admin@example.test','/admin','صورة أوضح لكل التفاصيل');
    fs.writeFileSync(path.join(root,'reports/android-owner.png'),await device.screenshot());
  });
  await step('driver_dashboard',async()=>{await login('driver@example.test','/driver','مساحة السائق');});
  await step('household_dashboard',async()=>{await login('seller1@example.test','/seller','لوحة الأسرة');});
  await step('household_csv_saved_by_android',async()=>{
    await page.getByRole('button',{name:'المبيعات والاشتراك',exact:true}).click();
    await page.getByRole('button',{name:'تنزيل التقرير CSV'}).click();
    await saveNative('sales-report.csv');
    const csv=fs.readFileSync(path.join(evidence,'sales-report.csv'),'utf8');
    assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('اليوم'));
  });
  await step('image_picker_opens_without_storage_permission',async()=>{
    await page.goto(origin+'/verification');
    await page.getByLabel('صورة واضحة للمستند').click();
    await expect.poll(()=>nativeXml().includes('com.google.android.documentsui'),{timeout:30000}).toBe(true);
    adbRun('shell','input','keyevent','KEYCODE_BACK');
  });
  await step('offline_and_reconnect',async()=>{
    adbRun('reverse','--remove','tcp:3000');
    try { await page.goto(origin+'/?android-offline-check=1',{timeout:15000}); } catch {}
    await expect.poll(()=>nativeXml().includes('تعذر الاتصال بالمنصة'),{timeout:30000}).toBe(true);
    adbRun('reverse','tcp:3000','tcp:3000');
    tapNode(n=>n.text==='إعادة المحاولة');
    await expect(page.getByRole('heading',{level:1})).toContainText('دفء بيوتنا');
  });
  await step('no_javascript_error',async()=>{assert.deepEqual(errors,[]);});
  console.log('ANDROID smoke passed: '+checks.length);
} catch(error) {
  const message=String(error.message).replaceAll(secret,'[redacted]').slice(0,900);
  console.error(message);errors.push(message);process.exitCode=1;
} finally {
  try {adbRun('reverse','tcp:3000','tcp:3000');}catch{}
  fs.writeFileSync(path.join(root,'reports/android-smoke.json'),JSON.stringify({status:process.exitCode?'failed':'passed',serial,checks,errors,scope:'Local debug APK on Android emulator; no physical phone tested'},null,2));
  if(device) await device.close();
}
