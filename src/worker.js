// بوابة الاشتراك: تحمي صفحات الموقع وتدير الحسابات والأجهزة.
// الإعدادات المطلوبة: ربط قاعدة D1 باسم DB، وسر ADMIN_PASSWORD.
// اختياري للتنبيهات بالإيميل: RESEND_API_KEY و ALERT_EMAIL.

const DAY = 864e5, MIN = 6e4;
const REMOVE_LIMIT = 1;
const TRIAL_DAYS = 3, TRIAL_NOTE = "تجربة";
const PLAN_DAYS = { m1: 30, m6: 180 };
const PLAN_NAME = { m1: "شهر واحد", m6: "6 أشهر" };
const okEmail = e => e.length <= 120 && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e);
const DV = n => n === 1 ? "جهاز واحد" : n === 2 ? "جهازين" : n + " أجهزة";
const SESSION_DAYS = 30, DEVICE_WINDOW = 30 * DAY;
const enc = new TextEncoder();

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,name TEXT DEFAULT '',salt TEXT NOT NULL,hash TEXT NOT NULL,expires_at INTEGER NOT NULL,active INTEGER DEFAULT 1,max_devices INTEGER DEFAULT 3,created_at INTEGER NOT NULL,welcome_ack INTEGER DEFAULT 0,warn_at INTEGER DEFAULT 0,warn_ack INTEGER DEFAULT 0,note TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,did TEXT NOT NULL,created_at INTEGER,last_seen INTEGER)`,
  `CREATE TABLE IF NOT EXISTS devices(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,did TEXT NOT NULL,label TEXT,country TEXT,city TEXT,iph TEXT,first_seen INTEGER,last_seen INTEGER,removed INTEGER DEFAULT 0,UNIQUE(user_id,did))`,
  `CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER,user_id INTEGER,email TEXT,kind TEXT,detail TEXT)`,
  `CREATE TABLE IF NOT EXISTS attempts(k TEXT,ts INTEGER)`,
  `CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT,user_id INTEGER,email TEXT NOT NULL,name TEXT DEFAULT '',salt TEXT,hash TEXT,plan TEXT,ref TEXT DEFAULT '',status TEXT DEFAULT 'pending',created_at INTEGER,decided_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS codes(email TEXT PRIMARY KEY,h TEXT,exp INTEGER,tries INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS resets(h TEXT PRIMARY KEY,user_id INTEGER,exp INTEGER)`,
  `CREATE TABLE IF NOT EXISTS trials(email TEXT PRIMARY KEY,ts INTEGER,iph TEXT)`,
  `CREATE TABLE IF NOT EXISTS reminders(user_id INTEGER,expires_at INTEGER,PRIMARY KEY(user_id,expires_at))`
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

async function sendMail(env, subject, text, to, html) {
  const o = { from: env.MAIL_FROM || "Site Alerts <onboarding@resend.dev>", to: [to || env.ALERT_EMAIL], subject, text };
  if (html) o.html = html;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(o)
  });
  return { status: r.status, body: (await r.text()).slice(0, 300) };
}
const escH = x => String(x).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function mailHtml(lines, link) {
  return '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:16px;line-height:1.9;color:#16242f;max-width:520px">' +
    lines.map(l => '<p style="margin:0 0 10px">' + escH(l) + "</p>").join("") +
    (link ? '<p><a href="' + escH(link.url) + '" style="display:inline-block;background:#00682f;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700">' + escH(link.text) + "</a></p>" : "") +
    '<p style="color:#5b6b78;font-size:13px;margin-top:18px">مُيَسِّر — نماذج وتقارير مدرسية</p></div>';
}
// إيميل إلى مشترك (يتطلب دومينًا موثّقًا في MAIL_FROM)
async function mailUser(env, to, subject, lines, link) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return { ok: false };
  try {
    const r = await sendMail(env, subject, lines.join("\n") + (link ? "\n" + link.url : ""), to, mailHtml(lines, link));
    if (r.status >= 300) { await ev(env, null, "mail_error", "فشل إرسال إيميل إلى " + to + " (" + r.status + "): " + r.body); return { ok: false }; }
    return { ok: true };
  } catch (e) { try { await ev(env, null, "mail_error", "فشل إرسال إيميل إلى " + to + ": " + String(e).slice(0, 150)); } catch (_) { } return { ok: false }; }
}
const siteUrl = (env, url) => (env.SITE_URL || (url && url.origin) || "https://app.muyassir.org").replace(/\/+$/, "");
async function alertOwner(env, subject, lines) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) return;
  try {
    const r = await sendMail(env, subject, lines.join("\n"));
    if (r.status >= 300) await ev(env, null, "mail_error", "فشل إرسال الإيميل (" + r.status + "): " + r.body);
  } catch (e) { try { await ev(env, null, "mail_error", "فشل إرسال الإيميل: " + String(e).slice(0, 200)); } catch (_) { } }
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

  /* ----- طلبات الاشتراك الذاتية ----- */
  if (p === "/api/signup/code" && m === "POST") {
    const b = await body(req), email = String(b.email || "").trim().toLowerCase();
    if (!okEmail(email)) return json({ error: "البريد غير صالح" }, 400);
    if (!env.RESEND_API_KEY || !env.MAIL_FROM) return json({ error: "خدمة التحقق غير متاحة حاليًا. تواصل معنا عبر واتساب." }, 503);
    if (await tooMany(env, "sc:" + email, 3, 60 * MIN) || await tooMany(env, "si:" + ip, 10, 60 * MIN)) return json({ error: "طلبات كثيرة. حاول بعد قليل." }, 429);
    await fail(env, "sc:" + email); await fail(env, "si:" + ip);
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    await env.DB.prepare("INSERT OR REPLACE INTO codes(email,h,exp,tries) VALUES(?,?,?,0)").bind(email, await sha(code + "|" + email), Date.now() + 10 * MIN).run();
    const r = await mailUser(env, email, "رمز التحقق من بريدك", ["رمز التحقق الخاص بك: " + code, "الرمز صالح لمدة 10 دقائق. إن لم تطلبه فتجاهل هذه الرسالة."]);
    if (!r.ok) return json({ error: "تعذّر إرسال الرمز. تأكد من البريد وحاول مرة أخرى." }, 502);
    return json({ ok: true });
  }
  if (p === "/api/signup" && m === "POST") {
    const b = await body(req), now = Date.now(), email = String(b.email || "").trim().toLowerCase(),
      name = String(b.name || "").trim().slice(0, 60), pw = String(b.password || ""), plan = PLAN_DAYS[b.plan] ? b.plan : null,
      ref = String(b.ref || "").trim().slice(0, 80), code = String(b.code || "").trim();
    if (!okEmail(email) || !plan) return json({ error: "أكمل الحقول بشكل صحيح" }, 400);
    if (await tooMany(env, "ss:" + ip, 8, 60 * MIN)) return json({ error: "طلبات كثيرة. حاول بعد قليل." }, 429);
    const c = await env.DB.prepare("SELECT * FROM codes WHERE email=?").bind(email).first();
    if (!c || c.exp < now || c.tries >= 5) return json({ error: "رمز التحقق منتهٍ أو غير موجود. اطلب رمزًا جديدًا." }, 400);
    if (!same(await sha(code + "|" + email), c.h)) {
      await env.DB.prepare("UPDATE codes SET tries=tries+1 WHERE email=?").bind(email).run(); await fail(env, "ss:" + ip);
      return json({ error: "رمز التحقق غير صحيح" }, 400);
    }
    const ex = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
    if (!ex && (name.length < 2 || pw.length < 8 || pw.length > 100)) return json({ error: "اكتب اسمك، وكلمة مرور من 8 أحرف على الأقل" }, 400);
    await env.DB.prepare("DELETE FROM codes WHERE email=?").bind(email).run();
    await fail(env, "ss:" + ip);
    if (ex) {
      // بريد لديه حساب: يُعامل الطلب كتجديد (تحقّق ملكية البريد بالرمز)
      const old = await env.DB.prepare("SELECT id FROM requests WHERE user_id=? AND kind='renew' AND status='pending'").bind(ex.id).first();
      if (old) await env.DB.prepare("UPDATE requests SET plan=?,ref=?,created_at=? WHERE id=?").bind(plan, ref, now, old.id).run();
      else await env.DB.prepare("INSERT INTO requests(kind,user_id,email,name,plan,ref,created_at) VALUES('renew',?,?,?,?,?,?)").bind(ex.id, ex.email, ex.name || "", plan, ref, now).run();
      await ev(env, ex, "renew_request", PLAN_NAME[plan] + (ref ? " — مرجع: " + ref : ""));
    } else {
      const salt = rand(16), hash = await pbkdf2(pw, salt);
      const old = await env.DB.prepare("SELECT id FROM requests WHERE email=? AND kind='new' AND status='pending'").bind(email).first();
      if (old) await env.DB.prepare("UPDATE requests SET name=?,salt=?,hash=?,plan=?,ref=?,created_at=? WHERE id=?").bind(name, salt, hash, plan, ref, now, old.id).run();
      else await env.DB.prepare("INSERT INTO requests(kind,email,name,salt,hash,plan,ref,created_at) VALUES('new',?,?,?,?,?,?,?)").bind(email, name, salt, hash, plan, ref, now).run();
      await ev(env, { id: null, email }, "signup_request", name + " — " + PLAN_NAME[plan] + (ref ? " — مرجع: " + ref : ""));
    }
    ctx.waitUntil(alertOwner(env, (ex ? "طلب تجديد اشتراك — " : "طلب اشتراك جديد — ") + email, [
      "البريد: " + email + " (تم التحقق منه)", ex ? "" : "الاسم: " + name, "الباقة: " + PLAN_NAME[plan], "مرجع التحويل: " + (ref || "—"),
      "افتح لوحة المسؤول للقبول بعد التأكد من وصول المبلغ.", "الوقت: " + fmt(now)
    ]));
    return json({ ok: true });
  }

  if (p === "/api/trial" && m === "POST") {
    return json({ error: "التجربة المجانية غير متاحة. يمكنك تجربة النماذج بعلامة مائية من صفحة المعرض." }, 404);
    const b = await body(req), now = Date.now(), email = String(b.email || "").trim().toLowerCase(),
      name = String(b.name || "").trim().slice(0, 60), pw = String(b.password || ""), code = String(b.code || "").trim();
    if (!okEmail(email) || name.length < 2 || pw.length < 8 || pw.length > 100) return json({ error: "اكتب اسمك وبريدك، وكلمة مرور من 8 أحرف على الأقل" }, 400);
    if (await tooMany(env, "ss:" + ip, 8, 60 * MIN)) return json({ error: "طلبات كثيرة. حاول بعد قليل." }, 429);
    const c = await env.DB.prepare("SELECT * FROM codes WHERE email=?").bind(email).first();
    if (!c || c.exp < now || c.tries >= 5) return json({ error: "رمز التحقق منتهٍ أو غير موجود. اطلب رمزًا جديدًا." }, 400);
    if (!same(await sha(code + "|" + email), c.h)) {
      await env.DB.prepare("UPDATE codes SET tries=tries+1 WHERE email=?").bind(email).run(); await fail(env, "ss:" + ip);
      return json({ error: "رمز التحقق غير صحيح" }, 400);
    }
    if (await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first()) return json({ error: "هذا البريد لديه حساب بالفعل. سجّل الدخول، أو استعد كلمة المرور إن نسيتها." }, 409);
    if (await env.DB.prepare("SELECT email FROM trials WHERE email=?").bind(email).first()) return json({ error: "استُخدمت التجربة المجانية لهذا البريد من قبل. يمكنك الاشتراك من الأعلى." }, 409);
    const iph = (await sha(ip + "|trial")).slice(0, 16);
    const used = await env.DB.prepare("SELECT COUNT(*) n FROM trials WHERE iph=? AND ts>?").bind(iph, now - 30 * DAY).first();
    if (used.n >= 3) return json({ error: "تعذّر بدء تجربة جديدة من هذه الشبكة. يمكنك الاشتراك أو التواصل معنا." }, 429);
    await env.DB.prepare("DELETE FROM codes WHERE email=?").bind(email).run();
    await fail(env, "ss:" + ip);
    const salt = rand(16);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO trials(email,ts,iph) VALUES(?,?,?)").bind(email, now, iph),
      env.DB.prepare("INSERT INTO users(email,name,salt,hash,expires_at,max_devices,created_at,note) VALUES(?,?,?,?,?,?,?,?)").bind(email, name, salt, await pbkdf2(pw, salt), now + TRIAL_DAYS * DAY, 1, now, TRIAL_NOTE)
    ]);
    await ev(env, { id: null, email }, "trial_start", name + " — تجربة مجانية " + TRIAL_DAYS + " أيام");
    return json({ ok: true });
  }

  /* ----- استعادة كلمة المرور ----- */
  if (p === "/api/forgot" && m === "POST") {
    const b = await body(req), email = String(b.email || "").trim().toLowerCase();
    if (!okEmail(email)) return json({ ok: true });
    if (await tooMany(env, "fp:" + email, 3, 60 * MIN) || await tooMany(env, "fi:" + ip, 10, 60 * MIN)) return json({ error: "طلبات كثيرة. حاول بعد قليل." }, 429);
    await fail(env, "fp:" + email); await fail(env, "fi:" + ip);
    const u = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
    if (u && env.RESEND_API_KEY && env.MAIL_FROM) {
      const tok = rand(32);
      await env.DB.prepare("INSERT INTO resets(h,user_id,exp) VALUES(?,?,?)").bind(await sha(tok), u.id, Date.now() + 60 * MIN).run();
      await ev(env, u, "password_reset_request", "طُلب رابط استعادة كلمة المرور");
      ctx.waitUntil(mailUser(env, email, "استعادة كلمة المرور", ["وصلنا طلب لتعيين كلمة مرور جديدة لحسابك.", "الرابط صالح لمدة ساعة ويُستخدم مرة واحدة. إن لم تطلبه فتجاهل هذه الرسالة."], { url: siteUrl(env, url) + "/reset?t=" + tok, text: "تعيين كلمة مرور جديدة" }));
    }
    return json({ ok: true });
  }
  if (p === "/api/reset" && m === "POST") {
    const b = await body(req), tok = String(b.token || ""), pw = String(b.password || "");
    if (await tooMany(env, "ri:" + ip, 10, 60 * MIN)) return json({ error: "محاولات كثيرة. حاول لاحقًا." }, 429);
    if (pw.length < 8 || pw.length > 100) return json({ error: "كلمة المرور 8 أحرف على الأقل" }, 400);
    const r = /^[0-9a-f]{64}$/.test(tok) ? await env.DB.prepare("SELECT * FROM resets WHERE h=?").bind(await sha(tok)).first() : null;
    if (!r || r.exp < Date.now()) { await fail(env, "ri:" + ip); return json({ error: "الرابط غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا." }, 400); }
    const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(r.user_id).first();
    if (!u) return json({ error: "الرابط غير صالح" }, 400);
    const salt = rand(16);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET salt=?,hash=? WHERE id=?").bind(salt, await pbkdf2(pw, salt), u.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.id),
      env.DB.prepare("DELETE FROM resets WHERE user_id=?").bind(u.id)
    ]);
    await ev(env, u, "password_reset", "غُيّرت كلمة المرور عبر رابط الاستعادة");
    return json({ ok: true });
  }

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
      if (over) {
        const recent = await env.DB.prepare("SELECT id FROM events WHERE user_id=? AND kind='blocked' AND ts>?").bind(u.id, now - 60 * MIN).first();
        await ev(env, u, "blocked", `${lb} — ${where(cf)} — مرفوض: الحد ${u.max_devices} أجهزة`);
        await env.DB.prepare("UPDATE users SET warn_at=? WHERE id=?").bind(now, u.id).run();
        if (!recent) ctx.waitUntil(alertOwner(env, "⛔ تم رفض جهاز جديد — " + u.email, [
          "الحساب: " + u.email, "الجهاز المرفوض: " + lb, "الموقع التقريبي: " + where(cf),
          "الأجهزة المسجلة: " + (count - 1) + " من " + u.max_devices, "الوقت: " + fmt(now),
          "هذا مؤشر محتمل على مشاركة الحساب."
        ]));
        return json({ error: "وصل حسابك إلى الحد الأقصى (" + DV(u.max_devices) + "). ادخل من أحد أجهزتك المسجلة ثم افتح «حسابي» واحذف جهازًا، وبعدها سجّل الدخول هنا. الاشتراك شخصي ولا تجوز مشاركته." }, 403);
      }
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

  if (p === "/api/me" || p === "/api/ack" || p === "/api/password" || p === "/api/device" || p === "/api/renew") {
    const s = await getSession(req, env, ctx);
    if (!s.ok) return json({ error: s.why }, 401);
    const u = s.user, now = Date.now();
    if (p === "/api/ack" && m === "POST") {
      const b = await body(req);
      if (b.kind === "welcome") await env.DB.prepare("UPDATE users SET welcome_ack=1 WHERE id=?").bind(u.id).run();
      else if (b.kind === "warn") await env.DB.prepare("UPDATE users SET warn_ack=? WHERE id=?").bind(u.warn_at, u.id).run();
      return json({ ok: true });
    }
    if (p === "/api/renew" && m === "POST") {
      const b = await body(req), plan = PLAN_DAYS[b.plan] ? b.plan : null, ref = String(b.ref || "").trim().slice(0, 80);
      if (!plan) return json({ error: "اختر الباقة" }, 400);
      if (await tooMany(env, "rn:" + u.id, 5, 60 * MIN)) return json({ error: "طلبات كثيرة. حاول لاحقًا." }, 429);
      await fail(env, "rn:" + u.id);
      const old = await env.DB.prepare("SELECT id FROM requests WHERE user_id=? AND kind='renew' AND status='pending'").bind(u.id).first();
      if (old) await env.DB.prepare("UPDATE requests SET plan=?,ref=?,created_at=? WHERE id=?").bind(plan, ref, now, old.id).run();
      else await env.DB.prepare("INSERT INTO requests(kind,user_id,email,name,plan,ref,created_at) VALUES('renew',?,?,?,?,?,?)").bind(u.id, u.email, u.name || "", plan, ref, now).run();
      await ev(env, u, "renew_request", PLAN_NAME[plan] + (ref ? " — مرجع: " + ref : ""));
      ctx.waitUntil(alertOwner(env, "طلب تجديد اشتراك — " + u.email, ["المشترك: " + u.email, "الباقة: " + PLAN_NAME[plan], "مرجع التحويل: " + (ref || "—"), "افتح لوحة المسؤول للقبول بعد التأكد من وصول المبلغ.", "الوقت: " + fmt(now)]));
      return json({ ok: true });
    }
    if (p === "/api/device" && m === "POST") {
      const b = await body(req), d = String(b.did || "");
      if (!/^[0-9a-f]{32}$/.test(d) || d === u.did) return json({ error: "لا يمكن حذف هذا الجهاز" }, 400);
      const used = (await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE user_id=? AND kind='user_remove' AND ts>?").bind(u.id, now - 30 * DAY).first()).n;
      if (used >= REMOVE_LIMIT) return json({ error: "وصلت إلى حد حذف الأجهزة (حذف جهاز واحد كل 30 يومًا). تواصل مع المسؤول لتغيير جهازك." }, 429);
      const tg = await env.DB.prepare("SELECT label,city,country FROM devices WHERE user_id=? AND did=?").bind(u.id, d).first();
      await env.DB.batch([env.DB.prepare("UPDATE devices SET removed=1 WHERE user_id=? AND did=?").bind(u.id, d), env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND did=?").bind(u.id, d)]);
      await ev(env, u, "user_remove", "حذف المستخدم جهازًا: " + (tg ? tg.label : "") + " (" + (used + 1) + " من " + REMOVE_LIMIT + ")");
      ctx.waitUntil(alertOwner(env, (used + 1 >= REMOVE_LIMIT ? "⚠️ " : "") + "مشترك حذف جهازًا — " + u.email, [
        "الحساب: " + u.email, "الجهاز المحذوف: " + (tg ? tg.label + " — " + [tg.city, tg.country].filter(Boolean).join("، ") : "—"),
        "عمليات الحذف خلال 30 يومًا: " + (used + 1) + " من " + REMOVE_LIMIT,
        used + 1 >= REMOVE_LIMIT ? "بلغ الحد، ولن يستطيع الحذف مجددًا حتى يتواصل معك. قد يكون هذا مؤشر مشاركة." : "", "الوقت: " + fmt(now)
      ]));
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
      max_devices: u.max_devices, notice, trial: u.note === TRIAL_NOTE,
      devices: dv.map(d => ({ did: d.did, label: d.label, where: [d.city, d.country].filter(Boolean).join("، ") || "—", last: fmt(d.last_seen), current: d.did === u.did }))
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
    if (p === "/api/admin/requests" && m === "GET") {
      const rows = (await env.DB.prepare("SELECT id,kind,email,name,plan,ref,created_at FROM requests WHERE status='pending' ORDER BY id ASC").all()).results;
      return json({ requests: rows.map(r => ({ ...r, plan_name: PLAN_NAME[r.plan] || r.plan, days: PLAN_DAYS[r.plan] || 30, text: fmt(r.created_at) })) });
    }
    const rq = p.match(/^\/api\/admin\/request\/(\d+)\/(approve|reject)$/);
    if (rq && m === "POST") {
      const r = await env.DB.prepare("SELECT * FROM requests WHERE id=? AND status='pending'").bind(+rq[1]).first();
      if (!r) return json({ error: "الطلب غير موجود أو تمت معالجته" }, 404);
      const b = await body(req), site = siteUrl(env, new URL(req.url));
      if (rq[2] === "reject") {
        await env.DB.prepare("UPDATE requests SET status='rejected',decided_at=? WHERE id=?").bind(now, r.id).run();
        await ev(env, { id: r.user_id || null, email: r.email }, "signup_rejected", "رُفض الطلب");
        const reason = String(b.reason || "").trim().slice(0, 200);
        await mailUser(env, r.email, "بخصوص طلب اشتراكك", ["لم نتمكن من تأكيد طلب اشتراكك." + (reason ? " السبب: " + reason : ""), "إن كنت قد حوّلت المبلغ فتواصل معنا عبر واتساب مع إيصال التحويل."]);
        return json({ ok: true });
      }
      const days = Math.max(1, Math.min(3660, +b.days || PLAN_DAYS[r.plan] || 30));
      if (r.kind === "renew") {
        const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(r.user_id).first();
        if (!u) return json({ error: "الحساب غير موجود" }, 404);
        const exp = Math.max(now, u.expires_at) + days * DAY;
        await env.DB.prepare("UPDATE users SET expires_at=?,active=1,max_devices=CASE WHEN note=? AND max_devices<2 THEN 2 ELSE max_devices END,note=CASE WHEN note=? THEN '' ELSE note END WHERE id=?").bind(exp, TRIAL_NOTE, TRIAL_NOTE, u.id).run();
        await env.DB.prepare("UPDATE requests SET status='approved',decided_at=? WHERE id=?").bind(now, r.id).run();
        await ev(env, u, "signup_approved", "قُبل التجديد " + days + " يوم");
        await mailUser(env, u.email, "تم تجديد اشتراكك", ["تم تجديد اشتراكك في مُيَسِّر حتى " + fmtD(exp) + "."], { url: site + "/", text: "فتح الموقع" });
        return json({ ok: true });
      }
      const maxd = Math.max(1, Math.min(10, +b.max_devices || 2));
      try {
        await env.DB.prepare("INSERT INTO users(email,name,salt,hash,expires_at,max_devices,created_at) VALUES(?,?,?,?,?,?,?)").bind(r.email, r.name || "", r.salt, r.hash, now + days * DAY, maxd, now).run();
      } catch (e) { return json({ error: "هذا البريد لديه حساب بالفعل" }, 409); }
      await env.DB.prepare("UPDATE requests SET status='approved',decided_at=? WHERE id=?").bind(now, r.id).run();
      await ev(env, { id: null, email: r.email }, "signup_approved", "قُبل الاشتراك " + days + " يوم");
      await mailUser(env, r.email, "تم تفعيل اشتراكك", ["أهلًا " + (r.name || "") + "، تم تفعيل اشتراكك في مُيَسِّر لمدة " + days + " يومًا.", "سجّل الدخول بالبريد وكلمة المرور التي اخترتها عند التسجيل.", "ملاحظة: الاشتراك شخصي، ويُسمح بالدخول من " + DV(maxd) + "."], { url: site + "/login", text: "تسجيل الدخول" });
      return json({ ok: true });
    }
    if (p === "/api/admin/users" && m === "GET") {
      const rows = (await env.DB.prepare(`SELECT u.id,u.email,u.name,u.note,u.expires_at,u.active,u.max_devices,u.warn_at,u.warn_ack,
        (SELECT COUNT(*) FROM devices d WHERE d.user_id=u.id AND d.removed=0 AND d.last_seen>?) devs,
        (SELECT MAX(last_seen) FROM devices d WHERE d.user_id=u.id) last_seen,
        (SELECT COUNT(*) FROM events e WHERE e.user_id=u.id AND e.kind IN('over_limit','concurrent','blocked') AND e.ts>?) flags
        FROM users u ORDER BY u.id DESC`).bind(now - DEVICE_WINDOW, now - 7 * DAY).all()).results;
      const cg = (await env.DB.prepare("SELECT user_id,city,country FROM devices WHERE removed=0 AND last_seen>? AND (city IS NOT NULL OR country IS NOT NULL)").bind(now - 7 * DAY).all()).results, cs = {};
      for (const c of cg) (cs[c.user_id] = cs[c.user_id] || new Set()).add((c.city || "") + "|" + (c.country || ""));
      return json({
        now, users: rows.map(r => ({ ...r, cities: cs[r.id] ? cs[r.id].size : 0, expires_text: fmtD(r.expires_at), days_left: Math.ceil((r.expires_at - now) / DAY), last_text: r.last_seen ? fmt(r.last_seen) : "—", warned: r.warn_at > r.warn_ack })),
        mailer: !!(env.RESEND_API_KEY && env.ALERT_EMAIL)
      });
    }
    if (p === "/api/admin/testmail" && m === "POST") {
      if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) return json({ error: "التنبيهات غير مفعّلة" }, 400);
      try { const r = await sendMail(env, "اختبار التنبيهات", "إذا وصلتك هذه الرسالة فالتنبيهات تعمل.\n" + fmt(now)); return json({ ok: r.status < 300, status: r.status, detail: r.body }); }
      catch (e) { return json({ ok: false, detail: String(e).slice(0, 200) }); }
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
          .bind(email, String(b.name || "").trim(), salt, await pbkdf2(pw, salt), now + days * DAY, Math.max(1, Math.min(10, +b.max_devices || 2)), now, String(b.note || "").trim()).run();
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
        await env.DB.prepare("UPDATE users SET note=?,max_devices=? WHERE id=?").bind(b.note === undefined ? (u.note || "") : String(b.note), Math.max(1, Math.min(10, +b.max_devices || u.max_devices)), id).run();
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
function DVf(n){return n===1?"جهاز واحد":n===2?"جهازين":n+" أجهزة"}
var s=document.createElement("style");
s.textContent=".gate-bar,.gate-note{font-family:Tajawal,Tahoma,Arial,sans-serif;direction:rtl}.gate-bar{position:fixed;left:12px;bottom:12px;z-index:9998;background:#17445a;color:#fff;border-radius:99px;padding:6px 14px;font-size:13px;display:flex;gap:12px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.25)}.gate-bar a,.gate-bar button{color:#fff;background:none;border:0;font:inherit;cursor:pointer;text-decoration:none;padding:0}.gate-bar a:hover,.gate-bar button:hover{text-decoration:underline}.gate-note{position:fixed;top:0;left:0;right:0;z-index:9999;padding:12px 16px;font-size:14px;line-height:1.7;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center}.gate-note.w{background:#b42318;color:#fff}.gate-note.i{background:#fff4d6;color:#4a3500;border-bottom:2px solid #e0b100}.gate-note button{background:#fff;color:#17445a;border:0;border-radius:8px;padding:6px 16px;font:inherit;font-weight:700;cursor:pointer}@media print{.gate-bar,.gate-note{display:none!important}}";
document.head.appendChild(s);
fetch("/api/me",{credentials:"same-origin"}).then(function(r){return r.ok?r.json():null}).then(function(m){
if(!m)return;
var bar=document.createElement("div");bar.className="gate-bar";bar.setAttribute("data-html2canvas-ignore","true");
bar.innerHTML='<a href="/account">حسابي</a><button type="button" id="gateOut">خروج</button>';
document.body.appendChild(bar);
document.getElementById("gateOut").onclick=function(){fetch("/api/logout",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(function(){location.href="/login"})};
function note(cls,text,kind,link){var n=document.createElement("div");n.className="gate-note "+cls;n.setAttribute("data-html2canvas-ignore","true");var t=document.createElement("span");t.textContent=text;n.appendChild(t);
if(link){var a=document.createElement("a");a.href=link;a.textContent="جدّد الآن";a.style.cssText="background:#fff;color:#17445a;border-radius:8px;padding:6px 16px;font-weight:700;text-decoration:none";n.appendChild(a)}
if(kind){var b=document.createElement("button");b.type="button";b.textContent="فهمت";b.onclick=function(){fetch("/api/ack",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({kind:kind})});n.remove()};n.appendChild(b)}
document.body.appendChild(n)}
if(m.trial){var w=document.createElement("style");w.textContent=".sheet{position:relative!important}.sheet::after{content:'نسخة تجريبية — مُيَسِّر';position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;text-align:center;transform:rotate(-30deg);font:900 56px Tajawal,Tahoma,Arial,sans-serif;color:#17445a;opacity:.13;pointer-events:none;z-index:50;white-space:nowrap}.sheet.mini::after{font-size:34px}";document.head.appendChild(w);
if(!m.notice)note("i","أنت على النسخة التجريبية: تُحفظ النماذج وتُطبع بعلامة مائية، وتنتهي التجربة خلال "+m.days_left+" أيام.",null,"/subscribe")}
if(m.notice==="warn")note("w","تنبيه: لاحظنا استخدام حسابك من أكثر من "+DVf(m.max_devices)+". الاشتراك شخصي ولا تجوز مشاركته، وتكرار ذلك قد يؤدي إلى إيقاف الحساب.","warn");
else if(m.notice==="welcome")note("i","مرحبًا بك. الاشتراك شخصي ولا تجوز مشاركته، ويُسمح بتسجيل الدخول من "+DVf(m.max_devices)+" كحد أقصى، ولن يُسمح بدخول جهاز إضافي إلا بعد حذف أحد أجهزتك من «حسابي».","welcome");
else if(m.days_left<=3)note("i","ينتهي اشتراكك خلال "+m.days_left+" أيام ("+m.expires_text+").",null,"/subscribe");
}).catch(function(){});
})();`;


const DEMO_JS = `(function(){
var s=document.createElement("style");
s.textContent=".sheet{position:relative!important}.sheet::after{content:'نسخة تجريبية — مُيَسِّر';position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;text-align:center;transform:rotate(-30deg);font:900 56px Tajawal,Tahoma,Arial,sans-serif;color:#17445a;opacity:.13;pointer-events:none;z-index:50;white-space:nowrap}.sheet.mini::after{font-size:34px}.demo-note{position:fixed;top:0;left:0;right:0;z-index:9999;background:#fff4d6;color:#4a3500;border-bottom:2px solid #e0b100;padding:10px 16px;font:14px/1.7 Tajawal,Tahoma,Arial,sans-serif;direction:rtl;text-align:center}.demo-note a{display:inline-block;margin:0 6px;background:#17445a;color:#fff;border-radius:8px;padding:4px 14px;font-weight:700;text-decoration:none}body{padding-top:48px}@media print{.demo-note{display:none!important}body{padding-top:0}}";
document.head.appendChild(s);
var n=document.createElement("div");n.className="demo-note";n.setAttribute("data-html2canvas-ignore","true");
n.innerHTML='تجربة بدون تسجيل: افتح أي نموذج وعبّئه، وسيُحفظ بعلامة مائية. <a href="/subscribe">اشترك للنسخة الكاملة</a>';
document.body.insertBefore(n,document.body.firstChild);
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

async function dailyJob(env) {
  if (!env.DB) return;
  await init(env);
  const now = Date.now(), site = siteUrl(env, null);
  const rows = (await env.DB.prepare("SELECT id,email,name,expires_at,note FROM users WHERE active=1 AND expires_at>? AND expires_at<=? AND (note IS NOT ? OR expires_at<=?)").bind(now, now + 3 * DAY, TRIAL_NOTE, now + DAY).all()).results;
  for (const u of rows) {
    const done = await env.DB.prepare("SELECT 1 x FROM reminders WHERE user_id=? AND expires_at=?").bind(u.id, u.expires_at).first();
    if (done) continue;
    const tr = u.note === TRIAL_NOTE;
    const r = tr
      ? await mailUser(env, u.email, "تجربتك المجانية تنتهي قريبًا", ["تنتهي تجربتك المجانية في مُيَسِّر بتاريخ " + fmtD(u.expires_at) + ".", "إن أعجبتك النماذج فاشترك لتستمر في استخدامها دون انقطاع."], { url: site + "/subscribe", text: "الاشتراك الآن" })
      : await mailUser(env, u.email, "اشتراكك ينتهي قريبًا", ["ينتهي اشتراكك في مُيَسِّر بتاريخ " + fmtD(u.expires_at) + ".", "لتجديده افتح صفحة الاشتراك وأرسل طلب التجديد بعد التحويل."], { url: site + "/subscribe", text: "تجديد الاشتراك" });
    if (r.ok) {
      await env.DB.prepare("INSERT OR IGNORE INTO reminders(user_id,expires_at) VALUES(?,?)").bind(u.id, u.expires_at).run();
      await ev(env, u, "reminder", "أُرسل تذكير بقرب انتهاء الاشتراك");
    }
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM codes WHERE exp<?").bind(now - DAY),
    env.DB.prepare("DELETE FROM resets WHERE exp<?").bind(now - DAY),
    env.DB.prepare("DELETE FROM attempts WHERE ts<?").bind(now - DAY),
    env.DB.prepare("DELETE FROM sessions WHERE last_seen<?").bind(now - SESSION_DAYS * DAY)
  ]);
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(dailyJob(env)); },
  async fetch(req, env, ctx) {
    try {
      if (!env.DB || !env.ADMIN_PASSWORD)
        return new Response("<meta charset=utf-8><body dir=rtl style='font-family:sans-serif;padding:30px'><h2>الموقع قيد الإعداد</h2><p>لم يكتمل ربط قاعدة البيانات أو ضبط كلمة مرور المسؤول (ADMIN_PASSWORD).</p>", { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
      await init(env);
      const url = new URL(req.url);
      let p = url.pathname.replace(/\/+$/, "") || "/";
      if (p.startsWith("/api/")) return await api(req, env, ctx, url, p);
      if (p === "/_demo.js") return new Response(DEMO_JS, { headers: { "content-type": "application/javascript; charset=utf-8", ...NOSTORE } });
      const DEMO_FORMS = ["report", "analysis", "remedial", "enrichment", "certificate", "visit", "plc", "waiting", "attendance", "minutes"];
      const dm = p === "/demo" ? "index" : (/^\/demo\/[a-z]+$/.test(p) ? p.slice(6) : null);
      if (dm && (dm === "index" || DEMO_FORMS.includes(dm))) {
        const dr = await env.ASSETS.fetch(new Request(new URL("/" + dm + ".html", url), req));
        const dh = new Headers(dr.headers); dh.set("cache-control", "no-store");
        return new HTMLRewriter()
          .on("body", { element(e) { e.append('<script src="/_demo.js" defer></script>', { html: true }); } })
          .on("a", { element(e) {
            const h = e.getAttribute("href") || "", n = h.replace(/\.html$/, "");
            if (n === "index") e.setAttribute("href", "/demo");
            else if (DEMO_FORMS.includes(n)) e.setAttribute("href", "/demo/" + n);
          } })
          .transform(new Response(dr.body, { status: dr.status, headers: dh }));
      }
      if (p === "/_acct.js") return new Response(ACCT_JS, { headers: { "content-type": "application/javascript; charset=utf-8", ...NOSTORE } });

      const isFile = /\.[a-z0-9]+$/i.test(p) && !/\.html$/i.test(p);
      const name = p.replace(/\.html$/i, "");
      const target = isFile ? p : (name === "/" ? "/index" : name) + ".html";
      const open = !isFile && (name === "/login" || name === "/admin" || name === "/terms" || name === "/subscribe" || name === "/forgot" || name === "/reset");
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
