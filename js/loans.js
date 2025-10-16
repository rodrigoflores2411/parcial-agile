// js/loans.js
// Requiere que el HTML cargue antes:
//  - firebase compat (app/auth/firestore)
//  - js/firebase-config.js
//  - js/auth.js   (expone window._auth y window._db)

(function () {
  const auth = window._auth;
  const db   = window._db;

  // ------- DOM -------
  const $ = (id) => document.getElementById(id);
  const clientSearch = $("clientSearch");
  const clientList   = $("clientList");
  const verifyMsg    = $("verifyMsg");

  const loanForm     = $("loanForm");
  const tbody        = $("tbodySchedule");
  const totalsBox    = $("totals");

  const kpiPrincipal = $("kpiPrincipal");
  const kpiInteres   = $("kpiInteres");
  const kpiIGV       = $("kpiIGV");
  const kpiTotal     = $("kpiTotal");

  const exportBtn    = $("exportPdf");

  // ------- Estado -------
  let allClients = [];
  let selectedClient = null;

  // ------- Helpers -------
  const toNumber = (v) => {
    const x = parseFloat(String(v).replace(",", "."));
    return isNaN(x) ? 0 : x;
  };
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const fmt = (n) => Number(n).toLocaleString("es-PE", { style: "currency", currency: "PEN" });
  const fmtDate = (d) => new Date(d).toISOString().slice(0, 10);

  // Cronograma: método francés; IGV/otros sobre interés mensual
  function buildSchedule({ principal, annualRate, months, startDate, igvRate, taxRate }) {
    const r = annualRate / 12;
    const n = months;
    const P = principal;
    const cuotaBase = r === 0 ? P / n : P * r / (1 - Math.pow(1 + r, -n));

    let saldo = P;
    let fecha = new Date(startDate || new Date());
    const rows = [];

    for (let k = 1; k <= n; k++) {
      const interes = round2(saldo * r);
      const amort   = round2(cuotaBase - interes);
      const igv     = round2(interes * igvRate);
      const otros   = round2(interes * taxRate);
      const cuota   = round2(cuotaBase + igv + otros);
      saldo = round2(saldo - amort);

      const payDate = new Date(fecha);
      payDate.setMonth(payDate.getMonth() + 1);

      rows.push({
        k, fecha: fmtDate(payDate),
        cuota_base: round2(cuotaBase),
        interes, igv, otros,
        amortizacion: amort,
        cuota_total: cuota,
        saldo
      });

      fecha = payDate;
    }

    const totals = rows.reduce((a, r) => {
      a.cuota_base  += r.cuota_base;
      a.interes     += r.interes;
      a.amortizacion+= r.amortizacion;
      a.igv         += r.igv;
      a.otros       += r.otros;
      a.cuota_total += r.cuota_total;
      return a;
    }, { cuota_base:0, interes:0, amortizacion:0, igv:0, otros:0, cuota_total:0 });

    Object.keys(totals).forEach(k => totals[k] = round2(totals[k]));
    return { rows, totals };
  }

  async function saveLoan(dni, payload, schedule) {
    const user = auth.currentUser;
    const meta = {
      createdBy: user ? user.uid : null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    // Guardamos todo en un solo doc (incluye schedule)
    const ref = await db.collection("clients").doc(dni).collection("loans").add({
      ...payload, ...meta, schedule
    });
    return ref.id;
  }

  function renderClientList(filter) {
    const q = (filter || "").toLowerCase();
    const list = allClients
      .filter(c =>
        (c.dni || "").includes(q) ||
        (`${c.nombres || ""} ${c.apellidos || ""}`).toLowerCase().includes(q)
      )
      .slice(0, 12);

    clientList.innerHTML = list.length
      ? list.map(c => `<div class="badge" data-dni="${c.dni}">${c.dni} — ${c.nombres} ${c.apellidos}</div>`).join("")
      : "<div class='small'>Sin resultados</div>";

    Array.from(clientList.querySelectorAll(".badge")).forEach(el => {
      el.addEventListener("click", () => {
        Array.from(clientList.querySelectorAll(".badge")).forEach(b => b.classList.remove("selected"));
        el.classList.add("selected");
        const dni = el.getAttribute("data-dni");
        selectedClient = allClients.find(x => x.dni === dni) || null;
        if (selectedClient) {
          verifyMsg.className = "alert ok";
          verifyMsg.textContent = `Cliente seleccionado: ${selectedClient.nombres} ${selectedClient.apellidos} (DNI ${selectedClient.dni})`;
        }
      });
    });
  }

  function renderSchedule(schedule, principal) {
    tbody.innerHTML = schedule.rows.map(r => `
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

    totalsBox.innerHTML = `
      <div class="item"><div class="small">Principal</div><div class="h3">${fmt(principal)}</div></div>
      <div class="item"><div class="small">Intereses</div><div class="h3">${fmt(schedule.totals.interes)}</div></div>
      <div class="item"><div class="small">IGV</div><div class="h3">${fmt(schedule.totals.igv)}</div></div>
      <div class="item"><div class="small">Total a pagar</div><div class="h3">${fmt(schedule.totals.cuota_total)}</div></div>
    `;

    kpiPrincipal.textContent = fmt(principal);
    kpiInteres.textContent   = fmt(schedule.totals.interes);
    kpiIGV.textContent       = fmt(schedule.totals.igv);
    kpiTotal.textContent     = fmt(schedule.totals.cuota_total);

    $("resultWrap").classList.remove("hidden");
  }

  // Exportar PDF robusto
  async function exportPdf() {
    try {
      if (!window.jspdf || !window.jspdf.jsPDF) {
        alert("No se pudo cargar jsPDF. Refresca con Ctrl+F5 y prueba de nuevo.");
        return;
      }
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "pt", format: "a4" });

      doc.setFontSize(14);
      doc.text("Cronograma de Pagos - Crédito Seguro", 40, 40);

      doc.setFontSize(10);
      const headers = ["#", "Fecha", "Cuota Base", "Interés", "IGV", "Otros", "Amort.", "Cuota Total", "Saldo"];
      let y = 70;
      doc.text(headers.join(" | "), 40, y);
      y += 14;

      const trs = Array.from(document.querySelectorAll("#tbodySchedule tr"));
      if (!trs.length) { alert("Primero genera el cronograma."); return; }

      for (const tr of trs) {
        const cols = Array.from(tr.children).map(td => (td.textContent || "").trim());
        if (y > 780) { doc.addPage(); y = 40; }
        doc.text(cols.join(" | "), 40, y);
        y += 14;
      }

      if (y > 740) { doc.addPage(); y = 40; }
      doc.setFontSize(12);
      doc.text("Totales", 40, y + 10);
      doc.setFontSize(10);
      doc.text(`Principal: ${kpiPrincipal.textContent}`, 40, y + 28);
      doc.text(`Intereses: ${kpiInteres.textContent}`,   40, y + 44);
      doc.text(`IGV: ${kpiIGV.textContent}`,             40, y + 60);
      doc.text(`Total: ${kpiTotal.textContent}`,         40, y + 76);

      doc.save("cronograma_pagos.pdf");
    } catch (err) {
      console.error("PDF ERROR:", err);
      alert("No se pudo exportar el PDF: " + (err.message || err));
    }
  }

  async function init() {
    await window.requireAuth(true);
    window._bindLogout();

    // Cargar clientes
    db.collection("clients").limit(500).onSnapshot((snap) => {
      allClients = snap.docs.map(d => d.data());
      renderClientList(clientSearch ? clientSearch.value : "");
    });

    if (clientSearch) {
      clientSearch.addEventListener("input", (e) => renderClientList(e.target.value));
    }

    if (loanForm) {
      loanForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!selectedClient) {
          verifyMsg.className = "alert err";
          verifyMsg.textContent = "Primero selecciona un cliente.";
          return;
        }

        const principal = toNumber($("monto").value);
        const annualRate = toNumber($("tasa").value) / 100;
        const months    = parseInt($("plazo").value, 10);
        const igvRate   = toNumber($("igv").value) / 100;
        const taxRate   = toNumber($("otros").value) / 100;
        const startDate = $("fecha").value || new Date().toISOString().slice(0, 10);

        const schedule = buildSchedule({ principal, annualRate, months, startDate, igvRate, taxRate });

        renderSchedule(schedule, principal);

        const payload = {
          dni: selectedClient.dni,
          nombres: selectedClient.nombres,
          apellidos: selectedClient.apellidos,
          principal, annualRate, months, igvRate, taxRate, startDate
        };
        const loanId = await saveLoan(selectedClient.dni, payload, schedule);
        $("savedMsg").textContent = `Préstamo guardado (ID: ${loanId}).`;
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener("click", exportPdf);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
