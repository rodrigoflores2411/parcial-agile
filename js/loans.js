Marvini — aquí tienes **`js/loans.js` completo** ya con: alta rápida de cliente por **apiperu.dev**, buscador/selector de cliente (sin pedir DNI en el préstamo), generación de cronograma, guardado en Firestore y exportar PDF.

```js
// js/loans.js
// Requiere que el HTML cargue ANTES:
//   - Firebase compat SDKs
//   - js/firebase-config.js
//   - js/api-config.js   (para APIPERU)
//   - js/auth.js         (expone window._auth, window._db, verifyClientIdentity, saveClientIfMissing)

(function () {
  const auth = window._auth;
  const db = window._db;

  // Helpers DOM
  const f = (id) => document.getElementById(id);

  // Refs UI
  const newDni       = f("newDni");
  const addClientBtn = f("addClientBtn");
  const addClientMsg = f("addClientMsg");

  const clientSearch = f("clientSearch");
  const clientList   = f("clientList");
  const vmsg         = f("verifyMsg");

  const loanForm     = f("loanForm");
  const tableBody    = f("tbodySchedule");
  const totalsEl     = f("totals");

  const kpis = {
    principal: f("kpiPrincipal"),
    interes:   f("kpiInteres"),
    igv:       f("kpiIGV"),
    total:     f("kpiTotal"),
  };

  let selectedClient = null;
  let allClients = [];

  // Utilidades numéricas / formato
  function toNumber(v)  { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? 0 : x; }
  function round2(n)    { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function fmt(n)       { return Number(n).toLocaleString('es-PE', { style: 'currency', currency: 'PEN' }); }
  function fmtDate(d)   { const dt = new Date(d); return dt.toISOString().slice(0, 10); }

  // Cronograma método francés (cuota fija). IGV e impuestos sobre el interés mensual.
  function buildSchedule({ principal, annualRate, months, startDate, igvRate, taxRate }) {
    const r = annualRate / 12;  // tasa mensual en decimal (ej: 0.24/12)
    const n = months;
    const P = principal;
    const cuotaBase = r === 0 ? P / n : P * r / (1 - Math.pow(1 + r, -n));

    const rows = [];
    let saldo = P;
    let fecha = new Date(startDate || new Date());

    for (let k = 1; k <= n; k++) {
      const interes = round2(saldo * r);
      const amort   = round2(cuotaBase - interes);
      const igv     = round2(interes * igvRate);
      const otros   = round2(interes * taxRate);
      const cuotaTotal = round2(cuotaBase + igv + otros);

      saldo = round2(saldo - amort);

      const payDate = new Date(fecha);
      payDate.setMonth(payDate.getMonth() + 1);

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

    const totals = rows.reduce((acc, r) => {
      acc.cuota_base  += r.cuota_base;
      acc.interes     += r.interes;
      acc.amortizacion+= r.amortizacion;
      acc.igv         += r.igv;
      acc.otros       += r.otros;
      acc.cuota_total += r.cuota_total;
      return acc;
    }, { cuota_base: 0, interes: 0, amortizacion: 0, igv: 0, otros: 0, cuota_total: 0 });

    Object.keys(totals).forEach(k => totals[k] = round2(totals[k]));
    return { rows, totals };
  }

  // Persistencia del préstamo y cronograma
  async function saveLoan(dni, payload, schedule) {
    const user = auth.currentUser;
    const meta = {
      createdBy: user ? user.uid : null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    const docRef = await db.collection("clients").doc(dni).collection("loans").add({ ...payload, ...meta });
    await docRef.collection("schedule").add(schedule); // guarda el cronograma completo en una subcolección
    return docRef.id;
  }

  // Render de lista de clientes filtrada
  function renderClientList(filter) {
    const q = (filter || "").toLowerCase();
    const matches = allClients
      .filter(c =>
        (c.dni || "").includes(q) ||
        (`${c.nombres || ""} ${c.apellidos || ""}`).toLowerCase().includes(q)
      )
      .slice(0, 12);

    clientList.innerHTML = matches.length
      ? matches.map(c => `<div class="badge" data-dni="${c.dni}">${c.dni} — ${c.nombres} ${c.apellidos}</div>`).join("")
      : "<div class='small'>Sin resultados</div>";

    Array.from(clientList.querySelectorAll(".badge")).forEach(el => {
      el.addEventListener("click", () => {
        Array.from(clientList.querySelectorAll(".badge")).forEach(b => b.classList.remove("selected"));
        el.classList.add("selected");
        const dni = el.getAttribute("data-dni");
        selectedClient = allClients.find(x => x.dni === dni) || null;

        if (selectedClient) {
          vmsg.className = "alert ok";
          vmsg.textContent = `Cliente seleccionado: ${selectedClient.nombres} ${selectedClient.apellidos} (DNI ${selectedClient.dni})`;
        }
      });
    });
  }

  // Exportar PDF del cronograma
  async function exportPdf() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const title = "Cronograma de Pagos - Crédito Seguro";
    doc.text(title, 40, 40);
    let y = 60;
    doc.setFontSize(10);

    const hdr = ["#", "Fecha", "Cuota Base", "Interés", "IGV", "Otros", "Amort.", "Cuota Total", "Saldo"];
    doc.text(hdr.join(" | "), 40, y); y += 14;

    const rows = Array.from(tableBody.querySelectorAll("tr"))
      .map(tr => Array.from(tr.children).map(td => td.textContent));

    for (const r of rows) {
      if (y > 780) { doc.addPage(); y = 40; }
      doc.text(r.join(" | "), 40, y); y += 14;
    }

    doc.addPage();
    doc.text("Totales", 40, 40);
    doc.text(`Principal: ${kpis.principal.textContent}`, 40, 60);
    doc.text(`Intereses: ${kpis.interes.textContent}`,   40, 76);
    doc.text(`IGV: ${kpis.igv.textContent}`,             40, 92);
    doc.text(`Total: ${kpis.total.textContent}`,         40, 108);
    doc.save("cronograma_pagos.pdf");
  }

  async function init() {
    // Requiere sesión
    await window.requireAuth(true);
    window._bindLogout();

    // (1) Alta rápida de cliente por DNI usando apiperu.dev
    if (addClientBtn) {
      addClientBtn.addEventListener("click", async () => {
        addClientMsg.className = "alert";
        addClientMsg.textContent = "Consultando DNI...";
        const dni = (newDni.value || "").trim();
        const r = await window.verifyClientIdentity(dni);
        if (!r.ok) {
          addClientMsg.className = "alert err";
          addClientMsg.textContent = r.msg;
          return;
        }
        try {
          await window.saveClientIfMissing(r.data);
          addClientMsg.className = "alert ok";
          addClientMsg.textContent = `Cliente creado/actualizado: ${r.data.nombres} ${r.data.apellidos} (DNI ${r.data.dni}).`;
        } catch (e) {
          addClientMsg.className = "alert err";
          addClientMsg.textContent = e.message || "No se pudo guardar el cliente.";
        }
      });
    }

    // (2) Carga de clientes y buscador
    db.collection("clients").limit(500).onSnapshot((snap) => {
      allClients = snap.docs.map(d => d.data());
      renderClientList(clientSearch ? clientSearch.value : "");
    });

    if (clientSearch) {
      clientSearch.addEventListener("input", (e) => renderClientList(e.target.value));
    }

    // (3) Generación de cronograma y guardado
    if (loanForm) {
      loanForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!selectedClient) {
          vmsg.className = "alert err";
          vmsg.textContent = "Primero selecciona un cliente.";
          return;
        }

        const principal = toNumber(f("monto").value);
        const annualRate = toNumber(f("tasa").value) / 100;
        const months    = parseInt(f("plazo").value, 10);
        const igvRate   = toNumber(f("igv").value) / 100;
        const taxRate   = toNumber(f("otros").value) / 100;
        const startDate = f("fecha").value || new Date().toISOString().slice(0, 10);

        const schedule = buildSchedule({ principal, annualRate, months, startDate, igvRate, taxRate });

        // Render tabla
        tableBody.innerHTML = schedule.rows.map(r => `
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

        // Render totales y KPIs
        totalsEl.innerHTML = `
          <div class="item"><div class="small">Principal</div><div class="h3">${fmt(principal)}</div></div>
          <div class="item"><div class="small">Intereses</div><div class="h3">${fmt(schedule.totals.interes)}</div></div>
          <div class="item"><div class="small">IGV</div><div class="h3">${fmt(schedule.totals.igv)}</div></div>
          <div class="item"><div class="small">Total a pagar</div><div class="h3">${fmt(schedule.totals.cuota_total)}</div></div>
        `;
        kpis.principal.textContent = fmt(principal);
        kpis.interes.textContent   = fmt(schedule.totals.interes);
        kpis.igv.textContent       = fmt(schedule.totals.igv);
        kpis.total.textContent     = fmt(schedule.totals.cuota_total);

        f("resultWrap").classList.remove("hidden");

        // Persistencia
        const payload = {
          dni: selectedClient.dni,
          nombres: selectedClient.nombres,
          apellidos: selectedClient.apellidos,
          principal, annualRate, months, igvRate, taxRate, startDate
        };
        const loanId = await saveLoan(selectedClient.dni, payload, schedule);
        f("savedMsg").textContent = `Préstamo guardado (ID: ${loanId}).`;
      });
    }

    // (4) Export PDF
