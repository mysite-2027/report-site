// بوابة الاشتراك: تحمي صفحات الموقع وتدير الحسابات والأجهزة.
// الإعدادات المطلوبة: ربط قاعدة D1 باسم DB، وسر ADMIN_PASSWORD.
// اختياري للتنبيهات بالإيميل: RESEND_API_KEY و ALERT_EMAIL.

const DAY = 864e5, MIN = 6e4;
const SESSION_DAYS = 30, DEVICE_WINDOW = 30 * DAY;
const enc = new TextEncoder();

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,name TEXT DEFAULT '',salt TEXT NOT NULL,hash TEXT NOT NULL,expires_at INTEGER NOT NULL,active INTEGER DEFAULT 1,max_devices INTEGER DEFAULT 3,created_at INTEGER NOT NULL,welcome_ack INTEGER DEFAULT 0,warn_at INTEGER DEFAULT 0,warn_ack INTEGER DEFAULT 0,note TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,did TEXT NOT NULL,created_at INTEGER,last_seen INTEGER)`,
  `CREATE TABLE IF NOT EXISTS devices(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,did TEXT NOT NULL,label TEXT,country TEXT,city TEXT,iph TEXT,first_seen INTEGER,last_seen INTEGER,removed INTEGER DEFAULT 0,UNIQUE(user_id,did))`,
  `CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER,user_id INTEGER,email TEXT,kind TEXT,detail TEXT)`,
  `CREATE TABLE IF NOT EXISTS attempts(k TEXT,ts INTEGER)`
];
let ready = null;
function init(env) {
  if (!ready) ready = env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))).catch(e => { ready = null; throw e; });
  return ready;
}

/* ---------- أدوات ---------- */
const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...h } });
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async s => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function pbkdf2(pw, salt) {
  const k = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 100000 }, k, 256));
}
function same(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
function cookies(req) {
  const o = {};
  (req.headers.get("cookie") || "").split(";").forEach(p => { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return o;
}
const ck = (n, v, days) => `${n}=${v}; Path=/; Max-Age=${Math.round(days * 86400)}; HttpOnly; Secure; SameSite=Lax`;
const ckDel = n => `${n}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
function label(ua) {
  ua = ua || "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "جهاز";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "";
  return os + (br ? " · " + br : "");
}
const fmt = ts => new Date(ts).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" });
const fmtD = ts => new Date(ts).toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh", dateStyle: "medium" });
const where = (cf) => [cf && cf.city, cf && cf.country].filter(Boolean).join("، ") || "غير معروف";
const tempPass = () => { const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; const r = crypto.getRandomValues(new Uint8Array(10)); r.forEach(x => s += c[x % c.length]); return s; };

async function alertOwner(env, subject, lines) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ from: "تنبيهات الموقع <onboarding@resend.dev>", to: [env.ALERT_EMAIL], subject, text: lines.join("\n") })
    });
  } catch (e) { }
}
const ev = (env, user, kind, detail) => env.DB.prepare("INSERT INTO events(ts,user_id,email,kind,detail) VALUES(?,?,?,?,?)").bind(Date.now(), user ? user.id : null, user ? user.email : "", kind, detail || "").run();

