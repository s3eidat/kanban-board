/* Kanban Board — boards live in localStorage (S3.store). Drag and drop uses pointer events (mouse, pen, touch). */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$, h = S3.h;
  var KEY = "kanban.data";
  var COLORS = ["", "red", "orange", "yellow", "green", "blue", "purple"];
  var data, board, query = "";
  var boardEl = $("#board");

  // ---------- pure helpers (tested) ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function parseISO(s) { var p = s.split("-"); return new Date(+p[0], p[1] - 1, +p[2]); }
  function dayDiff(due, today) { return Math.round((parseISO(due) - parseISO(today)) / 864e5); }
  function dueStatus(due, today) {
    if (!due) return "";
    var d = dayDiff(due, today);
    return d < 0 ? "overdue" : d === 0 ? "today" : d <= 2 ? "soon" : "later";
  }
  function dueLabel(due, today) {
    var d = dayDiff(due, today), dt = parseISO(due);
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    if (d === -1) return "Yesterday";
    return dt.toLocaleDateString("en-GB", { weekday: d > 0 && d < 7 ? "short" : undefined, day: "numeric", month: "short" });
  }
  // Move a card to column toCol at index (index counted with the card already removed).
  function moveCard(b, id, toCol, index) {
    var col = b.columns.filter(function (c) { return c.id === toCol; })[0], card = null;
    if (!col) return false;
    b.columns.forEach(function (c) { var i = c.cards.findIndex(function (k) { return k.id === id; }); if (i >= 0) card = c.cards.splice(i, 1)[0]; });
    if (!card) return false;
    col.cards.splice(Math.max(0, Math.min(index, col.cards.length)), 0, card);
    return true;
  }
  function matches(k, q) {
    q = q.trim().toLowerCase();
    return !q || q.split(/\s+/).every(function (w) { return (k.title + " " + k.notes).toLowerCase().indexOf(w) >= 0; });
  }

  // ---------- untrusted data → known shape ----------
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function cleanBoards(list) {
    var seen = {};
    function id(v) { var x = typeof v === "string" && /^[a-z0-9]{1,24}$/i.test(v) && !seen[v] ? v : uid(); while (seen[x]) x = uid(); seen[x] = 1; return x; }
    return arr(list).slice(0, 50).map(function (b) {
      b = obj(b);
      return {
        id: id(b.id), name: str(b.name, 60).trim() || "Untitled board",
        columns: arr(b.columns).slice(0, 30).map(function (c) {
          c = obj(c);
          return {
            id: id(c.id), name: str(c.name, 40).trim() || "Column",
            cards: arr(c.cards).slice(0, 2000).map(function (k) {
              k = obj(k);
              return { id: id(k.id), title: str(k.title, 300).trim() || "Untitled", notes: str(k.notes, 5000), color: COLORS.indexOf(k.color) >= 0 ? k.color : "",
                due: typeof k.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k.due) ? k.due : "" };
            })
          };
        })
      };
    });
  }
  function freshBoard(name) {
    return cleanBoards([{ name: name || "My board", columns: [{ name: "To do" }, { name: "Doing" }, { name: "Done" }] }])[0];
  }

  // ---------- storage ----------
  function persist() {
    data.current = board.id;
    if (S3.store(KEY, data) === undefined) S3.toast("Couldn't save — export your boards to keep them safe", "error");
  }
  function today() { return iso(new Date()); }

  // ---------- render ----------
  function fillPick() {
    var p = $("#boardPick"); p.textContent = "";
    data.boards.forEach(function (b) { p.appendChild(h("option", { value: b.id, text: b.name })); });
    p.value = board.id;
  }
  function cardEl(k, t) {
    var st = dueStatus(k.due, t);
    return h("div", { "class": "kcard" + (k.color ? " c-" + k.color : ""), tabindex: "0", role: "button", "data-id": k.id, "aria-label": "Card: " + k.title }, [
      h("div", { "class": "k-top" }, [h("b", { "class": "k-title", dir: "auto", text: k.title }), h("span", { "class": "grip", title: "Drag", "aria-hidden": "true", text: "⠿" })]),
      k.notes ? h("p", { "class": "k-notes", dir: "auto", text: k.notes }) : null,
      k.due ? h("span", { "class": "chip k-due " + st, text: (st === "overdue" ? "Overdue · " : "") + dueLabel(k.due, t) }) : null
    ]);
  }
  function render() {
    var t = today(), total = 0, shown = 0;
    boardEl.textContent = "";
    board.columns.forEach(function (c, ci) {
      var list = h("div", { "class": "cards", "data-col": c.id });
      c.cards.forEach(function (k) { total++; if (matches(k, query)) { shown++; list.appendChild(cardEl(k, t)); } });
      if (!c.cards.length) list.appendChild(h("div", { "class": "col-empty", text: "Drop cards here" }));
      boardEl.appendChild(h("section", { "class": "col", "data-col": c.id }, [
        h("header", { "class": "col-head" }, [
          h("input", { "class": "col-name", value: c.name, "data-col": c.id, maxlength: "40", dir: "auto", "aria-label": "Column name" }),
          h("span", { "class": "chip", text: String(c.cards.length) }),
          h("button", { "class": "btn ghost icon small", "data-coldel": c.id, "aria-label": "Delete column " + c.name, title: "Delete column", html: S3.icon("trash") })
        ]),
        list,
        h("div", { "class": "add-wrap" }, [
          h("button", { "class": "btn ghost small add-card", "data-add": c.id, html: S3.icon("plus") + "Add card" + (ci === 0 ? " <kbd>N</kbd>" : "") })
        ])
      ]));
    });
    if (!board.columns.length) boardEl.appendChild(h("div", { "class": "empty card" }, [h("b", { text: "No columns yet" }), "Add a column to get started."]));
    $("#q").title = query ? shown + " of " + total + " cards match" : "";
  }
  function all() { fillPick(); render(); }

  // ---------- quick add ----------
  function quickAdd(colId) {
    var wrap = $(".col[data-col='" + colId + "'] .add-wrap");
    if (!wrap) return;
    var input = h("textarea", { "class": "input quick", rows: "2", dir: "auto", maxlength: "300", placeholder: "Card title — Enter to add, Esc to close", "aria-label": "New card title" });
    wrap.textContent = ""; wrap.appendChild(input); input.focus();
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        var title = input.value.trim(); if (!title) return;
        var col = board.columns.filter(function (c) { return c.id === colId; })[0];
        col.cards.push({ id: uid(), title: title.slice(0, 300), notes: "", color: "", due: "" });
        persist(); query = ""; $("#q").value = ""; render(); quickAdd(colId);
      } else if (e.key === "Escape") render();
    });
    input.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement !== input && input.isConnected) render(); }, 150); });
  }

  // ---------- card dialog ----------
  var dlg = $("#dlg"), editing = null, pickedColor = "";
  COLORS.forEach(function (c) {
    $("#fColors").appendChild(h("button", { type: "button", "class": "swatch" + (c ? " c-" + c : " none"), "data-color": c, "aria-label": c ? c + " label" : "No label", title: c || "none" }));
  });
  function findCard(id) {
    var r = null;
    board.columns.forEach(function (c) { c.cards.forEach(function (k) { if (k.id === id) r = { card: k, col: c }; }); });
    return r;
  }
  function openCard(id) {
    var r = findCard(id); if (!r) return;
    editing = r;
    $("#fTitle").value = r.card.title; $("#fNotes").value = r.card.notes; $("#fDue").value = r.card.due;
    var sel = $("#fCol"); sel.textContent = "";
    board.columns.forEach(function (c) { sel.appendChild(h("option", { value: c.id, text: c.name })); });
    sel.value = r.col.id;
    setColor(r.card.color);
    dlg.showModal(); $("#fTitle").focus();
  }
  function setColor(c) { pickedColor = c; $$(".swatch", dlg).forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.color === c)); }); }
  $("#fColors").addEventListener("click", function (e) { var b = e.target.closest(".swatch"); if (b) setColor(b.dataset.color); });
  function save() {
    var k = editing.card;
    k.title = $("#fTitle").value.trim().slice(0, 300) || k.title;
    k.notes = $("#fNotes").value.slice(0, 5000);
    k.due = /^\d{4}-\d{2}-\d{2}$/.test($("#fDue").value) ? $("#fDue").value : "";
    k.color = pickedColor;
    var to = $("#fCol").value;
    if (to !== editing.col.id) moveCard(board, k.id, to, Infinity);
    persist(); render();
  }
  dlg.addEventListener("click", function (e) {
    if (e.target === dlg) { dlg.close(); return; }
    var b = e.target.closest("[data-act]"); if (!b) return;
    if (b.dataset.act === "save") save();
    if (b.dataset.act === "delete") deleteCard(editing.card.id);
    dlg.close();
  });
  $("#fTitle").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); save(); dlg.close(); } });
  function deleteCard(id) {
    var r = findCard(id); if (!r) return;
    var at = r.col.cards.indexOf(r.card), colId = r.col.id, card = r.card;
    r.col.cards.splice(at, 1); persist(); render();
    var t = S3.toast("Card deleted ");
    t.appendChild(h("button", { "class": "btn small", text: "Undo", onclick: function () {
      var col = board.columns.filter(function (c) { return c.id === colId; })[0] || board.columns[0];
      if (col) { col.cards.splice(Math.min(at, col.cards.length), 0, card); persist(); render(); }
      t.remove();
    } }));
  }

  // ---------- board events ----------
  var justDragged = 0;
  boardEl.addEventListener("click", function (e) {
    if (Date.now() - justDragged < 250) return;
    var add = e.target.closest("[data-add]"); if (add) { quickAdd(add.dataset.add); return; }
    var del = e.target.closest("[data-coldel]");
    if (del) {
      var at = board.columns.findIndex(function (c) { return c.id === del.dataset.coldel; }), col = board.columns[at];
      board.columns.splice(at, 1); persist(); render();
      var t = S3.toast("Deleted column “" + col.name + "”" + (col.cards.length ? " and its " + col.cards.length + " card" + (col.cards.length === 1 ? "" : "s") : "") + " ");
      t.appendChild(h("button", { "class": "btn small", text: "Undo", onclick: function () { board.columns.splice(at, 0, col); persist(); render(); t.remove(); } }));
      return;
    }
    var card = e.target.closest(".kcard"); if (card) openCard(card.dataset.id);
  });
  boardEl.addEventListener("keydown", function (e) {
    var card = e.target.closest(".kcard");
    if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openCard(card.dataset.id); }
    if (card && e.key === "Delete") deleteCard(card.dataset.id);
    if (e.target.classList.contains("col-name") && e.key === "Enter") e.target.blur();
  });
  boardEl.addEventListener("change", function (e) {
    if (!e.target.classList.contains("col-name")) return;
    var c = board.columns.filter(function (x) { return x.id === e.target.dataset.col; })[0];
    c.name = e.target.value.trim().slice(0, 40) || c.name; e.target.value = c.name; persist();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !dlg.open && board.columns[0]) {
      e.preventDefault(); quickAdd(board.columns[0].id);
    }
  });

  // ---------- drag and drop (pointer events) ----------
  var drag = null;
  boardEl.addEventListener("pointerdown", function (e) {
    var card = e.target.closest(".kcard");
    if (!card || e.button > 0) return;
    if (e.pointerType === "touch" && !e.target.closest(".grip")) return; // touch scrolls unless you grab the handle
    drag = { id: card.dataset.id, el: card, x0: e.clientX, y0: e.clientY, started: false };
  });
  function startDrag(e) {
    if (query) { S3.toast("Clear the search to drag cards"); drag = null; return; }
    var r = drag.el.getBoundingClientRect();
    drag.started = true; drag.dx = e.clientX - r.left; drag.dy = e.clientY - r.top;
    drag.ghost = drag.el.cloneNode(true); drag.ghost.classList.add("drag-ghost"); drag.ghost.style.width = r.width + "px";
    document.body.appendChild(drag.ghost);
    drag.ph = h("div", { "class": "placeholder" }); drag.ph.style.height = r.height + "px";
    drag.el.parentNode.insertBefore(drag.ph, drag.el);
    drag.el.hidden = true;
    document.body.classList.add("is-dragging");
  }
  function moveDrag(e) {
    drag.ghost.style.transform = "translate(" + (e.clientX - drag.dx) + "px," + (e.clientY - drag.dy) + "px) rotate(2deg)";
    var under = document.elementFromPoint(e.clientX, e.clientY), col = under && under.closest(".col");
    if (col) {
      var list = $(".cards", col), before = null;
      $$(".kcard", list).some(function (k) {
        if (k === drag.el) return false;
        var r = k.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { before = k; return true; }
        return false;
      });
      var empty = $(".col-empty", list); if (empty) empty.hidden = true;
      if (before) list.insertBefore(drag.ph, before); else list.appendChild(drag.ph);
    }
    var br = boardEl.getBoundingClientRect();
    if (e.clientX > br.right - 40) boardEl.scrollLeft += 14; else if (e.clientX < br.left + 40) boardEl.scrollLeft -= 14;
    if (e.clientY > innerHeight - 40) window.scrollBy(0, 12); else if (e.clientY < 40) window.scrollBy(0, -12);
  }
  window.addEventListener("pointermove", function (e) {
    if (!drag) return;
    if (!drag.started) { if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return; startDrag(e); if (!drag) return; }
    e.preventDefault(); moveDrag(e);
  }, { passive: false });
  function endDrag(commit) {
    if (!drag) return;
    if (drag.started) {
      var list = drag.ph.parentNode, index = 0;
      if (commit && list) {
        for (var n = list.firstChild; n && n !== drag.ph; n = n.nextSibling) if (n.classList.contains("kcard") && n !== drag.el) index++;
        moveCard(board, drag.id, list.dataset.col, index); persist();
      }
      drag.ghost.remove(); document.body.classList.remove("is-dragging");
      justDragged = Date.now(); render();
    }
    drag = null;
  }
  window.addEventListener("pointerup", function () { endDrag(true); });
  window.addEventListener("pointercancel", function () { endDrag(false); });
  boardEl.addEventListener("touchmove", function (e) { if (drag && drag.started) e.preventDefault(); }, { passive: false });

  // ---------- toolbar ----------
  $("#boardPick").addEventListener("change", function (e) {
    board = data.boards.filter(function (b) { return b.id === e.target.value; })[0] || board; query = ""; $("#q").value = ""; persist(); all();
  });
  $("#boardNew").addEventListener("click", function () {
    var b = freshBoard("Board " + (data.boards.length + 1)); data.boards.push(b); board = b; persist(); all();
    S3.toast("New board created — rename it any time");
  });
  $("#boardRename").addEventListener("click", function () {
    var n = window.prompt("Board name", board.name);
    if (n && n.trim()) { board.name = n.trim().slice(0, 60); persist(); fillPick(); }
  });
  $("#boardDel").addEventListener("click", function () {
    var gone = board, at = data.boards.indexOf(gone);
    data.boards.splice(at, 1);
    if (!data.boards.length) data.boards.push(freshBoard());
    board = data.boards[0]; persist(); all();
    var t = S3.toast("Deleted board “" + gone.name + "” ");
    t.appendChild(h("button", { "class": "btn small", text: "Undo", onclick: function () { data.boards.splice(at, 0, gone); board = gone; persist(); all(); t.remove(); } }));
  });
  $("#colAdd").addEventListener("click", function () {
    if (board.columns.length >= 30) { S3.toast("That's a lot of columns — 30 max", "error"); return; }
    var c = { id: uid(), name: "New column", cards: [] }; board.columns.push(c); persist(); render();
    var inp = $(".col-name[data-col='" + c.id + "']"); if (inp) { inp.focus(); inp.select(); inp.scrollIntoView({ inline: "end", block: "nearest" }); }
  });
  $("#q").addEventListener("input", S3.debounce(function (e) { query = e.target.value; render(); }, 120));
  $("#exp").addEventListener("click", function () {
    persist();
    S3.download(JSON.stringify({ app: "s3-kanban-board", version: 1, boards: data.boards }, null, 2), "kanban-boards.json", "application/json"); S3.done();
  });
  $("#imp input").addEventListener("change", function (e) {
    var f = e.target.files[0]; e.target.value = ""; if (!f) return;
    if (f.size > 20 * 1024 * 1024) { S3.toast("That file is too large", "error"); return; }
    S3.readFile(f, "text").then(function (t) {
      var d; try { d = JSON.parse(t); } catch (err) { S3.toast("Not valid JSON", "error"); return; }
      var raw = Array.isArray(d) ? d : d && Array.isArray(d.boards) ? d.boards : d && Array.isArray(d.columns) ? [d] : null;
      if (!raw || !raw.length) { S3.toast("No boards found in that file", "error"); return; }
      // Re-clean together with the existing boards so every id stays unique.
      var merged = cleanBoards(data.boards.concat(raw)), added = merged.slice(data.boards.length);
      data.boards = merged; board = added[0]; persist(); all();
      S3.toast("Imported " + added.length + " board" + (added.length === 1 ? "" : "s")); S3.done();
    });
  });

  // ---------- boot ----------
  var stored = obj(S3.store(KEY));
  data = { boards: cleanBoards(stored.boards) };
  if (!data.boards.length) {
    var first = freshBoard();
    first.columns[0].cards.push({ id: uid(), title: "Welcome! Click me to edit", notes: "Drag cards between columns. Everything stays in this browser.", color: "blue", due: "" });
    data.boards.push(first);
  }
  board = data.boards.filter(function (b) { return b.id === stored.current; })[0] || data.boards[0];
  all();

  window.S3_DEMO = function () {
    var t = new Date(), d = function (n) { var x = new Date(t); x.setDate(x.getDate() + n); return iso(x); };
    var b = cleanBoards([{ name: "Website relaunch", columns: [
      { name: "Backlog", cards: [{ title: "Collect customer testimonials", color: "purple" }, { title: "Compare hosting plans", notes: "Need SSL + daily backups", due: d(6) }, { title: "New logo variations", color: "orange" }] },
      { name: "In progress", cards: [{ title: "Write homepage copy", notes: "Short, friendly, mention free delivery.", color: "blue", due: d(1) }, { title: "Product photos", color: "green", due: d(0) }] },
      { name: "Review", cards: [{ title: "Pricing page", notes: "Check VAT wording", color: "yellow", due: d(-1) }] },
      { name: "Done", cards: [{ title: "Pick colour palette", color: "green" }, { title: "Register domain" }] }
    ] }])[0];
    data.boards = [b]; board = b; persist(); all();
  };

  window.S3_SELFTEST = function () {
    var b = cleanBoards([{ name: "T", columns: [{ id: "a", cards: [{ id: "k1", title: "1" }, { id: "k2", title: "2" }, { id: "k3", title: "3" }] }, { id: "b", cards: [] }] }])[0];
    var ids = function (c) { return b.columns[c].cards.map(function (k) { return k.id; }).join(","); };
    moveCard(b, "k1", "a", 2); var m1 = ids(0) === "k2,k3,k1";
    moveCard(b, "k3", "a", 0); var m2 = ids(0) === "k3,k2,k1";
    moveCard(b, "k2", "b", 0); var m3 = ids(0) === "k3,k1" && ids(1) === "k2";
    var m4 = moveCard(b, "nope", "b", 0) === false && moveCard(b, "k1", "zzz", 0) === false && ids(0) === "k3,k1";
    var okD = dueStatus("2026-10-25", "2026-10-26") === "overdue" && dueStatus("2026-10-26", "2026-10-26") === "today" && dueStatus("2026-10-28", "2026-10-26") === "soon" &&
      dueStatus("2026-11-30", "2026-10-26") === "later" && dueStatus("", "2026-10-26") === "" && dayDiff("2027-03-28", "2027-03-27") === 1 && dueLabel("2026-10-27", "2026-10-26") === "Tomorrow";
    var src = cleanBoards([{ name: "R ✓", columns: [{ name: "C", cards: [{ title: "x", notes: "n", color: "red", due: "2026-01-02" }] }] }]);
    var okR = JSON.stringify(cleanBoards(JSON.parse(JSON.stringify(src)))) === JSON.stringify(src);
    var bad = cleanBoards([{ id: "dup", columns: "x" }, { id: "dup", name: { a: 1 }, columns: [{ cards: [{ title: "<img src=x>", color: "javascript:", due: "soon" }, 5] }] }, 7]);
    var okB = bad.length === 3 && bad[0].id !== bad[1].id && bad[0].columns.length === 0 && bad[1].name === "Untitled board" &&
      bad[1].columns[0].cards[0].color === "" && bad[1].columns[0].cards[0].due === "" && bad[1].columns[0].cards[1].title === "Untitled";
    var okM = matches({ title: "Write copy", notes: "homepage" }, "HOME write") && !matches({ title: "a", notes: "" }, "b");
    return m1 && m2 && m3 && m4 && okD && okR && okB && okM;
  };
})();
