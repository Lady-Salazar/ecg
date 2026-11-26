# Publicar CardioLab en GitHub Pages

GitHub Pages es una buena opción para alojar esta PWA: entrega la página por HTTPS y el workflow incluido la vuelve a desplegar al subir cambios a `main`. No convierte la web en un APK ni añade BLE nativo; solo permite instalarla desde el navegador compatible.

## 1. Crea el repositorio

En GitHub crea un repositorio vacío, por ejemplo `cardiolab-ecg`. En GitHub Free, el sitio Pages debe estar asociado a un repositorio público. Como el sitio contiene el código fuente y los recursos que uses, no incluyas datos privados ni capturas ECG reales con información identificable.

## 2. Publica el proyecto desde PowerShell

Abre PowerShell en la carpeta `app ecg` y reemplaza `TU-USUARIO` si hace falta:

```powershell
git init
git add .
git commit -m "Prepara CardioLab para GitHub Pages"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/cardiolab-ecg.git
git push -u origin main
```

GitHub puede pedir que inicies sesión o autorices Git Credential Manager. No pegues un token o contraseña dentro de un archivo del proyecto.

Si `git remote add origin` dice que `origin` ya existe, usa:

```powershell
git remote set-url origin https://github.com/TU-USUARIO/cardiolab-ecg.git
git push -u origin main
```

## 3. Activa Pages

En el repositorio, ve a **Settings → Pages** y selecciona **GitHub Actions** en **Build and deployment → Source**. El workflow `.github/workflows/deploy.yml` publicará el sitio. Espera a que termine el workflow en **Actions**; la URL aparecerá en Settings → Pages con formato:

```text
https://TU-USUARIO.github.io/cardiolab-ecg/
```

## 4. Instálalo en el teléfono

Abre la URL en Chrome para Android, luego elige **Instalar aplicación** o **Agregar a pantalla de inicio**. La primera vez que vincules el ESP32, usa **Elegir dispositivo**. Más adelante, **Conexión rápida** puede reconectarse a un equipo BLE que el navegador ya autorizó.

## Subir actualizaciones

Después de editar el proyecto:

```powershell
git add .
git commit -m "Describe el cambio"
git push
```

Cada push a `main` dispara un nuevo despliegue. Para actualizar los recursos que conserva el navegador, incrementa la cadena `CACHE` en `sw.js`.

## Qué se publica y qué no

- El workflow publica `index.html`, CSS, JavaScript, el manifiesto, el icono y `assets/`.
- Incluye `learning.css` y `learning-experience.js` para las áreas de aprendizaje, consulta y reto.
- No publica `server.mjs`, el lanzador `.bat`, `README.md` ni este instructivo en el sitio.
- `.gitignore` excluye CSV, carpetas de capturas y archivos `.env`; verifica `git status` antes de cada subida.
- Las fichas del JSON del proyecto quedan accesibles públicamente en el sitio. La app no envía a GitHub las capturas ni los datos guardados en el teléfono.
