/* مُيَسِّر التقارير المدرسية — محوّل مشترك: يقرأ #sheet الظاهر ويبني ملف Word (docx) قابلًا للتعديل.
   يعمل كاملًا داخل المتصفح. يحتاج vendor/docx.min.js. */
(function () {
  "use strict";
  var W = 10206; /* عرض المحتوى بالتوينتي (A4 بهوامش 1.5سم) */

  function hexOf(c) {
    var m = String(c || "").match(/rgba?\(([^)]+)\)/);
    if (!m) { var h = String(c || "").trim().match(/^#([0-9a-f]{6})$/i); return h ? h[1].toUpperCase() : null; }
    var p = m[1].split(",").map(parseFloat);
    if (p.length > 3 && p[3] === 0) return null;
    return p.slice(0, 3).map(function (x) { return ("0" + Math.round(x).toString(16)).slice(-2); }).join("").toUpperCase();
  }

  window.muyassirWord = async function (sheet, opt) {
    var LAND = !!(sheet && sheet.classList && sheet.classList.contains("land"));
    W = LAND ? 15138 : 10206;
    opt = opt || {};
    var D = window.docx;
    if (!D) throw new Error("docx missing");
    var cs = function (el) { return getComputedStyle(el); };
    var shS = cs(sheet);
    var CL = hexOf(shS.getPropertyValue("--p").trim()) || "17445A";
    var FN = { ascii: "Arial", hAnsi: "Arial", cs: "Arial", eastAsia: "Arial" };
    var SYM = { ascii: "Segoe UI Symbol", hAnsi: "Segoe UI Symbol", cs: "Segoe UI Symbol", eastAsia: "Segoe UI Symbol" };
    var CEN = D.AlignmentType.CENTER;
    var flat = function (a) { return [].concat.apply([], a); };
    var NB = { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" }, NOB = { top: NB, bottom: NB, left: NB, right: NB };
    var bd = function (c, sz) { var x = { style: D.BorderStyle.SINGLE, size: sz, color: c }; return { top: x, bottom: x, left: x, right: x }; };
    var LINE = bd("C9D3DA", 4), BOX = bd(CL, 12);
    var fill = function (c) { return { type: D.ShadingType.CLEAR, fill: c, color: "auto" }; };
    var px = function (t) { return Math.round(t / 15); };

    var isCenter = function (el) {
      var s = cs(el);
      return s.textAlign === "center" || (/flex/.test(s.display) && s.justifyContent === "center");
    };
    var alignOf = function (el) { return isCenter(el) ? CEN : undefined; };

    /* نص مع فصل الأرقام لتبقى لاتينية */
    var runs = function (t, o) {
      o = o || {};
      return String(t).split(/([0-9]+(?:\.[0-9]+)?%?)/).filter(function (x) { return x !== ""; }).map(function (x) {
        var dg = /^[0-9]/.test(x);
        var base = { text: x, font: FN, rightToLeft: !dg, size: 22, sizeComplexScript: 22 };
        if (o.bold) { base.bold = true; base.boldComplexScript = true; }
        if (o.color) base.color = o.color;
        if (o.size) { base.size = o.size; base.sizeComplexScript = o.size; }
        if (o.font) base.font = o.font;
        if (o.br) base.break = 1;
        return new D.TextRun(base);
      });
    };

    /* تحويل محتوى عنصر (نص + b + span + br) إلى TextRun[] */
    var inline = function (el, size) {
      var out = [];
      var walk = function (n, inh) {
        if (n.nodeType === 3) {
          var par = n.parentNode, s = cs(par), pre = /^pre/.test(s.whiteSpace);
          var t = n.nodeValue;
          if (!pre) t = t.replace(/\s+/g, " "); else t = t.replace(/\r/g, "");
          var ps = n.previousSibling;
          if (ps && ps.nodeType === 1 && ps.tagName === "B" && t.charAt(0) !== " " && t.trim()) t = " " + t;
          if (!t.trim() && !pre) { if (t) out.push({ sp: true }); return; }
          var o = { bold: parseInt(s.fontWeight, 10) >= 600, color: hexOf(s.color) || "0B1620", size: size };
          if (pre && t.indexOf("\n") > -1) {
            t.split("\n").forEach(function (ln, i) { if (ln !== "" || i > 0) out.push({ t: ln, o: o, br: i > 0 }); });
          } else out.push({ t: t, o: o });
        } else if (n.nodeType === 1) {
          if (n.tagName === "BR") { out.push({ t: "", o: {}, br: true }); return; }
          if (n.tagName === "IMG" || n.tagName === "I") return;
          for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
        }
      };
      for (var c = el.firstChild; c; c = c.nextSibling) walk(c);
      var res = [], first = true;
      out.forEach(function (x) {
        if (x.sp) { return; }
        var t = x.t;
        if (first) { t = t.replace(/^\s+/, ""); }
        if (t === "" && !x.br) return;
        first = false;
        if (x.br) { res.push(new D.TextRun({ break: 1, font: FN, size: 22 })); }
        runs(t, x.o).forEach(function (r) { res.push(r); });
      });
      return res;
    };

    var para = function (ch, o) {
      return new D.Paragraph(Object.assign({ bidirectional: true, spacing: { after: 60 }, children: flat(ch) }, o || {}));
    };
    var empty = function (after) { return new D.Paragraph({ spacing: { after: after || 0, line: 40, lineRule: D.LineRuleType.EXACT }, children: [] }); };
    var gap = function (n) { return empty(n || 80); };
    var cellKids = function (arr) {
      arr = arr.slice();
      if (!arr.length || (arr[arr.length - 1] instanceof D.Table)) arr.push(empty());
      return arr;
    };
    var cell = function (ch, w, o) {
      return new D.TableCell(Object.assign({
        children: cellKids(ch), width: { size: w, type: D.WidthType.DXA }, borders: NOB,
        verticalAlign: D.VerticalAlign.CENTER, margins: { top: 60, bottom: 60, left: 110, right: 110 }
      }, o || {}));
    };
    var table = function (rows, cols, o) {
      return new D.Table(Object.assign({
        layout: D.TableLayoutType.FIXED, visuallyRightToLeft: true,
        width: { size: cols.reduce(function (a, c) { return a + c; }, 0), type: D.WidthType.DXA },
        columnWidths: cols, rows: rows
      }, o || {}));
    };

    /* صور */
    var u8 = function (d) { var s = atob(d.split(",")[1]), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
    var pic = function (img, mw, mh) {
      var d = img.getAttribute("src") || "";
      if (!/^data:image\/(png|jpe?g)/i.test(d)) return null;
      var nw = img.naturalWidth, nh = img.naturalHeight;
      if (!nw || !nh) return null;
      var k = Math.min(mw / nw, mh / nh, 1);
      return new D.ImageRun({
        type: /^data:image\/png/i.test(d) ? "png" : "jpg", data: u8(d),
        transformation: { width: Math.max(1, Math.round(nw * k)), height: Math.max(1, Math.round(nh * k)) },
        altText: { title: "صورة", description: "صورة", name: "img" }
      });
    };

    /* جدول من table داخل الورقة (الأعمدة بحسب عرضها الفعلي) */
    var tableFrom = function (t, total) {
      var rowsEl = Array.prototype.slice.call(t.rows);
      if (!rowsEl.length) return null;
      var spanned = rowsEl.some(function (r) { return Array.prototype.some.call(r.cells, function (c) { return c.colSpan > 1 || c.rowSpan > 1; }); });
      var wrow = rowsEl[0];
      if (spanned) {
        var gridN = Array.prototype.reduce.call(rowsEl[0].cells, function (a, c) { return a + c.colSpan; }, 0);
        wrow = rowsEl.filter(function (r) { return r.cells.length === gridN && Array.prototype.every.call(r.cells, function (c) { return c.colSpan === 1; }); })[0] || rowsEl[0];
      }
      var first = Array.prototype.slice.call(wrow.cells);
      var occ = [], hdrN = rowsEl.filter(function (r) { return /\bhh\b/.test(r.className); }).length;
      var ws = first.map(function (c) { return Math.max(1, c.getBoundingClientRect().width); });
      var sum = ws.reduce(function (a, b) { return a + b; }, 0);
      var cols = ws.map(function (w) { return Math.max(120, Math.floor(w / sum * total)); });
      var diff = total - cols.reduce(function (a, b) { return a + b; }, 0);
      cols[0] += diff;
      var dense = /\bdense\b/.test(t.className);
      var rows = rowsEl.map(function (r, ri) {
        var gi = 0, newOcc = occ.map(function (x) { return Math.max(0, (x || 0) - 1); });
        var cells = Array.prototype.slice.call(r.cells).map(function (c, ci) {
          var cspan = 1, rspan = 1, gw = cols[ci];
          if (spanned) {
            while (occ[gi] > 0) gi++;
            cspan = c.colSpan || 1; rspan = c.rowSpan || 1;
            gw = 0; for (var kk = gi; kk < gi + cspan; kk++) { gw += cols[kk] || 0; if (rspan > 1) newOcc[kk] = rspan - 1; }
            gi += cspan;
          }
          var s = cs(c), isTh = c.tagName === "TH", isSp = /\bsp\b/.test(c.className);
          if (isSp) return cell([empty()], cols[ci], { margins: { top: 0, bottom: 0, left: 0, right: 0 } });
          var o = { borders: isTh ? bd(hexOf(s.borderTopColor) || CL, 4) : LINE };
          if (isTh) o.shading = fill(hexOf(s.backgroundColor) || CL);
          if (!isTh && /\bck-/.test(c.className) && hexOf(s.backgroundColor)) o.shading = fill(hexOf(s.backgroundColor));
          var fsz = 20;
          if (!isTh && r.classList && r.classList.contains("hr")) o.margins = { top: 10, bottom: 10, left: 110, right: 110 };
          if (dense && isTh) { o.margins = { top: 30, bottom: 30, left: 10, right: 10 }; fsz = gw < 520 ? 12 : (gw < 800 ? 16 : 18); }
          var color = isTh ? (hexOf(s.color) || "FFFFFF") : (hexOf(s.color) || "0B1620");
          var rr = [];
          var t0 = c.textContent.replace(/\s+/g, " ").trim();
          var parts = (isTh && (c.querySelector(".mx") || (dense && /<br/i.test(c.innerHTML)))) ? c.innerHTML.replace(/<span[^>]*class="mx"[^>]*>/i, "<br>").split(/<br\s*\/?>/i).map(function (p) { return p.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(); }).filter(Boolean) : null;
          var pl = null;
          if (parts && parts.length > 1) {
            pl = parts.map(function (p, pi) { return para(runs(p, { bold: !dense && pi === 0, color: color, size: (!dense && pi > 0) ? 16 : fsz }), { alignment: CEN, spacing: { after: 0 } }); });
          }
          else if (t0) {
            runs(t0, { bold: (dense && isTh) ? false : (isTh || parseInt(s.fontWeight, 10) >= 600), color: color, size: fsz }).forEach(function (x) { rr.push(x); });
          }
          else if (c.querySelector(".bx")) { runs("□", { font: SYM, color: "6B7280", size: 26 }).forEach(function (x) { rr.push(x); }); }
          if (cspan > 1) o.columnSpan = cspan;
          if (rspan > 1) o.rowSpan = rspan;
          return cell(pl || [para(rr, { alignment: isTh ? CEN : alignOf(c), spacing: { after: 0 } })], gw, o);
        });
        occ = newOcc;
        var hasTh = r.cells.length && r.cells[0].tagName === "TH";
        return new D.TableRow({
          tableHeader: hdrN ? ri < hdrN : (ri === 0 && hasTh), cantSplit: true,
          height: { value: (r.classList && r.classList.contains("hr")) ? Math.max(240, Math.round(r.getBoundingClientRect().height * 15)) : (hasTh ? 360 : 400), rule: D.HeightRule.ATLEAST }, children: cells
        });
      });
      return table(rows, cols);
    };

    var icoMap = (typeof Map === "function") ? new Map() : null;
    var icoPng = function (svg) {
      return new Promise(function (ok) {
        try {
          var x = new XMLSerializer().serializeToString(svg), im = new Image();
          im.onload = function () { try { var c = document.createElement("canvas"); c.width = 96; c.height = 96; c.getContext("2d").drawImage(im, 0, 0, 96, 96); ok(c.toDataURL("image/png")); } catch (e) { ok(null); } };
          im.onerror = function () { ok(null); };
          im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(x);
        } catch (e) { ok(null); }
      });
    };
    var h3 = function (el) {
      var ip = icoMap && icoMap.get(el), kids3 = [];
      if (ip) kids3.push(runs("\u200F", {}), new D.ImageRun({ type: "png", data: u8(ip), transformation: { width: 18, height: 18 }, altText: { title: "أيقونة", description: "أيقونة العنوان", name: "ico" } }), runs(" ", {}));
      kids3.push(runs(el.textContent.trim(), { bold: true, color: hexOf(cs(el).color) || CL, size: 25 }));
      return para(kids3,
        { keepNext: true, alignment: alignOf(el), spacing: { after: 80 } });
    };

    /* شبكة خيارات (.meth) */
    var methGrid = function (m, iw) {
      var items = Array.prototype.slice.call(m.children);
      var CW = Math.floor(iw / 3), rows = [];
      for (var i = 0; i < items.length; i += 3) {
        var cs3 = [];
        for (var j = 0; j < 3; j++) {
          var it = items[i + j];
          var kids = [];
          if (it) {
            var on = !!it.querySelector(".bx.on");
            kids = [runs(on ? "■ " : "□ ", { font: SYM, color: on ? CL : "6B7280", size: 22 }), runs(it.textContent.trim())];
          }
          cs3.push(cell([para(kids, { spacing: { after: 0 } })], CW, { margins: { top: 30, bottom: 30, left: 60, right: 60 } }));
        }
        rows.push(new D.TableRow({ cantSplit: true, children: cs3 }));
      }
      return table(rows, [CW, CW, CW]);
    };

    /* الشواهد */
    var evGrid = function (ev, iw) {
      var items = Array.prototype.slice.call(ev.children), q = Math.floor(iw / 4), half = q * 2, rows = [];
      var pf = /\bpf\b/.test(ev.className || ""), cnt = items.length;
      var a1 = /\ba1\b/.test(ev.className || ""), mhOf = pf ? (a1 ? (cnt === 1 ? 520 : (cnt === 2 ? 380 : 290)) : (cnt === 1 ? 340 : (cnt === 2 ? 270 : 220))) : (opt.evH || 200);
      var one = function (it, wide) {
        var kids = [], img = it.querySelector("img"), im = img ? pic(img, px(wide ? q * 4 : half) - 24, mhOf) : null;
        if (im) kids = [new D.Paragraph({ alignment: CEN, spacing: { after: 0 }, children: [im] })];
        else kids = [para([runs(it.textContent.trim() || " ", { color: "6B7280" })], { alignment: CEN, spacing: { after: 0 } })];
        return cell(kids, wide ? q * 4 : half, { borders: BOX, columnSpan: wide ? 4 : 2 });
      };
      if (pf && cnt === 1) {
        rows.push(new D.TableRow({ cantSplit: true, height: { value: 1500, rule: D.HeightRule.ATLEAST }, children: [one(items[0], true)] }));
        return table(rows, [q, q, q, q]);
      }
      for (var i = 0; i < items.length; i += 2) {
        var cs2;
        if (i + 1 < items.length) cs2 = [one(items[i]), one(items[i + 1])];
        else cs2 = [cell([empty()], q), one(items[i]), cell([empty()], q)];
        rows.push(new D.TableRow({ cantSplit: true, height: { value: 1500, rule: D.HeightRule.ATLEAST }, children: cs2 }));
      }
      return table(rows, [q, q, q, q]);
    };

    /* ملخص الدرجات (.stats) */
    var statsTable = function (st, iw) {
      var items = Array.prototype.slice.call(st.children), cw = Math.floor(iw / (items.length || 1));
      return table([new D.TableRow({ cantSplit: true, children: items.map(function (it) {
        var b = it.querySelector("b"), sp = it.querySelector("span");
        return cell([
          para([runs(b ? b.textContent.trim() : "", { bold: true, color: b ? (hexOf(cs(b).color) || CL) : CL, size: 36 })], { alignment: CEN, spacing: { after: 20 } }),
          para([runs(sp ? sp.textContent.replace(/\s+/g, " ").trim() : "", { size: 20 })], { alignment: CEN, spacing: { after: 0 } })
        ], cw, { borders: LINE });
      }) })], items.map(function () { return cw; }));
    };

    /* مستويات الدرجات: جدول بدل الرسم (أعمدة أو دائرة) */
    var levelsData = function (sec) {
      var L = [], type = "bars", mid = null;
      var lvc = sec.querySelectorAll(".lv .c"), nm = sec.querySelectorAll(".nm > div"), lg = sec.querySelectorAll(".lg");
      if (lvc.length) {
        Array.prototype.forEach.call(lvc, function (c, i) {
          var n = nm[i], col = c.querySelector(".col");
          L.push({ name: n && n.querySelector("b") ? n.querySelector("b").textContent.trim() : "", range: n && n.querySelector("small") ? n.querySelector("small").textContent.trim() : "",
            count: c.querySelector(".n") ? c.querySelector(".n").textContent.trim() : "", pct: n && n.querySelector("i") ? n.querySelector("i").textContent.trim() : "", color: col ? hexOf(cs(col).backgroundColor) : null });
        });
      } else if (lg.length) {
        Array.prototype.forEach.call(lg, function (g) {
          var d = g.querySelector("div"), dot = g.querySelector("i");
          L.push({ name: d && d.querySelector("b") ? d.querySelector("b").textContent.trim() : "", range: d && d.querySelector("small") ? d.querySelector("small").textContent.trim() : "",
            count: g.querySelector(".v") ? g.querySelector(".v").textContent.trim() : "", pct: g.querySelector(".p") ? g.querySelector(".p").textContent.trim() : "", color: dot ? hexOf(cs(dot).backgroundColor) : null });
        });
      }
      if (!L.length) return null;
      if (!lvc.length) type = "donut";
      var md = sec.querySelector(".dn .mid");
      if (md) mid = { a: (md.querySelector("b") || {}).textContent || "", b: (md.querySelector("span") || {}).textContent || "" };
      return { L: L, type: type, mid: mid };
    };

    /* رسم المخطط على canvas (أعمدة أو دائرة) كصورة PNG */
    var chartImage = function (d) {
      var L = d.L, cw = 1200, chh = 520, cv = document.createElement("canvas");
      cv.width = cw; cv.height = chh;
      var x = cv.getContext("2d");
      x.fillStyle = "#ffffff"; x.fillRect(0, 0, cw, chh);
      x.direction = "rtl"; x.textAlign = "center";
      var F = "Arial, Tahoma, sans-serif";
      var tot = L.reduce(function (a, l) { return a + (parseFloat(l.count) || 0); }, 0);
      if (d.type === "bars") {
        var base = 380, top = 70, mx = Math.max.apply(null, L.map(function (l) { return parseFloat(l.count) || 0; }).concat([1]));
        var slot = (cw - 80) / L.length, bw = slot * 0.62;
        x.strokeStyle = "#c9d3da"; x.lineWidth = 3; x.beginPath(); x.moveTo(40, base); x.lineTo(cw - 40, base); x.stroke();
        L.forEach(function (l, i) {
          var cx = cw - 40 - slot * (i + 0.5), n = parseFloat(l.count) || 0, h = Math.max(3, n / mx * (base - top));
          x.fillStyle = "#" + (l.color || "2C7DB5");
          var bx = cx - bw / 2, by = base - h, r = 14;
          x.beginPath(); x.moveTo(bx, base); x.lineTo(bx, by + r); x.quadraticCurveTo(bx, by, bx + r, by); x.lineTo(bx + bw - r, by); x.quadraticCurveTo(bx + bw, by, bx + bw, by + r); x.lineTo(bx + bw, base); x.closePath(); x.fill();
          x.fillStyle = "#0b1620"; x.font = "bold 34px " + F; x.fillText(String(l.count), cx, by - 12);
          x.font = "bold 30px " + F; x.fillText(l.name, cx, base + 42);
          x.fillStyle = "#33414d"; x.font = "bold 28px " + F; x.fillText(l.pct, cx, base + 78);
          x.font = "22px " + F; x.fillText(l.range, cx, base + 110);
        });
      } else {
        var cx0 = 330, cy0 = chh / 2, R = 215, r0 = 125, a0 = -Math.PI / 2;
        if (tot <= 0) { x.strokeStyle = "#c9d3da"; x.lineWidth = R - r0; x.beginPath(); x.arc(cx0, cy0, (R + r0) / 2, 0, Math.PI * 2); x.stroke(); }
        L.forEach(function (l) {
          var n = parseFloat(l.count) || 0; if (!n || !tot) return;
          var a1 = a0 + n / tot * Math.PI * 2;
          x.fillStyle = "#" + (l.color || "2C7DB5"); x.beginPath(); x.arc(cx0, cy0, R, a0, a1); x.arc(cx0, cy0, r0, a1, a0, true); x.closePath(); x.fill();
          a0 = a1;
        });
        x.fillStyle = "#" + CL; x.font = "bold 56px " + F; x.fillText(d.mid ? d.mid.a.trim() : "", cx0, cy0 + 12);
        x.fillStyle = "#0b1620"; x.font = "26px " + F; x.fillText(d.mid ? d.mid.b.replace(/\s+/g, " ").trim().slice(0, 28) : "", cx0, cy0 + 52);
        L.forEach(function (l, i) {
          var y = 70 + i * 86, lx = 700;
          x.fillStyle = "#" + (l.color || "2C7DB5"); x.beginPath(); x.arc(cw - 90, y, 16, 0, Math.PI * 2); x.fill();
          x.textAlign = "right"; x.fillStyle = "#0b1620"; x.font = "bold 32px " + F; x.fillText(l.name, cw - 125, y + 4);
          x.fillStyle = "#33414d"; x.font = "22px " + F; x.fillText(l.range, cw - 125, y + 32);
          x.textAlign = "center"; x.fillStyle = "#0b1620"; x.font = "bold 34px " + F; x.fillText(String(l.count), 760, y + 10);
          x.fillStyle = "#" + CL; x.fillText(l.pct, 620, y + 10);
          x.strokeStyle = "#e3e9ed"; x.lineWidth = 2; x.beginPath(); x.moveTo(560, y + 46); x.lineTo(cw - 60, y + 46); x.stroke();
        });
      }
      return cv.toDataURL("image/png");
    };

    var levelsTable = function (sec, iw) {
      var d = levelsData(sec); if (!d) return null; var L = d.L;
      var cols = [2200, 3906, 1700, 1700 - 0], tot = iw, c0 = Math.floor(tot * 0.22), c1 = Math.floor(tot * 0.40), c2 = Math.floor(tot * 0.18), c3 = tot - c0 - c1 - c2;
      cols = [c0, c1, c2, c3];
      var hc = function (t, w) { return cell([para([runs(t, { bold: true, color: "FFFFFF", size: 20 })], { alignment: CEN, spacing: { after: 0 } })], w, { borders: bd(CL, 4), shading: fill(CL) }); };
      var rows = [new D.TableRow({ tableHeader: true, cantSplit: true, children: [hc("المستوى", c0), hc("المدى", c1), hc("العدد", c2), hc("النسبة", c3)] })];
      L.forEach(function (l) {
        var dot = l.color ? runs("● ", { font: SYM, color: l.color, size: 24 }) : [];
        rows.push(new D.TableRow({ cantSplit: true, height: { value: 400, rule: D.HeightRule.ATLEAST }, children: [
          cell([para([dot, runs(l.name, { bold: true, size: 20 })], { spacing: { after: 0 } })], c0, { borders: LINE }),
          cell([para([runs(l.range, { size: 20 })], { spacing: { after: 0 } })], c1, { borders: LINE }),
          cell([para([runs(l.count, { size: 20 })], { alignment: CEN, spacing: { after: 0 } })], c2, { borders: LINE }),
          cell([para([runs(l.pct, { size: 20 })], { alignment: CEN, spacing: { after: 0 } })], c3, { borders: LINE })
        ] }));
      });
      return table(rows, cols);
    };

    /* محتوى قسم .sec */
    var secContent = function (sec, iw) {
      var out = [], lvDone = false;
      Array.prototype.forEach.call(sec.children, function (c) {
        var cn = c.className || "", tg = c.tagName;
        if (tg === "H3") out.push(h3(c));
        else if (tg === "P") out.push(para([inline(c)], { alignment: alignOf(c), spacing: { after: 60 } }));
        else if (/\bmeth\b/.test(cn)) out.push(methGrid(c, iw));
        else if (/\bg\b/.test(cn)) out.push(para([inline(c)], { alignment: alignOf(c), spacing: { after: 40 } }));
        else if (tg === "TABLE") { var tt = tableFrom(c, iw); if (tt) { out.push(tt); out.push(empty()); } }
        else if (tg === "UL") Array.prototype.forEach.call(c.children, function (li) { out.push(para([inline(li)], { alignment: alignOf(li), spacing: { after: 40 } })); });
        else if (/\bcircs\b/.test(cn)) {
          var cc = Array.prototype.slice.call(c.children), cwid = Math.floor(iw / cc.length), cv = document.createElement("canvas");
          cv.width = 160; cv.height = 160; var cx = cv.getContext("2d"); cx.strokeStyle = "#" + CL; cx.lineWidth = 6; cx.beginPath(); cx.arc(80, 80, 72, 0, 6.2832); cx.stroke();
          var cpng = u8(cv.toDataURL("image/png"));
          out.push(table([new D.TableRow({ cantSplit: true, children: cc.map(function (d) {
            var bt = d.querySelector("b"), sp = d.querySelector("span");
            return cell([
              new D.Paragraph({ alignment: CEN, spacing: { after: 40 }, children: [new D.ImageRun({ type: "png", data: cpng, transformation: { width: 62, height: 62 }, altText: { title: "دائرة", description: "دائرة", name: "circle" } })] }),
              para([runs(bt ? bt.textContent.trim() : "", { bold: true, color: CL, size: 26 })], { alignment: CEN, spacing: { after: 0 } }),
              para([runs(sp ? sp.textContent.trim() : "", { size: 20 })], { alignment: CEN, spacing: { after: 0 } })
            ], cwid[0] === undefined ? cwid : cwid);
          }) })], cc.map(function () { return cwid; }))); out.push(empty());
        }
        else if (/\bev\b/.test(cn)) { out.push(evGrid(c, iw)); out.push(empty()); }
        else if (/\bstats\b/.test(cn)) { out.push(statsTable(c, iw)); out.push(empty()); }
        else if (/\b(lv|dn)\b/.test(cn)) { if (!lvDone) {
          var ld = levelsData(sec);
          if (ld) {
            try {
              var png = chartImage(ld), pw = Math.min(px(iw) - 10, 600);
              out.push(new D.Paragraph({ alignment: CEN, spacing: { after: 80 }, children: [new D.ImageRun({ type: "png", data: u8(png), transformation: { width: pw, height: Math.round(pw * 520 / 1200) }, altText: { title: "مخطط", description: "مخطط مستويات الطلاب", name: "chart" } })] }));
            } catch (e) { /* يبقى الجدول */ }
          }
          var lt = levelsTable(sec, iw); if (lt) { out.push(lt); out.push(empty()); } lvDone = true; } }
        else if (/\bnm\b/.test(cn)) { /* يُدمج مع .lv */ }
        else if (tg === "DIV") out.push(para([inline(c)], { alignment: alignOf(c), spacing: { after: 40 } }));
      });
      return out;
    };

    var BIGM = { top: 100, bottom: 100, left: 200, right: 200 };
    var secBox = function (sec) {
      return table([new D.TableRow({ cantSplit: false, children: [cell(secContent(sec, W - 500), W, { borders: BOX, margins: BIGM })] })], [W]);
    };

    /* زخرفة جانبية: عمودان جانبيان في جدول خارجي (صور داخل الخلايا، تعمل في كل برامج العرض) */
    var DECO = !!(opt.deco && (opt.deco.r || opt.deco.l)) && !LAND, SIDE = 500, DNT = 5;
    var ZERO = { top: 0, bottom: 0, left: 0, right: 0 };
    var sideCell = function (png) {
      var kk = [];
      if (png) {
        kk.push(new D.Paragraph({ spacing: { before: 0, after: 0, line: 2100, lineRule: D.LineRuleType.EXACT }, children: [] }));
        kk.push(new D.Paragraph({ spacing: { before: 0, after: 0 }, alignment: CEN, children: [new D.ImageRun({ type: "png", data: u8(png), transformation: { width: 30, height: 120 * DNT }, altText: { title: "زخرفة", description: "زخرفة جانبية", name: "deco" } })] }));
      }
      return cell(kk, SIDE, { margins: ZERO, verticalAlign: D.VerticalAlign.TOP });
    };
    var wrapDeco = function (kids, rPng, lPng) {
      return [table([new D.TableRow({ children: [sideCell(rPng), cell(kids, W, { margins: ZERO, verticalAlign: D.VerticalAlign.TOP }), sideCell(lPng)] })], [SIDE, W, SIDE]),
        new D.Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: D.LineRuleType.EXACT }, children: [] })];
    };
    var mkFooter = function (kids) { return new D.Footer({ children: DECO ? wrapDeco(kids, null, null) : kids }); };

    /* ===== بناء الصفحة ===== */
    var ch = [], footer = null, first = true, sigTable = null;
    var hdrArr = [], hFirst = true, curRep = false;
    var add = function (x, g) {
      if (curRep) { if (!hFirst) hdrArr.push(gap(Math.min(g || 100, 70))); hdrArr.push(x); hFirst = false; return; }
      if (!first) ch.push(gap(Math.min(g || 100, 70))); ch.push(x); first = false;
    };
    var kids = Array.prototype.slice.call(sheet.children);
    if (icoMap) {
      var icoSv = sheet.querySelectorAll(".ico svg");
      for (var ii = 0; ii < icoSv.length; ii++) { var hh3 = icoSv[ii].closest("h3"), pg3 = await icoPng(icoSv[ii]); if (hh3 && pg3) icoMap.set(hh3, pg3); }
    }

    for (var ki = 0; ki < kids.length; ki++) {
      var el = kids[ki], cn = el.className || "";
      curRep = /\brep\b/.test(cn);
      if (/\bsh-head\b/.test(cn)) {
        var tx = el.querySelector(".tx"), sp = tx ? tx.querySelector("span") : null;
        var dept = "";
        if (tx) for (var n = tx.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) dept += n.nodeValue;
        var school = sp ? sp.textContent.trim() : "";
        var logoImg = el.querySelector("img"), lg = logoImg ? pic(logoImg, 190, 70) : null;
        var HB = { top: NB, left: NB, right: NB, bottom: { style: D.BorderStyle.SINGLE, size: 24, color: CL } };
        var tc = hexOf(tx ? cs(tx).color : "") || CL;
        add(table([new D.TableRow({ children: [
          cell([para([runs(dept.trim(), { bold: true, color: tc, size: 24 })], { alignment: CEN, spacing: { after: 20 } }),
                para([runs(school)], { alignment: CEN, spacing: { after: 0 } })], 3500, { borders: HB }),
          cell([empty()], W - 6706, { borders: HB }),
          cell([new D.Paragraph({ alignment: D.AlignmentType.LEFT, spacing: { after: 0 }, children: lg ? [lg] : [] })], 3206, { borders: HB })
        ] })], [3500, W - 6706, 3206]), 100);
      } else if (/\bbar\b/.test(cn)) {
        if (/\bpgb\b/.test(cn)) { ch.push(new D.Paragraph({ pageBreakBefore: true, spacing: { after: 0, line: 20, lineRule: D.LineRuleType.EXACT }, children: [] })); first = true; }
        add(table([new D.TableRow({ children: [cell([para([runs(el.textContent.trim(), { bold: true, color: "FFFFFF", size: 30 })],
          { alignment: CEN, spacing: { before: 40, after: 40 } })], W, { shading: fill(hexOf(cs(el).backgroundColor) || CL) })] })], [W]), 100);
      } else if (/\binfo\b/.test(cn) && /\brow1\b/.test(cn)) {
        var rc = Array.prototype.slice.call(el.children), cw1 = Math.floor(W / rc.length), ws1 = rc.map(function () { return cw1; });
        ws1[0] += W - cw1 * rc.length;
        add(table([new D.TableRow({ children: rc.map(function (d, k) {
          return cell([para([inline(d)], { alignment: alignOf(d), spacing: { after: 0 } })], ws1[k], { borders: BOX });
        }) })], ws1), 100);
      } else if (/\binfo\b/.test(cn)) {
        var cellsEl = Array.prototype.slice.call(el.children), rows = [], pend = null;
        var ic = function (d, w, span) {
          return cell([para([inline(d)], { alignment: alignOf(d), spacing: { after: 0 } })], w,
            Object.assign({ borders: BOX }, span ? { columnSpan: 2 } : {}));
        };
        cellsEl.forEach(function (d, i) {
          var wide = /\bw\b/.test(d.className);
          if (wide) {
            if (pend) { rows.push(new D.TableRow({ children: [ic(pend, W / 2), cell([empty()], W / 2)] })); pend = null; }
            rows.push(new D.TableRow({ children: [ic(d, W, true)] }));
          } else if (pend) { rows.push(new D.TableRow({ children: [ic(pend, W / 2), ic(d, W / 2)] })); pend = null; }
          else pend = d;
        });
        if (pend) rows.push(new D.TableRow({ children: [ic(pend, W / 2), cell([empty()], W / 2)] }));
        if (rows.length) add(table(rows, [W / 2, W / 2]), 100);
      } else if (/\btwo-c\b/.test(cn)) {
        var secs = Array.prototype.slice.call(el.children), half = Math.floor(W / 2);
        add(table([new D.TableRow({ cantSplit: false, children: secs.map(function (s) {
          return /\bsec\b/.test(s.className) ? cell(secContent(s, half - 500), half, { borders: BOX, margins: BIGM }) : cell([empty()], half);
        }) })], [half, half]), 100);
      } else if (/\bsec\b/.test(cn)) {
        var bigT = el.querySelector("table.q");
        if (bigT && bigT.rows.length > 10) {
          secContent(el, W).forEach(function (x) { add(x, 60); });
        } else add(secBox(el), 100);
      } else if (el.tagName === "TABLE") {
        var tt2 = tableFrom(el, W); if (tt2) add(tt2, 100);
      } else if (/\bnb\b/.test(cn)) {
        add(table([new D.TableRow({ children: [cell([para([inline(el)], { alignment: alignOf(el), spacing: { after: 0 } })], W, { borders: BOX, margins: BIGM })] })], [W]), 100);
      } else if (/^sig/.test(cn)) {
        var cols = Array.prototype.slice.call(el.children), cw = Math.floor(W / cols.length);
        var sc = cols.map(function (d) {
          var k = [];
          for (var n2 = d.firstChild; n2; n2 = n2.nextSibling) {
            if (n2.nodeType === 3) { var tv = n2.nodeValue.trim(); if (tv) k.push(para([runs(tv)], { alignment: CEN, spacing: { after: 0 } })); }
            else if (n2.nodeType === 1) {
              if (n2.tagName === "B") k.push(para([runs(n2.textContent.trim(), { bold: true, color: hexOf(cs(n2).color) || CL })], { alignment: CEN, spacing: { after: 40 } }));
              else if (/\bst\b/.test(n2.className)) {
                var si = n2.querySelector("img"), sp2 = si ? pic(si, 80, 60) : null;
                k.push(new D.Paragraph({ alignment: CEN, spacing: { after: 0 }, children: sp2 ? [sp2] : runs(" ") }));
              } else if (/\bsg\b/.test(n2.className)) {
                if (cs(n2).display !== "none") k.push(empty(300));
              }
            }
          }
          return cell(k, cw);
        });
        sigTable = table([new D.TableRow({ cantSplit: true, children: sc })], cols.map(function () { return cw; }));
      } else if (/\bband\b/.test(cn)) {
        footer = mkFooter((sigTable ? [sigTable, gap(80)] : []).concat([
          table([new D.TableRow({ height: { value: 260, rule: D.HeightRule.EXACT }, children: [cell([empty()], W, { shading: fill(CL), margins: { top: 0, bottom: 0, left: 0, right: 0 } })] })], [W]),
          new D.Paragraph({ spacing: { after: 0, line: 20, lineRule: D.LineRuleType.EXACT }, children: [] })
        ]));
      }
    }
    ch.push(empty());
    if (!footer && sigTable) footer = mkFooter([sigTable, empty()]);

    var decoBody = null;
    if (DECO) {
      try {
        var TW = 30, TH = 120, SC = 3;
        var loadI = function (u) { return new Promise(function (ok) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { ok(null); }; im.src = u; }); };
        var mkPng = async function (uri) {
          if (!uri) return null;
          var im = await loadI(uri); if (!im) return null;
          var c = document.createElement("canvas"); c.width = TW * SC; c.height = TH * SC * DNT; var x = c.getContext("2d");
          for (var t = 0; t < DNT; t++) x.drawImage(im, 0, t * TH * SC, TW * SC, TH * SC);
          return c.toDataURL("image/png");
        };
        var pr = await mkPng(opt.deco.r), pl = await mkPng(opt.deco.l);
        if (pr || pl) decoBody = wrapDeco(ch, pr, pl);
      } catch (e) { decoBody = null; }
    }
    var sect = { properties: { page: { size: LAND ? { width: 11906, height: 16838, orientation: D.PageOrientation.LANDSCAPE } : { width: 11906, height: 16838 }, margin: { top: 850, bottom: 900, left: DECO && decoBody ? Math.round((11906 - W - 2 * SIDE) / 2) : 850, right: DECO && decoBody ? Math.round((11906 - W - 2 * SIDE) / 2) : 850, footer: 360 } } }, children: decoBody || ch };
    var DEMO = location.pathname.indexOf("/demo") === 0;
    var demoP = function () { return new D.Paragraph({ alignment: CEN, bidirectional: true, spacing: { before: 40, after: 40 }, children: runs("نسخة تجريبية — مُيَسِّر التقارير المدرسية — اشترك للحصول على النسخة الكاملة", { bold: true, color: "B42318", size: 26 }) }); };
    if (footer) sect.footers = { default: footer };
    if (DEMO) sect.headers = { default: new D.Header({ children: [demoP()].concat(hdrArr.length ? hdrArr.concat([gap(60)]) : []) }) };
    else if (hdrArr.length) sect.headers = { default: new D.Header({ children: hdrArr.concat([gap(60)]) }) };
    var doc = new D.Document({
      creator: "مُيَسِّر التقارير المدرسية", title: opt.title || "تقرير",
      styles: { default: { document: { run: { font: FN, size: 22, rightToLeft: true } } } },
      sections: [sect]
    });
    return D.Packer.toBlob(doc);
  };
})();
