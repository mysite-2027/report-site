/* مُيَسِّر التقارير المدرسية — الزخرفة الجانبية وأيقونات العناوين وحجم الشواهد (وحدة مشتركة للنماذج) */
(function () {
  "use strict";
  var $ = function (i) { return document.getElementById(i); };
  var sto = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  var S = { dec: 0, ico: false, evm: "0" };
  try { var d0 = JSON.parse(sto("rpt_dec") || "{}"); if (d0 && typeof d0 === "object") { if (d0.s != null) S.dec = (+d0.s | 0); else if (d0.on) S.dec = 1; if (S.dec < 0 || S.dec > 3) S.dec = 0; } } catch (e) {}
  try { var i0 = JSON.parse(sto("rpt_ico") || "{}"); if (i0 && i0.on === true) S.ico = true; } catch (e) {}
  S.evm = sto("rpt_evm") === "1" ? "1" : "0";

  /* ---- أيقونات العناوين ---- */
  var PATH = {
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
    checks: '<path d="M4 6.5l1.6 1.6L8.4 5M4 12.5l1.6 1.6L8.4 11M4 18.5l1.6 1.6L8.4 17M12 7h8M12 13h8M12 19h8"/>',
    chart: '<path d="M3.5 3.5v17h17"/><path d="M7.5 15.5l4-4.5 3.2 3L20 7.5"/><path d="M15.8 7.2H20.3v4.5"/>',
    camera: '<path d="M3 9a2.5 2.5 0 0 1 2.5-2.5h2L9 4h6l1.5 2.5h2A2.5 2.5 0 0 1 21 9v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18z"/><circle cx="12" cy="13" r="3.8"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 10h18M3 15h18M9.5 4v16"/>',
    star: '<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1L3.2 9.6l6.1-.8z"/>',
    people: '<circle cx="9" cy="8.5" r="3.3"/><path d="M2.8 20c.4-3.6 3-5.5 6.2-5.5s5.8 1.9 6.2 5.5"/><circle cx="17.5" cy="9.5" r="2.5"/><path d="M17 14.6c2.4.2 4 1.7 4.4 4.4"/>',
    pencil: '<path d="M4 20l1-4.2L16.6 4.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.2 19z"/><path d="M14.5 6.3l3.2 3.2"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'
  };
  var iconFor = function (t) {
    t = String(t || "").replace(/[:：\s]+$/, "").trim();
    if (/الأهداف التفصيلية|التفصيلية/.test(t)) return "checks";
    if (/الهدف|الأهداف/.test(t)) return "target";
    if (/الشواهد/.test(t)) return "camera";
    if (/قياس|أثر/.test(t)) return "chart";
    if (/جدول/.test(t)) return "table";
    if (/الإجراءات/.test(t)) return "checks";
    if (/الأنشطة|ما تم|تنفيذ/.test(t)) return "pencil";
    if (/مظاهر|التميز|الضعف/.test(t)) return "star";
    if (/أساليب|التحفيز|التوصيات|المقترحات/.test(t)) return "bulb";
    if (/أسماء|تواقيع|الحاضر|الحضور/.test(t)) return "people";
    return "doc";
  };
  var icons = function () {
    var sh = $("sheet"); if (!sh) return;
    Array.prototype.forEach.call(sh.querySelectorAll(".ico"), function (e) { e.remove(); });
    if (!S.ico) return;
    var c0 = (getComputedStyle(sh).getPropertyValue("--g1") || "").trim(), m = /^#?([0-9a-f]{6})$/i.exec(c0), ic = "#0b2a3a";
    if (m) { var n = parseInt(m[1], 16); ic = "rgb(" + Math.round((n >> 16 & 255) * .55) + "," + Math.round((n >> 8 & 255) * .55) + "," + Math.round((n & 255) * .55) + ")"; }
    Array.prototype.forEach.call(sh.querySelectorAll(".sec h3"), function (h) {
      var d = PATH[iconFor(h.textContent)];
      var sp = document.createElement("span"); sp.className = "ico";
      sp.setAttribute("style", "display:inline-block;vertical-align:-.28em;margin-left:.45em;line-height:0");
      sp.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="color:' + ic + ';stroke:currentColor">' + d + "</svg>";
      h.insertBefore(sp, h.firstChild);
    });
  };

  /* ---- الزخرفة الجانبية ---- */
  var decorate = function () {
    var sh = $("sheet"); if (!sh) return;
    Array.prototype.forEach.call(sh.querySelectorAll(".dec"), function (e) { e.remove(); });
    if (!S.dec) return;
    if (getComputedStyle(sh).position === "static") sh.style.position = "relative";
    var cs = getComputedStyle(sh), g = function (k, d) { return (cs.getPropertyValue(k) || "").trim() || d; },
      p = g("--p", "#15445a"), b = g("--b", "#3d7eb9"), gr = g("--gr", "#07a869"), g2 = g("--g2", "#0a7f7d");
    var hd = sh.querySelector(".sh-head"), sg = sh.querySelector(".sig,.sig3");
    var top = (hd && hd.offsetHeight ? hd.offsetTop + hd.offsetHeight : 30) + 18, bot = (sg ? sg.offsetTop : sh.scrollHeight - 150) - 18, H = 120, hh = Math.floor((bot - top) / H) * H;
    if (hh < H) return;
    top += ((bot - top) - hh) / 2;
    var lf = function (x, y, a, c) { return '<ellipse cx="6" cy="0" rx="6" ry="2.4" fill="' + c + '" opacity=".5" transform="translate(' + x + " " + y + ") rotate(" + a + ')"/>'; };
    var fl = function (cx, cy, r, c, o) { var q = "", i; for (i = 0; i < 5; i++) q += '<ellipse cx="' + cx + '" cy="' + (cy - r * .85) + '" rx="' + (r * .5) + '" ry="' + (r * .8) + '" fill="' + c + '" opacity="' + o + '" transform="rotate(' + (i * 72) + " " + cx + " " + cy + ')"/>'; return q + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * .28) + '" fill="' + g2 + '" opacity=".85"/>'; };
    var sl = function (x, y, a, c) { return '<path d="M0 0Q4 -2.6 9 0Q4 2.6 0 0Z" fill="' + c + '" opacity=".34" transform="translate(' + x + " " + y + ") rotate(" + a + ')"/>'; };
    var B1 = '<path d="M15 0C5 20 25 40 15 60C5 80 25 100 15 120" fill="none" stroke="' + p + '" stroke-width="1.2" opacity=".45"/>' + lf(12, 15, -35, g2) + lf(18, 45, 35, gr) + lf(12, 75, -35, g2) + lf(18, 105, 35, gr) + fl(15, 30, 7.5, b, .4) + fl(15, 90, 6.5, gr, .45);
    var B2 = '<path d="M15 0C11 30 19 90 15 120" fill="none" stroke="' + p + '" stroke-width=".7" opacity=".3"/>', k;
    for (k = 0; k < 4; k++) { var y0 = k * 30 + 10; B2 += sl(15, y0, -40, k % 2 ? g2 : gr) + sl(15, y0 + 13, 220, k % 2 ? gr : g2) + '<circle cx="15" cy="' + (y0 + 22) + '" r="1.3" fill="' + b + '" opacity=".4"/>'; }
    var B3 = fl(9, 18, 6, b, .4) + fl(21, 52, 8, gr, .4) + fl(10, 88, 6.5, b, .4) + lf(14, 34, -20, g2) + lf(12, 70, 200, gr) + lf(16, 104, -30, g2) +
      '<circle cx="22" cy="24" r="1.7" fill="' + p + '" opacity=".4"/><circle cx="6" cy="58" r="1.7" fill="' + p + '" opacity=".4"/><circle cx="24" cy="94" r="1.7" fill="' + p + '" opacity=".4"/><circle cx="20" cy="112" r="2.4" fill="' + b + '" opacity=".38"/><circle cx="8" cy="40" r="2.4" fill="' + gr + '" opacity=".4"/>';
    var body = [0, B1, B2, B3][S.dec];
    var tile = function (m) { return "url('data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="120" viewBox="0 0 30 120">' + (m ? '<g transform="translate(30 0) scale(-1 1)">' + body + "</g>" : body) + "</svg>") + "')"; };
    ["r", "l"].forEach(function (sd) {
      var d = document.createElement("div"), tl = tile(sd === "l");
      d.className = "dec"; d.setAttribute("data-t", tl.slice(5, -2)); d.setAttribute("data-s", sd);
      d.setAttribute("style", "position:absolute;top:" + top + "px;height:" + hh + "px;width:30px;" + (sd === "r" ? "right" : "left") + ":7px;background:" + tl + " repeat-y 0 0/30px 120px");
      sh.appendChild(d);
    });
  };

  var apply = function () { icons(); decorate(); };
  var MD = window.MuyassirDeco = {
    apply: apply,
    big: function () { return S.evm === "1"; },
    /* خيارات تصدير Word: تُزال الزخرفة من الصفحة مؤقتًا وتُمرَّر كصور؛ استدعِ apply() بعد التصدير */
    wordOpts: function (o) {
      var sh = $("sheet"), dc = {};
      Array.prototype.forEach.call(sh.querySelectorAll(".dec"), function (e) { var u = e.getAttribute("data-t"); if (u) dc[e.getAttribute("data-s")] = u; e.remove(); });
      o = o || {};
      o.evH = S.evm === "1" ? 340 : 130; o.evBig = S.evm === "1";
      o.deco = (dc.r || dc.l) ? dc : null;
      return o;
    },
    /* حفظ PDF بحجم «كبيرة»: صفحة للتقرير وصفحة للشواهد */
    pdfBig: async function (o) {
      o = o || {};
      var sh = $("sheet"), ev = null;
      Array.prototype.forEach.call(sh.querySelectorAll(".sec"), function (s) { if (s.querySelector(".ev")) ev = s; });
      var body = Array.prototype.filter.call(sh.children, function (k) { return k !== ev && !/\b(dec|sig|sig3|band)\b/.test(k.className || ""); });
      var hide = function (l, h) { l.forEach(function (e) { e.style.display = h ? "none" : ""; }); };
      var shot = async function () { return await html2canvas(sh, { scale: Math.min(3, Math.sqrt(12e6 / (sh.offsetWidth * sh.offsetHeight))), backgroundColor: "#ffffff", useCORS: true, windowWidth: 1200, scrollX: 0, scrollY: -window.scrollY, onclone: function (d) { d.getElementById("sheet").style.boxShadow = "none"; } }); };
      var A, B;
      try {
        if (ev) hide([ev], true); decorate(); A = await shot(); if (ev) hide([ev], false);
        if (ev) { hide(body, true); sh.classList.add("evbig"); decorate(); B = await shot(); }
      } finally { hide(body, false); if (ev) hide([ev], false); sh.classList.remove("evbig"); decorate(); }
      var pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", compress: true });
      [A, B].filter(Boolean).forEach(function (cv, i) { if (i) pdf.addPage(); var h = cv.height * 210 / cv.width, k = h > 297 ? 297 / h : 1; pdf.addImage(cv.toDataURL("image/jpeg", .95), "JPEG", (210 - 210 * k) / 2, 0, 210 * k, h * k); });
      var blob = pdf.output("blob"), nm = o.nm || "تقرير";
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nm + ".pdf"; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    },
    /* يضيف القوائم إلى لوحة الإدخال ويربط إعادة الرسم */
    attach: function (o) {
      o = o || {};
      var st = document.createElement("style"); st.textContent = ".sheet.evbig .ev div{height:80mm}"; document.head.appendChild(st);
      var anc = document.querySelector('.panel .hint[style*="rgba(44,125,181"]') || null, host = document.createElement("div");
      host.innerHTML = '<div class="two"><div><label>الزخرفة الجانبية</label><select id="decSel"><option value="0">بدون زخرفة</option><option value="1">١ — غصن ورد متعرّج</option><option value="2">٢ — غصن ناعم</option><option value="3">٣ — زهور متناثرة</option></select></div><div><label>أيقونات العناوين</label><select id="icoSel"><option value="0">بدون أيقونات</option><option value="1">إظهار الأيقونات</option></select></div></div>' +
        (o.ev ? '<div class="two"><div><label>حجم الشواهد (PDF وWord)</label><select id="evSel"><option value="0">مضغوطة (في نفس الصفحة)</option><option value="1">كبيرة (الشواهد في صفحة مستقلة)</option></select></div></div>' : "");
      var par = anc ? anc.parentNode : (document.querySelector(".panel fieldset") || document.querySelector(".panel") || document.body);
      while (host.firstChild) { if (anc) par.insertBefore(host.firstChild, anc); else par.appendChild(host.firstChild); }
      $("decSel").value = String(S.dec); $("icoSel").value = S.ico ? "1" : "0"; if ($("evSel")) $("evSel").value = S.evm;
      var again = function () { if (typeof window.render === "function") window.render(); else apply(); };
      $("decSel").onchange = function () { S.dec = +this.value | 0; sto("rpt_dec", JSON.stringify({ s: S.dec })); again(); };
      $("icoSel").onchange = function () { S.ico = this.value === "1"; sto("rpt_ico", JSON.stringify({ on: S.ico })); again(); };
      if ($("evSel")) $("evSel").onchange = function () { S.evm = this.value === "1" ? "1" : "0"; sto("rpt_evm", S.evm); };
      var r0 = window.render;
      if (typeof r0 === "function") window.render = function () { var x = r0.apply(this, arguments); apply(); return x; };
    }
  };
})();