/* ---------- الجلسات ---------- */
async function getSession(req, env, ctx) {
  const c = cookies(req);
  if (!c.sid) return { ok: false, why: "login" };
  const h = await sha(c.sid), now = Date.now();
  const r = await env.DB.prepare("SELECT s.id sid,s.did,s.last_seen sls,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?").bind(h).first();
  if (!r || now - r.sls > SESSION_DAYS * DAY) return { ok: false, why: "login" };
  if (!r.active) return { ok: false, why: "suspended" };
  if (r.expires_at < now) return { ok: false, why: "expired" };
  const dv = await env.DB.prepare("SELECT removed FROM devices WHERE user_id=? AND did=?").bind(r.id, r.did).first();
  if (!dv || dv.removed) { await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(h).run(); return { ok: false, why: "removed" }; }
  if (now - r.sls > MIN) ctx.waitUntil(touch(req, env, r, h, now));
  return { ok: true, user: r, sid: h };
}
async function touch(req, env, u, h, now) {
  const ip = req.headers.get("cf-connecting-ip") || "", iph = (await sha(ip + u.id)).slice(0, 12);
  await env.DB.batch([
    env.DB.prepare("UPDATE sessions SET last_seen=? WHERE id=?").bind(now, h),
    env.DB.prepare("UPDATE devices SET last_seen=?,iph=?,country=COALESCE(?,country),city=COALESCE(?,city) WHERE user_id=? AND did=?").bind(now, iph, (req.cf && req.cf.country) || null, (req.cf && req.cf.city) || null, u.id, u.did)
  ]);
  // استخدام متزامن من جهاز آخر بعنوان شبكة مختلف
  const other = await env.DB.prepare("SELECT id FROM devices WHERE user_id=? AND did<>? AND removed=0 AND last_seen>? AND iph IS NOT NULL AND iph<>?").bind(u.id, u.did, now - 3 * MIN, iph).first();
  if (!other) return;
  const recent = await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE user_id=? AND kind='concurrent' AND ts>?").bind(u.id, now - 30 * MIN).first();
  if (recent.n) return;
  await ev(env, u, "concurrent", "استخدام من جهازين في وقت متقارب وبشبكتين مختلفتين");
  const day = await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE user_id=? AND kind='concurrent' AND ts>?").bind(u.id, now - DAY).first();
  if (day.n >= 3 && u.warn_at < now - DAY) {
    await env.DB.prepare("UPDATE users SET warn_at=? WHERE id=?").bind(now, u.id).run();
    await alertOwner(env, "تنبيه: استخدام متزامن متكرر — " + u.email, ["الحساب: " + u.email, "تكرر الاستخدام من أجهزة في وقت متقارب 3 مرات خلال 24 ساعة.", "تم عرض تنبيه واضح للمستخدم داخل الموقع.", "الوقت: " + fmt(now)]);
  }
}

/* ---------- الواجهة البرمجية ---------- */
async function body(req) { try { return await req.json(); } catch (e) { return {}; } }
async function tooMany(env, k, max, win) {
  const r = await env.DB.prepare("SELECT COUNT(*) n FROM attempts WHERE k=? AND ts>?").bind(k, Date.now() - win).first();
  return r.n >= max;
}
const fail = (env, k) => env.DB.prepare("INSERT INTO attempts(k,ts) VALUES(?,?)").bind(k, Date.now()).run();

function adminOk(req, env) {
  const c = cookies(req).adm;
  if (!c || !env.ADMIN_PASSWORD) return Promise.resolve(false);
  const [exp, sig] = c.split(".");
  if (!exp || +exp < Date.now()) return Promise.resolve(false);
  return hmac(env, exp).then(s => same(s, sig));
}
const hmac = async (env, m) => {
  const k = await crypto.subtle.importKey("raw", enc.encode("adm|" + env.ADMIN_PASSWORD), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(m)));
};

