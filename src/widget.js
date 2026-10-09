// SiteChat AI widget. Zero dependencies, one script tag, works on any site:
//   <script src="https://your-host/widget/embed.js" data-site="mybusiness"></script>
// The server serves this file verbatim at GET /widget/embed.js.

(function () {
  if (window.__sitechatLoaded) return;
  window.__sitechatLoaded = true;

  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName("script");
    return s[s.length - 1];
  })();

  var SITE = script.getAttribute("data-site") || "default";
  var src = script.getAttribute("src") || "";
  var BASE = src.replace(/\/widget\/embed\.js.*$/, "");

  var bubble = document.createElement("div");
  bubble.id = "wcb-bubble";
  var panel = document.createElement("div");
  panel.id = "wcb-panel";

  var style = document.createElement("style");
  style.textContent = [
    "#wcb-bubble{position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.28);z-index:2147483000;font-family:inherit;line-height:1}",
    "#wcb-bubble:hover{transform:scale(1.06)}",
    "#wcb-panel{position:fixed;bottom:92px;right:20px;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;z-index:2147483001;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}",
    "#wcb-panel.open{display:flex}",
    "#wcb-head{background:#2563eb;color:#fff;padding:14px 16px;font-weight:600;font-size:15px;display:flex;justify-content:space-between;align-items:center}",
    "#wcb-head button{background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1}",
    "#wcb-msgs{flex:1;overflow-y:auto;padding:12px;background:#f7f8fa;display:flex;flex-direction:column;gap:8px}",
    ".wcb-msg{max-width:82%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}",
    ".wcb-msg.bot{background:#fff;border:1px solid #e3e6ea;align-self:flex-start}",
    ".wcb-msg.me{background:#2563eb;color:#fff;align-self:flex-end}",
    ".wcb-typing{align-self:flex-start;color:#8a94a6;font-size:12px;padding:4px 2px}",
    "#wcb-quick{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px 0;background:#f7f8fa}",
    ".wcb-quick button{border:1px solid #2563eb;color:#2563eb;background:#fff;border-radius:14px;padding:5px 11px;font-size:12.5px;cursor:pointer}",
    "#wcb-form{display:flex;padding:10px 12px;border-top:1px solid #e3e6ea;background:#fff;gap:8px}",
    "#wcb-input{flex:1;border:1px solid #d3d8de;border-radius:10px;padding:9px 11px;font-size:14px;outline:none}",
    "#wcb-input:focus{border-color:#2563eb}",
    "#wcb-send{background:#2563eb;color:#fff;border:none;border-radius:10px;padding:0 16px;font-size:14px;cursor:pointer}",
    "#wcb-lead{display:none;padding:12px;border-top:1px solid #e3e6ea;background:#fff;flex-direction:column;gap:8px}",
    "#wcb-lead input{border:1px solid #d3d8de;border-radius:10px;padding:9px 11px;font-size:14px;outline:none}",
    "#wcb-offline{padding:8px 12px;background:#fff7e6;border-top:1px solid #ffe3a3;color:#8a5a00;font-size:12.5px;display:none}",
  ].join("\n");

  document.head.appendChild(style);
  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  bubble.innerHTML = "&#128172;";
  panel.innerHTML =
    '<div id="wcb-head"><span id="wcb-title">Chat</span><button id="wcb-close" title="Close">&times;</button></div>' +
    '<div id="wcb-quick"></div>' +
    '<div id="wcb-msgs"></div>' +
    '<div id="wcb-offline"></div>' +
    '<div id="wcb-lead">' +
    '<input id="wcb-lead-name" placeholder="Your name (optional)">' +
    '<input id="wcb-lead-contact" placeholder="Email or phone so we can reply">' +
    '<button id="wcb-lead-send">Send to the owner</button>' +
    "</div>" +
    '<form id="wcb-form"><input id="wcb-input" placeholder="Type your message..." autocomplete="off"><button id="wcb-send" type="submit">Send</button></form>';

  var msgs = document.getElementById("wcb-msgs");
  var input = document.getElementById("wcb-input");
  var form = document.getElementById("wcb-form");
  var leadBox = document.getElementById("wcb-lead");
  var offline = document.getElementById("wcb-offline");
  var quick = document.getElementById("wcb-quick");
  var sessionId = null;
  var busy = false;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function add(text, cls) {
    var d = document.createElement("div");
    d.className = "wcb-msg " + cls;
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function typing(on) {
    var t = document.getElementById("wcb-typing");
    if (on && !t) {
      t = document.createElement("div");
      t.id = "wcb-typing";
      t.className = "wcb-typing";
      t.textContent = "typing...";
      msgs.appendChild(t);
      msgs.scrollTop = msgs.scrollHeight;
    } else if (!on && t) {
      t.remove();
    }
  }

  bubble.addEventListener("click", function () {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) input.focus();
  });
  document.getElementById("wcb-close").addEventListener("click", function () {
    panel.classList.remove("open");
  });

  function send(message) {
    if (busy || !message.trim()) return;
    busy = true;
    add(message, "me");
    input.value = "";
    typing(true);
    leadBox.style.display = "none";

    fetch(BASE + "/api/" + SITE + "/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: message, sessionId: sessionId }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        typing(false);
        busy = false;
        if (data.sessionId) sessionId = data.sessionId;
        add(data.reply || "Sorry, something went wrong. Could you leave your contact details below?", "bot");
        if (data.collect_contact) leadBox.style.display = "flex";
      })
      .catch(function () {
        typing(false);
        busy = false;
        add("I can't reach the server right now. Please leave your email or phone below and we'll reply as soon as we're back.", "bot");
        leadBox.style.display = "flex";
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    send(input.value);
  });

  document.getElementById("wcb-lead-send").addEventListener("click", function () {
    var contact = document.getElementById("wcb-lead-contact").value.trim();
    if (!contact) {
      document.getElementById("wcb-lead-contact").focus();
      return;
    }
    var name = document.getElementById("wcb-lead-name").value.trim();
    fetch(BASE + "/api/" + SITE + "/lead", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId, name: name, contact: contact }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data.ok) {
          add("Thanks! The owner will get back to you shortly.", "bot");
          leadBox.style.display = "none";
          document.getElementById("wcb-lead-contact").value = "";
          document.getElementById("wcb-lead-name").value = "";
        } else {
          add("Please check the details you entered and try again.", "bot");
        }
      })
      .catch(function () {
        add("Please try again in a moment.", "bot");
      });
  });

  fetch(BASE + "/api/" + SITE + "/config")
    .then(function (r) {
      return r.status === 200 ? r.json() : null;
    })
    .then(function (cfg) {
      if (!cfg) return;
      document.getElementById("wcb-title").textContent = cfg.name || "Chat";
      if (cfg.offlineMessage) {
        offline.textContent = cfg.offlineMessage;
        offline.style.display = "block";
      }
      (cfg.quickReplies || []).forEach(function (q) {
        var b = document.createElement("button");
        b.className = "wcb-quick-btn";
        b.textContent = q;
        b.addEventListener("click", function () {
          send(q);
        });
        quick.appendChild(b);
      });
    })
    .catch(function () {});

  add("Hi! Ask me anything about us, and I'll do my best to help.", "bot");
})();
