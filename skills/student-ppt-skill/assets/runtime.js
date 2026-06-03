/*
 * runtime.js — 展示轨运行时
 * ① 固定 1920×1080 舞台等比缩放（借鉴 frontend-slides 范式）
 * ② 键盘/触摸翻页（visibility/opacity，不用 display:none）
 * ③ 总览网格（O）
 * ④ 演讲者模式（S）：当前页/下一页/逐字稿/计时器，window.opener.postMessage 同步（兼容 file://）
 * ⑤ ?preview=N 单页无 chrome 模式
 */
(function () {
  'use strict';

  var STAGE_W = 1920, STAGE_H = 1080;
  var stage = document.querySelector('.deck-stage');
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  if (!stage || slides.length === 0) return;

  var params = new URLSearchParams(location.search);

  /* ---------- 等比缩放 ---------- */
  function fitScale() {
    var sw = window.innerWidth / STAGE_W;
    var sh = window.innerHeight / STAGE_H;
    var scale = Math.min(sw, sh);
    stage.style.transform = 'scale(' + scale + ')';
  }
  window.addEventListener('resize', fitScale);

  /* ---------- 预览模式 ---------- */
  if (params.has('preview')) {
    var pn = parseInt(params.get('preview'), 10) || 1;
    document.body.classList.add('preview-mode');
    slides.forEach(function (s, i) { s.classList.toggle('is-active', (i + 1) === pn); });
    fitScale();
    return;
  }

  /* ---------- 正常放映 ---------- */
  var index = 0;
  var total = slides.length;
  var progress = document.querySelector('.deck-progress');
  var presenterWin = null;

  function render() {
    slides.forEach(function (s, i) { s.classList.toggle('is-active', i === index); });
    if (progress) progress.style.width = ((index + 1) / total * 100) + '%';
    if (location.hash !== '#/' + (index + 1)) {
      try { history.replaceState(null, '', '#/' + (index + 1)); } catch (_) {}
    }
    broadcastState();
  }
  function go(i) { index = Math.max(0, Math.min(total - 1, i)); render(); }
  function next() { if (index < total - 1) go(index + 1); }
  function prev() { if (index > 0) go(index - 1); }

  /* ---------- 演讲者状态同步 ---------- */
  function slideInfo(i) {
    if (i < 0 || i >= total) return { title: '', notes: '' };
    var s = slides[i];
    var titleEl = s.querySelector('.slide-title');
    var notesEl = s.querySelector('.notes');
    return {
      title: titleEl ? titleEl.textContent.trim() : ('第 ' + (i + 1) + ' 页'),
      notes: notesEl ? notesEl.textContent.trim() : ''
    };
  }
  function broadcastState() {
    if (!presenterWin || presenterWin.closed) return;
    presenterWin.postMessage({
      type: 'state', index: index, total: total,
      current: slideInfo(index), next: slideInfo(index + 1)
    }, '*');
  }
  window.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.type === 'nav') { m.dir === 'next' ? next() : prev(); }
    else if (m.type === 'goto') { go(m.index); }
    else if (m.type === 'request-state') { broadcastState(); }
  });

  /* ---------- 键盘 / 触摸 ---------- */
  document.addEventListener('keydown', function (e) {
    if (overviewOpen && e.key !== 'Escape' && e.key !== 'o' && e.key !== 'O') return;
    switch (e.key) {
      case 'ArrowRight': case ' ': case 'PageDown': case 'ArrowDown': e.preventDefault(); next(); break;
      case 'ArrowLeft': case 'PageUp': case 'ArrowUp': e.preventDefault(); prev(); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(total - 1); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'o': case 'O': toggleOverview(); break;
      case 's': case 'S': openPresenter(); break;
      case 'Escape': if (overviewOpen) toggleOverview(); break;
    }
  });
  var tx = 0;
  document.addEventListener('touchstart', function (e) { tx = e.changedTouches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    var dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 60) { dx < 0 ? next() : prev(); }
  }, { passive: true });

  function toggleFullscreen() {
    if (!document.fullscreenElement) { (document.documentElement.requestFullscreen || function () {}).call(document.documentElement); }
    else { (document.exitFullscreen || function () {}).call(document); }
  }

  /* ---------- 总览（O） ---------- */
  var overviewOpen = false, overviewEl = null;
  function toggleOverview() {
    if (overviewOpen) { overviewEl.classList.remove('open'); overviewOpen = false; return; }
    if (!overviewEl) buildOverview();
    overviewEl.classList.add('open');
    Array.prototype.forEach.call(overviewEl.querySelectorAll('.ov-cell'), function (c, i) {
      c.classList.toggle('current', i === index);
    });
    overviewOpen = true;
  }
  function buildOverview() {
    overviewEl = document.createElement('div');
    overviewEl.className = 'overview';
    var grid = document.createElement('div');
    grid.className = 'overview-grid';
    for (var i = 0; i < total; i++) {
      (function (i) {
        var cell = document.createElement('div');
        cell.className = 'ov-cell';
        var num = document.createElement('span');
        num.className = 'ov-num'; num.textContent = (i + 1);
        var iframe = document.createElement('iframe');
        iframe.loading = 'lazy';
        iframe.src = location.pathname + '?preview=' + (i + 1);
        iframe.addEventListener('load', function () { scaleCellIframe(cell, iframe); });
        cell.appendChild(num); cell.appendChild(iframe);
        cell.addEventListener('click', function () { go(i); toggleOverview(); });
        grid.appendChild(cell);
      })(i);
    }
    overviewEl.appendChild(grid);
    document.body.appendChild(overviewEl);
    window.addEventListener('resize', function () {
      if (overviewOpen) Array.prototype.forEach.call(overviewEl.querySelectorAll('.ov-cell'), function (cell) {
        scaleCellIframe(cell, cell.querySelector('iframe'));
      });
    });
  }
  function scaleCellIframe(cell, iframe) {
    if (!iframe) return;
    var s = cell.clientWidth / STAGE_W;
    iframe.style.transform = 'scale(' + s + ')';
    iframe.style.transformOrigin = 'top left';
  }

  /* ---------- 演讲者模式（S） ---------- */
  function openPresenter() {
    var win = window.open('', 'student-ppt-presenter', 'width=760,height=900');
    if (!win) { alert('浏览器拦截了演讲者窗口，请允许弹窗后重试。'); return; }
    presenterWin = win;
    win.document.open();
    win.document.write(presenterHTML());
    win.document.close();
    setTimeout(broadcastState, 200);
  }
  function presenterHTML() {
    var deckUrl = JSON.stringify(location.pathname);
    return [
'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>演讲者视图</title>',
'<style>',
'  *{box-sizing:border-box;margin:0;} body{background:#15140f;color:#eee;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;height:100vh;overflow:hidden;}',
'  .bar{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#0c0b08;border-bottom:1px solid #2a2823;}',
'  .bar button{background:#2a2823;color:#eee;border:1px solid #3a382f;border-radius:8px;padding:8px 14px;font-size:15px;cursor:pointer;}',
'  .bar button:hover{background:#3a382f;} .bar .grow{flex:1;}',
'  .card{position:absolute;background:#1c1a14;border:1px solid #34322a;border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.5);}',
'  .card h4{font-size:12px;letter-spacing:.08em;color:#a59c86;padding:8px 12px;background:#0f0e0a;cursor:move;text-transform:uppercase;user-select:none;}',
'  .card .frame{position:relative;background:#000;} .card iframe{border:0;transform-origin:top left;}',
'  #script{padding:16px 18px;font-size:26px;line-height:1.6;overflow:auto;color:#f3efe4;}',
'  #script b,#script strong{color:#ffd479;} #script .next-title{color:#9fd3a0;font-size:16px;margin-top:14px;}',
'  #timer{font-variant-numeric:tabular-nums;font-size:46px;font-weight:800;text-align:center;padding-top:16px;}',
'  #timer .sub{font-size:14px;color:#a59c86;font-weight:400;}',
'</style></head><body>',
'  <div class="bar">',
'    <button id="prev">◀ 上一页</button><button id="next">下一页 ▶</button>',
'    <span class="grow"></span>',
'    <span id="counter" style="font-size:15px;color:#a59c86;"></span>',
'    <button id="treset">计时归零</button>',
'  </div>',
'  <div class="card" id="cCur" style="left:16px;top:60px;width:340px;"><h4>当前页 Current</h4><div class="frame"><iframe id="fCur"></iframe></div></div>',
'  <div class="card" id="cNext" style="left:372px;top:60px;width:300px;"><h4>下一页 Next</h4><div class="frame"><iframe id="fNext"></iframe></div></div>',
'  <div class="card" id="cTimer" style="left:16px;top:280px;width:200px;height:130px;"><h4>计时 Timer</h4><div id="timer">00:00<div class="sub">已用时</div></div></div>',
'  <div class="card" id="cScript" style="left:16px;top:430px;width:656px;height:420px;"><h4>逐字稿 Speaker Script</h4><div id="script"></div></div>',
'<script>',
'  var DECK=' + deckUrl + ';',
'  var deck=window.opener;',
'  function send(m){ if(deck&&!deck.closed){ try{deck.postMessage(m,"*");}catch(_){} } }',
'  var fCur=document.getElementById("fCur"),fNext=document.getElementById("fNext");',
'  function frame(f,n){f.src=DECK+"?preview="+n;}',
'  function sizeFrames(){[["cCur",fCur],["cNext",fNext]].forEach(function(p){var card=document.getElementById(p[0]);var w=card.clientWidth;var s=w/1920;p[1].style.width="1920px";p[1].style.height="1080px";p[1].style.transform="scale("+s+")";card.querySelector(".frame").style.height=(1080*s)+"px";});}',
'  document.getElementById("prev").onclick=function(){send({type:"nav",dir:"prev"});};',
'  document.getElementById("next").onclick=function(){send({type:"nav",dir:"next"});};',
'  function fmt(s){var m=Math.floor(s/60),x=s%60;return (m<10?"0":"")+m+":"+(x<10?"0":"")+x;}',
'  var t=0,tid=setInterval(function(){t++;document.querySelector("#timer").firstChild.nodeValue=fmt(t);},1000);',
'  document.getElementById("treset").onclick=function(){t=0;document.querySelector("#timer").firstChild.nodeValue="00:00";};',
'  function esc(x){return String(x||"").replace(/[&<>]/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]);});}',
'  function render(m){',
'    frame(fCur,m.index+1); frame(fNext,Math.min(m.total,m.index+2)); sizeFrames();',
'    document.getElementById("counter").textContent=(m.index+1)+" / "+m.total;',
'    var html=(m.current.notes?esc(m.current.notes):"（本页暂无逐字稿）").replace(/\\n/g,"<br>");',
'    if(m.next&&m.next.title){html+="<div class=\\"next-title\\">下一页："+esc(m.next.title)+"</div>";}',
'    document.getElementById("script").innerHTML=html;',
'  }',
'  window.addEventListener("message",function(e){ if(e.data&&e.data.type==="state") render(e.data); });',
'  window.addEventListener("resize",sizeFrames);',
'  send({type:"request-state"});',
'  Array.prototype.forEach.call(document.querySelectorAll(".card"),function(card){',
'    var key="ppt-presenter-"+card.id; var saved=localStorage.getItem(key);',
'    if(saved){try{var p=JSON.parse(saved);card.style.left=p.l;card.style.top=p.t;}catch(_){}};',
'    var h=card.querySelector("h4"),drag=false,ox=0,oy=0;',
'    h.addEventListener("mousedown",function(e){drag=true;ox=e.clientX-card.offsetLeft;oy=e.clientY-card.offsetTop;e.preventDefault();});',
'    document.addEventListener("mousemove",function(e){if(!drag)return;card.style.left=(e.clientX-ox)+"px";card.style.top=(e.clientY-oy)+"px";});',
'    document.addEventListener("mouseup",function(){if(drag){drag=false;localStorage.setItem(key,JSON.stringify({l:card.style.left,t:card.style.top}));}});',
'  });',
'  setTimeout(sizeFrames,300);',
'<\/script></body></html>'
    ].join('\n');
  }

  /* ---------- 启动 ---------- */
  fitScale();
  var startHash = (location.hash.match(/#\/(\d+)/) || [])[1];
  index = startHash ? Math.min(total - 1, Math.max(0, parseInt(startHash, 10) - 1)) : 0;
  render();
})();
