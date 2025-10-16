# Crédito Seguro (GitHub Pages + Firebase)

App estática para autenticación (login/registro/reset), verificación simple por DNI y generación de cronograma de pagos (método francés) con IGV e impuestos configurables. Guarda clientes y préstamos en Firestore.

## Estructura
- `index.html` → Login
- `register.html` → Registro
- `reset.html` → Recuperación de contraseña
- `dashboard.html` → Dashboard para crear préstamos y generar cronograma
- `js/firebase-config.js` → **Rellena tus credenciales**
- `js/auth.js` → Lógica de auth + verificación de identidad simulada
- `js/loans.js` → Cálculo y guardado del cronograma
- `styles.css` → Estilos

## Cómo correr en GitHub Pages
1. Crea un proyecto Firebase y habilita **Authentication (Email/Password)** y **Firestore** (modo producción).
2. Copia las credenciales web en `js/firebase-config.js`.
3. Sube todo el contenido a tu repositorio en la rama `main`.
4. Activa GitHub Pages: *Settings → Pages → Branch: main (root)*.
5. Abre `https://TU_USUARIO.github.io/TU_REPO/index.html`

> **Nota:** La verificación RENIEC está simulada. Reemplaza `verifyClientIdentity` en `js/auth.js` por tu propio endpoint KYC/RENIEC.

## Fórmula de amortización (francés)
Cuota base mensual `A = P * r / (1 - (1+r)^(-n))`  
- `P`: principal (monto)  
- `r`: tasa mensual (`tasa_anual / 12`)  
- `n`: meses  
La app aplica **IGV** e **Impuesto adicional** sobre el **interés mensual** (puedes ajustar la lógica).

## Exportar PDF
Se usa `jsPDF` vía CDN. Botón **Exportar PDF** en el dashboard.

---
Hecho con ❤️ para tu MVP.
