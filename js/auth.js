// js/auth.js
// Requiere que ANTES en el HTML cargues:
//   <script src="js/firebase-config.js"></script>
//   <script src="js/api-config.js"></script>   // tu token de apiperu.dev
//   <script src="https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/11.0.0/firebase-auth-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore-compat.js"></script>

(function () {
  // Inicializa Firebase
  const app = firebase.initializeApp(window.FIREBASE_CFG);
  const auth = firebase.auth();
  const db = firebase.firestore();

  // Expone referencias globales (usadas por otras páginas)
  window._app = app;
  window._auth = auth;
  window._db = db;

  /**
   * Guard simple de sesión.
   * Si redirectIfMissing = true y no hay user -> envía a index.html
   */
  window.requireAuth = function (redirectIfMissing = true) {
    return new Promise((resolve) => {
      auth.onAuthStateChanged((u) => {
        if (!u && redirectIfMissing) {
          window.location.href = "index.html";
        }
        resolve(u || null);
      });
    });
  };

  /** Logout seguro y regreso al login */
  window.signOutSafe = async function () {
    try {
      await auth.signOut();
    } catch (e) {
      console.error(e);
    }
    window.location.href = "index.html";
  };

  /** Enlaza el botón de logout si existe */
  window._bindLogout = function () {
    const btn = document.getElementById("logoutBtn");
    if (btn) btn.addEventListener("click", signOutSafe);
  };

  /**
   * Verificación de identidad por DNI usando apiperu.dev
   * Devuelve:
   *   { ok:true, data:{dni, nombres, apellidos, fuente:"apiperu"} }
   * ó { ok:false, msg:"..." }
   */
  window.verifyClientIdentity = async function (dni) {
    if (!/^\d{8}$/.test(String(dni || "").trim())) {
      return { ok: false, msg: "El DNI debe tener 8 dígitos." };
    }

    const token = window?.APIPERU?.token;
    const baseUrl = window?.APIPERU?.baseUrl || "https://apiperu.dev/api";
    if (!token) {
      return {
        ok: false,
        msg:
          "Falta configurar el token de apiperu.dev (js/api-config.js).",
      };
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);

    try {
      const url = `${baseUrl}/dni/${dni}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: ctrl.signal,
      });
      clearTimeout(t);

      if (!resp.ok) {
        const msgTxt = await resp.text().catch(() => "");
        return {
          ok: false,
          msg: `API error ${resp.status}: ${msgTxt || resp.statusText}`,
        };
      }

      const json = await resp.json();
      const d = json.data || {};
      if (json.success === false || (!d.nombres && !d.apellido_paterno)) {
        return { ok: false, msg: json.message || "No se pudo validar el DNI." };
      }

      const nombres = (d.nombres || "").toString().trim();
      const apellidos = [d.apellido_paterno, d.apellido_materno]
        .filter(Boolean)
        .map((s) => String(s).trim())
        .join(" ");

      const perfil = {
        dni: String(dni),
        nombres,
        apellidos,
        fuente: "apiperu",
      };
      return { ok: true, data: perfil };
    } catch (err) {
      const isAbort = err?.name === "AbortError";
      return {
        ok: false,
        msg: isAbort ? "Tiempo de espera agotado consultando DNI." : err.message,
      };
    }
  };

  /** Crea el cliente si no existe (por DNI) */
  window.saveClientIfMissing = async function (profile) {
    if (!profile?.dni) return;
    const ref = db.collection("clients").doc(profile.dni);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        ...profile,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
  };
})();