async function api(req, env, ctx, url, p) {
  const m = req.method;
  if (m !== "GET") {
    if (!/application\/json/.test(req.headers.get("content-type") || "")) return json({ error: "bad" }, 400);
    const o = req.headers.get("origin");
    if (o && new URL(o).host !== url.host) return json({ error: "bad" }, 403);
  }
  const ip = req.headers.get("cf-connecting-ip") || "";

  if (p === "/api/login" && m === "POST") {
    const b = await body(req), email = String(b.email || "").trim().toLowerCase(), pw = String(b.password || "");
    if (!email || !pw) return json({ error: "أدخل البريد وكلمة المرور" }, 400);
    if (await tooMany(env, "u:" + email, 8, 15 * MIN) || await tooMany(env, "i:" + ip, 20, 15 * MIN))
      return json({ error: "محاولات كثيرة. انتظر 15 دقيقة ثم حاول مرة أخرى." }, 429);
    const u = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
    const okPw = u ? same(await pbkdf2(pw, u.salt), u.hash) : (await pbkdf2(pw, "x"), false);
    if (!okPw) { await fail(env, "u:" + email); await fail(env, "i:" + ip); return json({ error: "البريد أو كلمة المرور غير صحيحة" }, 401); }
    if (!u.active) return json({ error: "الحساب موقوف. تواصل مع المسؤول." }, 403);
    const now = Date.now();
    if (u.expires_at < now) return json({ error: "انتهى اشتراكك بتاريخ " + fmtD(u.expires_at) + ". تواصل مع المسؤول للتجديد." }, 403);

    const did = cookies(req).did && /^[0-9a-f]{32}$/.test(cookies(req).did) ? cookies(req).did : rand(16);
    const iph = (await sha(ip + u.id)).slice(0, 12), lb = label(req.headers.get("user-agent")), cf = req.cf || {};
    const ex = await env.DB.prepare("SELECT removed FROM devices WHERE user_id=? AND did=?").bind(u.id, did).first();
    let isNew = false, over = false, count = 0;
    if (!ex || ex.removed) {
      const c = await env.DB.prepare("SELECT COUNT(*) n FROM devices WHERE user_id=? AND removed=0 AND last_seen>? AND did<>?").bind(u.id, now - DEVICE_WINDOW, did).first();
      count = c.n + 1; isNew = true; over = count > u.max_devices;
      if (ex) await env.DB.prepare("UPDATE devices SET removed=0,label=?,country=?,city=?,iph=?,first_seen=?,last_seen=? WHERE user_id=? AND did=?").bind(lb, cf.country || null, cf.city || null, iph, now, now, u.id, did).run();
      else await env.DB.prepare("INSERT INTO devices(user_id,did,label,country,city,iph,first_seen,last_seen) VALUES(?,?,?,?,?,?,?,?)").bind(u.id, did, lb, cf.country || null, cf.city || null, iph, now, now).run();
    } else {
      await env.DB.prepare("UPDATE devices SET last_seen=?,iph=?,label=? WHERE user_id=? AND did=?").bind(now, iph, lb, u.id, did).run();
    }
    const tok = rand(32);
    await env.DB.prepare("INSERT INTO sessions(id,user_id,did,created_at,last_seen) VALUES(?,?,?,?,?)").bind(await sha(tok), u.id, did, now, now).run();
    await env.DB.prepare("DELETE FROM sessions WHERE last_seen<?").bind(now - SESSION_DAYS * DAY).run();
    await env.DB.prepare("DELETE FROM attempts WHERE ts<?").bind(now - DAY).run();
    if (isNew) {
      await ev(env, u, over ? "over_limit" : "new_device", `${lb} — ${where(cf)} — جهاز ${count} من ${u.max_devices}`);
      if (over) await env.DB.prepare("UPDATE users SET warn_at=? WHERE id=?").bind(now, u.id).run();
      ctx.waitUntil(alertOwner(env, (over ? "⚠️ تجاوز عدد الأجهزة — " : "دخول من جهاز جديد — ") + u.email, [
        "الحساب: " + u.email, "الجهاز: " + lb, "الموقع التقريبي: " + where(cf),
        `عدد الأجهزة الآن: ${count} من ${u.max_devices}` + (over ? " (تجاوز الحد)" : ""), "الوقت: " + fmt(now),
        over ? "تم عرض تنبيه واضح للمستخدم داخل الموقع." : ""
      ]));
    }
    const rs = json({ ok: true });
    rs.headers.append("set-cookie", ck("sid", tok, SESSION_DAYS));
    rs.headers.append("set-cookie", ck("did", did, 400));
    return rs;
  }

  if (p === "/api/logout" && m === "POST") {
    const c = cookies(req);
    if (c.sid) await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(await sha(c.sid)).run();
    return json({ ok: true }, 200, { "set-cookie": ckDel("sid") });
  }

  if (p === "/api/me" || p === "/api/ack" || p === "/api/password") {
    const s = await getSession(req, env, ctx);
    if (!s.ok) return json({ error: s.why }, 401);
    const u = s.user, now = Date.now();
    if (p === "/api/ack" && m === "POST") {
      const b = await body(req);
      if (b.kind === "welcome") await env.DB.prepare("UPDATE users SET welcome_ack=1 WHERE id=?").bind(u.id).run();
      else if (b.kind === "warn") await env.DB.prepare("UPDATE users SET warn_ack=? WHERE id=?").bind(u.warn_at, u.id).run();
      return json({ ok: true });
    }
    if (p === "/api/password" && m === "POST") {
      const b = await body(req), np = String(b.new || "");
      if (!same(await pbkdf2(String(b.old || ""), u.salt), u.hash)) return json({ error: "كلمة المرور الحالية غير صحيحة" }, 400);
      if (np.length < 8) return json({ error: "كلمة المرور الجديدة قصيرة (8 أحرف على الأقل)" }, 400);
      const salt = rand(16);
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET salt=?,hash=? WHERE id=?").bind(salt, await pbkdf2(np, salt), u.id),
        env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND id<>?").bind(u.id, s.sid)
      ]);
      return json({ ok: true });
    }
    const dv = (await env.DB.prepare("SELECT did,label,country,city,last_seen FROM devices WHERE user_id=? AND removed=0 AND last_seen>? ORDER BY last_seen DESC").bind(u.id, now - DEVICE_WINDOW).all()).results;
    const notice = u.warn_at > u.warn_ack ? "warn" : !u.welcome_ack ? "welcome" : null;
    return json({
      email: u.email, expires_at: u.expires_at, expires_text: fmtD(u.expires_at), days_left: Math.max(0, Math.ceil((u.expires_at - now) / DAY)),
      max_devices: u.max_devices, notice,
      devices: dv.map(d => ({ label: d.label, where: [d.city, d.country].filter(Boolean).join("، ") || "—", last: fmt(d.last_seen), current: d.did === u.did }))
    });
  }

  /* ----- المسؤول ----- */
  if (p === "/api/admin/login" && m === "POST") {
    if (!env.ADMIN_PASSWORD) return json({ error: "لم يُضبط سر ADMIN_PASSWORD" }, 500);
    if (await tooMany(env, "a:" + ip, 6, 15 * MIN)) return json({ error: "محاولات كثيرة. انتظر قليلًا." }, 429);
    const b = await body(req);
    if (!same(String(b.password || ""), env.ADMIN_PASSWORD)) { await fail(env, "a:" + ip); return json({ error: "كلمة المرور غير صحيحة" }, 401); }
    const exp = String(Date.now() + 12 * 3600e3);
    return json({ ok: true }, 200, { "set-cookie": ck("adm", exp + "." + await hmac(env, exp), 0.5) });
  }
  if (p.startsWith("/api/admin/")) {
    if (!await adminOk(req, env)) return json({ error: "auth" }, 401);
    const now = Date.now();
    if (p === "/api/admin/logout" && m === "POST") return json({ ok: true }, 200, { "set-cookie": ckDel("adm") });
    if (p === "/api/admin/users" && m === "GET") {
      const rows = (await env.DB.prepare(`SELECT u.id,u.email,u.name,u.note,u.expires_at,u.active,u.max_devices,u.warn_at,u.warn_ack,
        (SELECT COUNT(*) FROM devices d WHERE d.user_id=u.id AND d.removed=0 AND d.last_seen>?) devs,
        (SELECT MAX(last_seen) FROM devices d WHERE d.user_id=u.id) last_seen,
        (SELECT COUNT(*) FROM events e WHERE e.user_id=u.id AND e.kind IN('over_limit','concurrent') AND e.ts>?) flags
        FROM users u ORDER BY u.id DESC`).bind(now - DEVICE_WINDOW, now - 7 * DAY).all()).results;
      return json({
        now, users: rows.map(r => ({ ...r, expires_text: fmtD(r.expires_at), days_left: Math.ceil((r.expires_at - now) / DAY), last_text: r.last_seen ? fmt(r.last_seen) : "—", warned: r.warn_at > r.warn_ack })),
        mailer: !!(env.RESEND_API_KEY && env.ALERT_EMAIL)
      });
    }
    if (p === "/api/admin/events" && m === "GET") {
      const rows = (await env.DB.prepare("SELECT ts,email,kind,detail FROM events ORDER BY id DESC LIMIT 150").all()).results;
      return json({ events: rows.map(r => ({ ...r, text: fmt(r.ts) })) });
    }
    if (p === "/api/admin/user" && m === "POST") {
      const b = await body(req), email = String(b.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "البريد غير صالح" }, 400);
      const days = Math.max(1, Math.min(3660, +b.days || 30)), pw = String(b.password || "").trim() || tempPass(), salt = rand(16);
      try {
        await env.DB.prepare("INSERT INTO users(email,name,salt,hash,expires_at,max_devices,created_at,note) VALUES(?,?,?,?,?,?,?,?)")
          .bind(email, String(b.name || "").trim(), salt, await pbkdf2(pw, salt), now + days * DAY, Math.max(1, Math.min(10, +b.max_devices || 3)), now, String(b.note || "").trim()).run();
      } catch (e) { return json({ error: "هذا البريد مسجّل مسبقًا" }, 409); }
      return json({ ok: true, email, password: pw });
    }
    const mm = p.match(/^\/api\/admin\/user\/(\d+)\/(extend|suspend|activate|reset|delete|revoke|device|note)$/);
    if (mm && m === "POST") {
      const id = +mm[1], act = mm[2], b = await body(req);
      const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first();
      if (!u) return json({ error: "غير موجود" }, 404);
      if (act === "extend") {
        const d = Math.max(1, Math.min(3660, +b.days || 30)), base = Math.max(now, u.expires_at);
        await env.DB.prepare("UPDATE users SET expires_at=?,active=1 WHERE id=?").bind(base + d * DAY, id).run();
        await ev(env, u, "extend", "تمديد " + d + " يوم");
      } else if (act === "suspend") {
        await env.DB.batch([env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(id), env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id)]);
        await ev(env, u, "suspend", "");
      } else if (act === "activate") {
        await env.DB.prepare("UPDATE users SET active=1 WHERE id=?").bind(id).run();
      } else if (act === "reset") {
        const pw = tempPass(), salt = rand(16);
        await env.DB.batch([env.DB.prepare("UPDATE users SET salt=?,hash=? WHERE id=?").bind(salt, await pbkdf2(pw, salt), id), env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id)]);
        return json({ ok: true, password: pw });
      } else if (act === "delete") {
        await env.DB.batch(["sessions", "devices"].map(t => env.DB.prepare(`DELETE FROM ${t} WHERE user_id=?`).bind(id)).concat(env.DB.prepare("DELETE FROM users WHERE id=?").bind(id)));
      } else if (act === "revoke") {
        await env.DB.batch([env.DB.prepare("UPDATE devices SET removed=1 WHERE user_id=?").bind(id), env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id), env.DB.prepare("UPDATE users SET warn_ack=warn_at WHERE id=?").bind(id)]);
        await ev(env, u, "revoke", "أُزيلت كل الأجهزة");
      } else if (act === "device") {
        await env.DB.batch([env.DB.prepare("UPDATE devices SET removed=1 WHERE user_id=? AND id=?").bind(id, +b.device), env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND did=(SELECT did FROM devices WHERE id=?)").bind(id, +b.device)]);
      } else if (act === "note") {
        await env.DB.prepare("UPDATE users SET note=?,max_devices=? WHERE id=?").bind(String(b.note || ""), Math.max(1, Math.min(10, +b.max_devices || u.max_devices)), id).run();
      }
      return json({ ok: true });
    }
    const dm = p.match(/^\/api\/admin\/user\/(\d+)\/devices$/);
    if (dm && m === "GET") {
      const rows = (await env.DB.prepare("SELECT id,label,country,city,first_seen,last_seen FROM devices WHERE user_id=? AND removed=0 ORDER BY last_seen DESC").bind(+dm[1]).all()).results;
      return json({ devices: rows.map(d => ({ id: d.id, label: d.label, where: [d.city, d.country].filter(Boolean).join("، ") || "—", first: fmt(d.first_seen), last: fmt(d.last_seen) })) });
    }
    return json({ error: "غير موجود" }, 404);
  }
  return json({ error: "غير موجود" }, 404);
}

