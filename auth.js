(function(){
  const app = firebase.initializeApp(window.FIREBASE_CFG);
  const auth = firebase.auth();
  const db = firebase.firestore();

  // Expose globals for other scripts
  window._app = app;
  window._auth = auth;
  window._db = db;

  // Auth state guard (simple)
  window.requireAuth = function(redirectIfMissing=true){
    return new Promise(resolve=>{
      auth.onAuthStateChanged(u=>{
        if(!u && redirectIfMissing){
          window.location.href = "index.html";
        }
        resolve(u || null);
      });
    });
  }

  window.signOutSafe = async function(){
    try{ await auth.signOut(); }catch(e){ console.error(e); }
    window.location.href = "index.html";
  }

  // Mock verificación de identidad (RENIEC SIMULADO)
  // En producción, reemplazar por un endpoint propio que consulte RENIEC o proveedor KYC.
  const reniecMock = {
    "12345678": { dni:"12345678", nombres:"Ana", apellidos:"Ramírez Vega" },
    "87654321": { dni:"87654321", nombres:"Luis", apellidos:"García Soto" }
  };

  window.verifyClientIdentity = async function(dni){
    await new Promise(r=>setTimeout(r,300)); // simula latencia
    if(!/^\d{8}$/.test(dni)) return { ok:false, msg:"El DNI debe tener 8 dígitos." };
    const found = reniecMock[dni];
    if(found) return { ok:true, data:found };
    return { ok:false, msg:"DNI no encontrado en padrón simulado. (Configura tu verificador real)" };
  }

  // Helpers Firestore
  window.saveClientIfMissing = async function(profile){
    const ref = db.collection("clients").doc(profile.dni);
    const snap = await ref.get();
    if(!snap.exists){
      await ref.set({
        ...profile,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  // UI binding common
  window._bindLogout = function(){
    const btn = document.getElementById("logoutBtn");
    if(btn){ btn.addEventListener("click", signOutSafe); }
  }
})();