// === Exportar PDF robusto ===
async function exportPdf() {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert("No se pudo cargar jsPDF. Refresca con Ctrl+F5 y prueba de nuevo.");
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    // Título
    doc.setFontSize(14);
    doc.text("Cronograma de Pagos - Crédito Seguro", 40, 40);

    // Encabezados
    doc.setFontSize(10);
    const headers = ["#", "Fecha", "Cuota Base", "Interés", "IGV", "Otros", "Amort.", "Cuota Total", "Saldo"];
    let y = 70;
    doc.text(headers.join(" | "), 40, y);
    y += 14;

    // Filas (lee la tabla que ya renderizaste)
    const trs = Array.from(document.querySelectorAll("#tbodySchedule tr"));
    if (!trs.length) {
      alert("Primero genera el cronograma.");
      return;
    }

    for (const tr of trs) {
      const cols = Array.from(tr.children).map(td => (td.textContent || "").trim());
      if (y > 780) { doc.addPage(); y = 40; }
      doc.text(cols.join(" | "), 40, y);
      y += 14;
    }

    // Totales
    if (y > 740) { doc.addPage(); y = 40; }
    doc.setFontSize(12);
    doc.text("Totales", 40, y + 10);
    doc.setFontSize(10);
    doc.text(`Principal: ${document.getElementById("kpiPrincipal").textContent}`, 40, y + 28);
    doc.text(`Intereses: ${document.getElementById("kpiInteres").textContent}`, 40, y + 44);
    doc.text(`IGV: ${document.getElementById("kpiIGV").textContent}`, 40, y + 60);
    doc.text(`Total: ${document.getElementById("kpiTotal").textContent}`, 40, y + 76);

    doc.save("cronograma_pagos.pdf");
  } catch (err) {
    console.error("PDF ERROR:", err);
    alert("No se pudo exportar el PDF: " + (err.message || err));
  }
}

// Vuelve a enganchar el botón (por si el DOM carga diferente)
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("exportPdf");
  if (btn) btn.addEventListener("click", exportPdf);
});

```