/* ---------- سكربت الشريط الصغير والتنبيهات داخل الصفحات ---------- */
const ACCT_JS = `(function(){
var s=document.createElement("style");
s.textContent=".gate-bar,.gate-note{font-family:Tajawal,Tahoma,Arial,sans-serif;direction:rtl}.gate-bar{position:fixed;left:12px;bottom:12px;z-index:9998;background:#17445a;color:#fff;border-radius:99px;padding:6px 14px;font-size:13px;display:flex;gap:12px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.25)}.gate-bar a,.gate-bar button{color:#fff;background:none;border:0;font:inherit;cursor:pointer;text-decoration:none;padding:0}.gate-bar a:hover,.gate-bar button:hover{text-decoration:underline}.gate-note{position:fixed;top:0;left:0;right:0;z-index:9999;padding:12px 16px;font-size:14px;line-height:1.7;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center}.gate-note.w{background:#b42318;color:#fff}.gate-note.i{background:#fff4d6;color:#4a3500;border-bottom:2px solid #e0b100}.gate-note button{background:#fff;color:#17445a;border:0;border-radius:8px;padding:6px 16px;font:inherit;font-weight:700;cursor:pointer}@media print{.gate-bar,.gate-note{display:none!important}}";
document.head.appendChild(s);
fetch("/api/me",{credentials:"same-origin"}).then(function(r){return r.ok?r.json():null}).then(function(m){
if(!m)return;
var bar=document.createElement("div");bar.className="gate-bar";bar.setAttribute("data-html2canvas-ignore","true");
bar.innerHTML='<a href="/account">حسابي</a><button type="button" id="gateOut">خروج</button>';
document.body.appendChild(bar);
document.getElementById("gateOut").onclick=function(){fetch("/api/logout",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(function(){location.href="/login"})};
function note(cls,text,kind){var n=document.createElement("div");n.className="gate-note "+cls;n.setAttribute("data-html2canvas-ignore","true");var t=document.createElement("span");t.textContent=text;n.appendChild(t);
if(kind){var b=document.createElement("button");b.type="button";b.textContent="فهمت";b.onclick=function(){fetch("/api/ack",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind:kind})});n.remove()};n.appendChild(b)}
document.body.appendChild(n)}
if(m.notice==="warn")note("w","تنبيه: لاحظنا استخدام حسابك من أكثر من "+m.max_devices+" أجهزة. الاشتراك شخصي ولا تجوز مشاركته، وتكرار ذلك قد يؤدي إلى إيقاف الحساب.","warn");
else if(m.notice==="welcome")note("i","مرحبًا بك. الاشتراك شخصي ولا تجوز مشاركته، ويُسمح بتسجيل الدخول من "+m.max_devices+" أجهزة كحد أقصى. سنُنبّهك إن تجاوز حسابك هذا الحد.","welcome");
else if(m.days_left<=3)note("i","ينتهي اشتراكك خلال "+m.days_left+" أيام ("+m.expires_text+"). تواصل مع المسؤول للتجديد.",null);
}).catch(function(){});
})();`;

