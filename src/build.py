# Builds the offline (installable) version from ../app/planner_app.html
import re, pathlib
src = pathlib.Path(__file__).parent / "planner_app.html"
s = src.read_text()
head = '''<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#E05A5F">
<link rel="manifest" href="manifest.json">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<script src="config.js"></script>
<script>if(window.FIREBASE_CONFIG){ window.plannerBackendReady = new Promise(r => window.__resolveBackend = r); }</script>
<script type="module" src="sync.js"></script>
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}[hidden]{display:none!important}</style>
</head><body>
'''
extra = r'''
<script>
/* offline extras: service worker, persistent storage, backup export/import */
if("serviceWorker" in navigator){
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js", {updateViaCache: "none"}).then(r => r.update()).catch(()=>{});
  // a new version took over: reload once so the new screen shows right away
  navigator.serviceWorker.addEventListener("controllerchange", () => { if(hadController && !window.__reloaded){ window.__reloaded = true; location.reload(); } });
}
try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(e){}
(function(){
  const tabs = document.getElementById("tabs");
  function addButtons(){
    if(document.getElementById("bk-out")) return;
    const out = document.createElement("button"); out.id="bk-out"; out.className="tab today"; out.textContent="백업";
    out.title="기록을 파일로 저장";
    out.onclick = () => {
      const data = localStorage.getItem("plandoPlanner.v1") || "{}";
      const d = new Date(), name = `플래너백업_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}.json`;
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data],{type:"application/json"})); a.download = name;
      document.body.append(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},1000);
    };
    const inp = document.createElement("input"); inp.type="file"; inp.accept=".json,application/json"; inp.hidden=true; inp.id="bk-file";
    const imp = document.createElement("button"); imp.id="bk-in"; imp.className="tab today"; imp.textContent="복원"; imp.title="백업 파일 불러오기";
    imp.onclick = () => inp.click();
    inp.onchange = async () => {
      const f = inp.files[0]; if(!f) return;
      try{
        const incoming = JSON.parse(await f.text());
        if(typeof incoming!=="object" || Array.isArray(incoming)) throw 0;
        const cur = JSON.parse(localStorage.getItem("plandoPlanner.v1")||"{}");
        localStorage.setItem("plandoPlanner.v1", JSON.stringify(Object.assign(cur, incoming)));
        location.reload();
      }catch(e){ imp.textContent="파일 오류"; setTimeout(()=>imp.textContent="복원",2500); }
      inp.value="";
    };
    tabs.append(out, imp, inp);
  }
  new MutationObserver(addButtons).observe(tabs,{childList:true}); addButtons();
})();
</script>
</body></html>
'''
pathlib.Path(__file__).parent.parent.joinpath("index.html").write_text(head + s + extra)
print("ok", len(head+s+extra))
