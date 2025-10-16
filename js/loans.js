(function(){
  const auth = window._auth;
  const db = window._db;

  // Utilidades
  function toNumber(v){ const x = parseFloat(String(v).replace(',','.')); return isNaN(x)?0:x; }
  function round2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }
  function fmt(n){ return Number(n).toLocaleString('es-PE', { style:'currency', currency:'PEN' }); }
  function fmtDate(d){ const dt = new Date(d); return dt.toISOString().slice(0,10); }

  // Amortización método francés (cuota fija sobre capital + intereses)
  // IGV y otros impuestos aplicados sobre la porción de intereses (configurable).
  function buildSchedule({ principal, annualRate, months, startDate, igvRate, taxRate }){
    const r = annualRate/12; // mensual (en decimal, ej: 0.24/12)
    const n = months;
    const P = principal;
    const cuotaBase = r===0 ? P/n : P * (r) / (1 - Math.pow(1+r, -n));

    const rows = [];
    let saldo = P;
    let fecha = new Date(startDate);
    for(let k=1;k<=n;k++){
      const interes = round2(saldo * r);
      const amort = round2(cuotaBase - interes);
      const igv = round2(interes * igvRate);
      const otros = round2(interes * taxRate);
      const cuotaTotal = round2(cuotaBase + igv + otros);
      saldo = round2(saldo - amort);
      // siguiente mes
      const payDate = new Date(fecha);
      payDate.setMonth(payDate.getMonth()+1);

      rows.push({
        k,
        fecha: fmtDate(payDate),
        cuota_base: round2(cuotaBase),
        interes,
        amortizacion: amort,
        igv,
        otros,
        cuota_total: cuotaTotal,
        saldo
      });
      fecha = payDate;
    }
    const totals = rows.reduce((acc,r)=>{
      acc.cuota_base += r.cuota_base;
      acc.interes += r.interes;
      acc.amortizacion += r.amortizacion;
      acc.igv += r.igv;
      acc.otros += r.otros;
      acc.cuota_total += r.cuota_total;
      return acc;
    }, { cuota_base:0, interes:0, amortizacion:0, igv:0, otros:0, cuota_total:0 });
    Object.keys(totals).forEach(k=> totals[k]=round2(totals[k]));
    return { rows, totals };
  }

  async function saveLoan(dni, payload, schedule){
    const user = auth.currentUser;
    const meta = {
      createdBy: user ? user.uid : null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    const docRef = await db.collection("clients").doc(dni).collection("loans").add({ ...payload, ...meta });
    // (opcional) guardar schedule aparte
    await docRef.collection("schedule").add(schedule); // una sola doc con arrays
    return docRef.id;
  }

  // UI
  async function init(){
    await window.requireAuth(true);
    window._bindLogout();

    // Elements
    const f = (id)=>document.getElementById(id);
    const loanForm = f("loanForm");
    const dniInput = f("dni");
    const verifyBtn = f("verifyBtn");
    const vmsg = f("verifyMsg");
    const resultWrap = f("resultWrap");
    const tableBody = f("tbodySchedule");
    const totalsEl = f("totals");
    const kpis = {
      principal: f("kpiPrincipal"),
      interes: f("kpiInteres"),
      igv: f("kpiIGV"),
      total: f("kpiTotal")
    };

    let verifiedProfile = null;

    verifyBtn.addEventListener("click", async ()=>{
      vmsg.textContent = "Verificando DNI...";
      const resp = await window.verifyClientIdentity(dniInput.value.trim());
      if(!resp.ok){
        vmsg.className = "alert err";
        vmsg.textContent = resp.msg;
        verifiedProfile = null;
      }else{
        vmsg.className = "alert ok";
        vmsg.textContent = `Identidad verificada: ${resp.data.nombres} ${resp.data.apellidos}`;
        verifiedProfile = resp.data;
        await window.saveClientIfMissing(verifiedProfile);
      }
    });

    loanForm.addEventListener("submit", async (e)=>{
      e.preventDefault();
      if(!verifiedProfile){
        vmsg.className = "alert err";
        vmsg.textContent = "Primero verifica la identidad del cliente.";
        return;
      }
      const principal = toNumber(f("monto").value);
      const annualRate = toNumber(f("tasa").value)/100;
      const months = parseInt(f("plazo").value,10);
      const igvRate = toNumber(f("igv").value)/100;
      const taxRate = toNumber(f("otros").value)/100;
      const startDate = f("fecha").value || new Date().toISOString().slice(0,10);

      const schedule = buildSchedule({ principal, annualRate, months, startDate, igvRate, taxRate });
      // Render
      tableBody.innerHTML = schedule.rows.map(r=>`
        <tr>
          <td>${r.k}</td>
          <td>${r.fecha}</td>
          <td>${fmt(r.cuota_base)}</td>
          <td>${fmt(r.interes)}</td>
          <td>${fmt(r.igv)}</td>
          <td>${fmt(r.otros)}</td>
          <td>${fmt(r.amortizacion)}</td>
          <td>${fmt(r.cuota_total)}</td>
          <td>${fmt(r.saldo)}</td>
        </tr>
      `).join("");
      totalsEl.innerHTML = `
        <div class="item"><div class="small">Principal</div><div class="h3">${fmt(principal)}</div></div>
        <div class="item"><div class="small">Intereses</div><div class="h3">${fmt(schedule.totals.interes)}</div></div>
        <div class="item"><div class="small">IGV</div><div class="h3">${fmt(schedule.totals.igv)}</div></div>
        <div class="item"><div class="small">Total a pagar</div><div class="h3">${fmt(schedule.totals.cuota_total)}</div></div>
      `;
      kpis.principal.textContent = fmt(principal);
      kpis.interes.textContent = fmt(schedule.totals.interes);
      kpis.igv.textContent = fmt(schedule.totals.igv);
      kpis.total.textContent = fmt(schedule.totals.cuota_total);
      resultWrap.classList.remove("hidden");

      // Persistir
      const payload = {
        dni: verifiedProfile.dni,
        nombres: verifiedProfile.nombres,
        apellidos: verifiedProfile.apellidos,
        principal, annualRate, months, igvRate, taxRate, startDate
      };
      const loanId = await saveLoan(verifiedProfile.dni, payload, schedule);
      f("savedMsg").textContent = `Préstamo guardado (ID: ${loanId}).`;
    });

    // Exportar PDF
    document.getElementById("exportPdf").addEventListener("click", async ()=>{
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit:"pt", format:"a4" });
      const title = "Cronograma de Pagos - Crédito Seguro";
      doc.text(title, 40, 40);
      let y = 60;
      doc.setFontSize(10);
      const hdr = ["#","Fecha","Cuota Base","Interés","IGV","Otros","Amort.","Cuota Total","Saldo"];
      doc.text(hdr.join(" | "), 40, y); y+=14;
      const rows = Array.from(tableBody.querySelectorAll("tr")).map(tr=>Array.from(tr.children).map(td=>td.textContent));
      for(const r of rows){
        if(y>780){ doc.addPage(); y=40; }
        doc.text(r.join(" | "), 40, y); y+=14;
      }
      doc.addPage();
      doc.text("Totales", 40, 40);
      doc.text(`Principal: ${kpis.principal.textContent}`, 40, 60);
      doc.text(`Intereses: ${kpis.interes.textContent}`, 40, 76);
      doc.text(`IGV: ${kpis.igv.textContent}`, 40, 92);
      doc.text(`Total: ${kpis.total.textContent}`, 40, 108);
      doc.save("cronograma_pagos.pdf");
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
const newDni = document.getElementById("newDni");
const addClientBtn = document.getElementById("addClientBtn");
const addClientMsg = document.getElementById("addClientMsg");
