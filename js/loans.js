// js/loans.js
(function () {
  // tolerante: si no hay _auth/_db aún, no rompe la página
  const auth = window._auth || (firebase && firebase.auth ? firebase.auth() : null);
  const db   = window._db   || (firebase && firebase.firestore ? firebase.firestore() : null);

  const $ = (id) => document.getElementById(id);

  const el = {
    clientSearch: $("clientSearch"),
    clientList:   $("clientList"),
    verifyMsg:    $("verifyMsg"),
    loanForm:     $("loanForm"),
    tbody:        $("tbodySchedule"),
    totals:       $("totals"),
    kpiP:         $("kpiPrincipal"),
    kpiI:         $("kpiInteres"),
    kpiG:         $("kpiIGV"),
    kpiT:         $("kpiTotal"),
    exportBtn:    $("exportPdf"),
  };

  let allClients = [];
  let selectedClient = null;

  // helpers
  const toNumber = (v)=>{ const x=parseFloat(String(v).replace(',','.')); return isNaN(x)?0:x; };
  const round2   = (n)=>Math.round((n+Number.EPSILON)*100)/100;
  const fmt      = (n)=>Number(n).toLocaleString('es-PE',{style:'currency',currency:'PEN'});
  const fmtDate  = (d)=>new Date(d).toISOString().slice(0,10);

  function buildSchedule({ principal, annualRate, months, startDate, igvRate, taxRate }) {
    const r = annualRate/12, n=months, P=principal;
    const cuotaBase = r===0 ? P/n : P*r/(1-Math.pow(1+r,-n));
    let saldo=P, fecha=new Date(startDate||new Date()); const rows=[];
    for(let k=1;k<=n;k++){
      const interes = round2(saldo*r);
      const amort   = round2(cuotaBase - interes);
      const igv     = round2(interes*igvRate);
      const otros   = round2(interes*taxRate);
      const cuota   = round2(cuotaBase + igv + otros);
      saldo = round2(saldo - amort);
      const payDate=new Date(fecha); payDate.setMonth(payDate.getMonth()+1);
      rows.push({k, fecha:fmtDate(payDate), cuota_base:round2(cuotaBase), interes, igv, otros, amortizacion:amort, cuota_total:cuota, saldo});
      fecha=payDate;
    }
    const totals = rows.reduce((a,r)=>({ 
      cuota_base: round2(a.cuota_base+r.cuota_base),
      interes:    round2(a.interes+r.interes),
      amortizacion:round2(a.amortizacion+r.amortizacion),
      igv:        round2(a.igv+r.igv),
      otros:      round2(a.otros+r.otros),
      cuota_total:round2(a.cuota_total+r.cuota_total)
    }), {cuota_base:0,interes:0,amortizacion:0,igv:0,otros:0,cuota_total:0});
    return { rows, totals };
  }

  async function saveLoan(dni, payload, schedule){
    if(!db) throw new Error("Firestore no inicializado");
    const user = auth && auth.currentUser ? auth.currentUser : null;
    const meta = { createdBy: user ? user.uid : null,
                   createdAt: firebase.firestore.FieldValue.serverTimestamp() };
    const ref = await db.collection("clients").doc(dni).collection("loans").add({ ...payload, ...meta, schedule });
    return ref.id;
  }

  function renderClientList(filter){
    const q=(filter||"").toLowerCase();
    const list = allClients.filter(c=> (c.dni||"").includes(q) || (`${c.nombres||""} ${c.apellidos||""}`).toLowerCase().includes(q)).slice(0,12);
    el.clientList.innerHTML = list.length
      ? list.map(c=>`<div class="badge" data-dni="${c.dni}">${c.dni} — ${c.nombres} ${c.apellidos}</div>`).join("")
      : "<div class='small'>Sin resultados</div>";
    Array.from(el.clientList.querySelectorAll(".badge")).forEach(b=>{
      b.addEventListener("click",()=>{
        Array.from(el.clientList.querySelectorAll(".badge")).forEach(x=>x.classList.remove("selected"));
        b.classList.add("selected");
        const dni=b.getAttribute("data-dni");
        selectedClient = allClients.find(x=>x.dni===dni)||null;
        if(selectedClient){ el.verifyMsg.className="alert ok"; el.verifyMsg.textContent=`Cliente: ${selectedClient.nombres} ${selectedClient.apellidos} (DNI ${selectedClient.dni})`; }
      });
    });
  }

  function renderSchedule(s, principal){
    el.tbody.innerHTML = s.rows.map(r=>`
      <tr>
        <td>${r.k}</td><td>${r.fecha}</td><td>${fmt(r.cuota_base)}</td><td>${fmt(r.interes)}</td>
        <td>${fmt(r.igv)}</td><td>${fmt(r.otros)}</td><td>${fmt(r.amortizacion)}</td><td>${fmt(r.cuota_total)}</td><td>${fmt(r.saldo)}</td>
      </tr>`).join("");
    el.totals.innerHTML = `
      <div class="item"><div class="small">Principal</div><div>${fmt(principal)}</div></div>
      <div class="item"><div class="small">Intereses</div><div>${fmt(s.totals.interes)}</div></div>
      <div class="item"><div class="small">IGV</div><div>${fmt(s.totals.igv)}</div></div>
      <div class="item"><div class="small">Total a pagar</div><div>${fmt(s.totals.cuota_total)}</div></div>`;
    el.kpiP.textContent=fmt(principal);
    el.kpiI.textContent=fmt(s.totals.interes);
    el.kpiG.textContent=fmt(s.totals.igv);
    el.kpiT.textContent=fmt(s.totals.cuota_total);
  }

  async function exportPdf(){
    try{
      if(!window.jspdf||!window.jspdf.jsPDF){ alert("jsPDF no cargó. Refresca (Ctrl+F5)."); return; }
      const { jsPDF } = window.jspdf;
      const doc=new jsPDF({unit:"pt",format:"a4"});
      doc.setFontSize(14); doc.text("Cronograma de Pagos - Crédito Seguro",40,40);
      doc.setFontSize(10); let y=70;
      doc.text(["#","Fecha","Cuota Base","Interés","IGV","Otros","Amort.","Cuota Total","Saldo"].join(" | "),40,y); y+=14;
      const trs=Array.from(document.querySelectorAll("#tbodySchedule tr"));
      if(!trs.length){ alert("Primero genera el cronograma."); return; }
      for(const tr of trs){
        const cols=Array.from(tr.children).map(td=>td.textContent.trim());
        if(y>780){ doc.addPage(); y=40; }
        doc.text(cols.join(" | "),40,y); y+=14;
      }
      if(y>740){ doc.addPage(); y=40; }
      doc.setFontSize(12); doc.text("Totales",40,y+10); doc.setFontSize(10);
      doc.text(`Principal: ${el.kpiP.textContent}`,40,y+28);
      doc.text(`Intereses: ${el.kpiI.textContent}`,40,y+44);
      doc.text(`IGV: ${el.kpiG.textContent}`,40,y+60);
      doc.text(`Total: ${el.kpiT.textContent}`,40,y+76);
      doc.save("cronograma_pagos.pdf");
    }catch(e){ console.error("PDF ERROR",e); alert("Error al exportar PDF: "+(e.message||e)); }
  }

  async function boot(){
    // Carga clientes (si Firestore no inicializó, no revienta la página)
    if(db){
      db.collection("clients").limit(500).onSnapshot(snap=>{
        allClients = snap.docs.map(d=>d.data());
        renderClientList(el.clientSearch ? el.clientSearch.value : "");
      }, err => {
        console.error("Firestore listen error:", err);
        el.clientList.innerHTML = "<div class='small'>No se pudo cargar clientes.</div>";
      });
    } else {
      el.clientList.innerHTML = "<div class='small'>Firestore no inicializado.</div>";
    }

    el.clientSearch && el.clientSearch.addEventListener("input", e=>renderClientList(e.target.value));

    el.loanForm && el.loanForm.addEventListener("submit", async (e)=>{
      e.preventDefault();
      if(!selectedClient){ el.verifyMsg.className="alert err"; el.verifyMsg.textContent="Selecciona un cliente."; return; }
      const principal = toNumber($("monto").value);
      const annualRate= toNumber($("tasa").value)/100;
      const months    = parseInt($("plazo").value,10);
      const igvRate   = toNumber($("igv").value)/100;
      const taxRate   = toNumber($("otros").value)/100;
      const startDate = $("fecha").value || new Date().toISOString().slice(0,10);
      const schedule  = buildSchedule({ principal, annualRate, months, startDate, igvRate, taxRate });
      renderSchedule(schedule, principal);

      try{
        const payload = { dni:selectedClient.dni, nombres:selectedClient.nombres, apellidos:selectedClient.apellidos,
                          principal, annualRate, months, igvRate, taxRate, startDate };
        const id = await saveLoan(selectedClient.dni, payload, schedule);
        $("savedMsg").textContent = `Préstamo guardado (ID: ${id}).`;
      }catch(e){
        console.error("SAVE ERROR:", e);
        $("savedMsg").textContent = "No se pudo guardar en Firestore (revisa consola).";
      }
    });

    el.exportBtn && el.exportBtn.addEventListener("click", exportPdf);
  }

  // Arranque robusto
  document.addEventListener("DOMContentLoaded", ()=>{
    try{
      window.requireAuth ? window.requireAuth(true).then(()=>{ window._bindLogout && window._bindLogout(); boot(); })
                         : boot();
    }catch(e){
      console.error("BOOT ERROR:", e);
      // al menos dibuja UI
      boot();
    }
  });
})();