/* ---------- المعالج الرئيسي ---------- */
const NOSTORE = { "cache-control": "no-store" };
function page(res, extra) {
  const h = new Headers(res.headers);
  h.set("cache-control", "no-store");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "same-origin");
  const r = new Response(res.body, { status: res.status, headers: h });
  if (extra && (h.get("content-type") || "").includes("text/html"))
    return new HTMLRewriter().on("body", { element(e) { e.append('<script src="/_acct.js" defer></script>', { html: true }); } }).transform(r);
  return r;
}

export default {
  async fetch(req, env, ctx) {
    try {
      if (!env.DB || !env.ADMIN_PASSWORD)
        return new Response("<meta charset=utf-8><body dir=rtl style='font-family:sans-serif;padding:30px'><h2>الموقع قيد الإعداد</h2><p>لم يكتمل ربط قاعدة البيانات أو ضبط كلمة مرور المسؤول (ADMIN_PASSWORD).</p>", { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
      await init(env);
      const url = new URL(req.url);
      let p = url.pathname.replace(/\/+$/, "") || "/";
      if (p.startsWith("/api/")) return await api(req, env, ctx, url, p);
      if (p === "/_acct.js") return new Response(ACCT_JS, { headers: { "content-type": "application/javascript; charset=utf-8", ...NOSTORE } });

      const isFile = /\.[a-z0-9]+$/i.test(p) && !/\.html$/i.test(p);
      const name = p.replace(/\.html$/i, "");
      const target = isFile ? p : (name === "/" ? "/index" : name) + ".html";
      const open = !isFile && (name === "/login" || name === "/admin" || name === "/terms");
      if (open) return page(await env.ASSETS.fetch(new Request(new URL(target, url), req)), false);

      const s = await getSession(req, env, ctx);
      if (!s.ok) {
        const to = new URL("/login", url);
        if (s.why !== "login") to.searchParams.set("r", s.why);
        if (!isFile && name !== "/") to.searchParams.set("next", name.replace(/^\//, "") + ".html");
        return Response.redirect(to.toString(), 302);
      }
      const res = await env.ASSETS.fetch(new Request(new URL(target, url), req));
      return page(res, !isFile && name !== "/account");
    } catch (e) {
      return new Response("حدث خطأ مؤقت. حاول مرة أخرى.", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  }
};
