# CardioLab · Monitor ECG

Prototipo educativo de aplicación web progresiva (PWA) para visualizar una señal ECG, explorar simulaciones educativas y registrar capturas etiquetadas para pruebas con ESP32 y ProSim.

## Estado actual

- La carpeta original no contenía código de aplicación, firmware ni señales ECG numéricas. Se encontraron recursos SVG/PNG y 27 videos educativos.
- El modo demo genera una señal sintética de ritmo sinusal para probar la interfaz. No representa una señal recibida del ProSim ni del ESP32.
- BLE se implementa mediante Web Bluetooth, disponible principalmente en navegadores basados en Chromium de Android y en contexto seguro (HTTPS). “Elegir dispositivo” autoriza el primer enlace; “Conexión rápida” intenta reconectar un dispositivo ya autorizado. Esta versión no incluye un contenedor nativo BLE para iOS/Android.
- `assets/data/pathologies_with_classifier.json` conserva el dataset completo adaptado de ECGenius: 27 ritmos, características, definición, signos y síntomas, criterios de referencia, manejo educativo, recomendaciones, preguntas y reglas de comparación. El dataset de referencia está en inglés. `assets/data/rhythm-guides.json` permanece como respaldo reducido. La app solo estima frecuencia en vivo; no extrae automáticamente ondas P, PR, ancho QRS, marcapasos ni conducción. Los puntajes de comparación no son probabilidades ni diagnósticos.
- **Aprender** organiza las 27 fichas en seis módulos, guarda avance local y ofrece una lección interactiva de cinco pasos: reconocer la tira simulada, conocer el patrón, emparejar hallazgos, revisar el contexto educativo y repasar puntos clave. Las lecciones se desbloquean en orden.
- **Práctica** permite buscar por nombre, abreviatura o definición, filtrar por módulo, reproducir la simulación y revisar seis pestañas: características ECG, signos y síntomas, diagnóstico de referencia, tratamiento de referencia, recomendaciones y puntos clave.
- **Predictor** es un comparador interpretable basado en las reglas del JSON. Recibe hallazgos ingresados por la persona y no analiza automáticamente la curva. No existe un modelo de IA entrenado o validado.
- **Reto** tiene tres salas de cinco casos, pacientes ilustrados, ritmo y contenido de manejo como preguntas separadas, puntuación, corazones, repaso dirigido de errores y un caso final cronometrado. Se guarda localmente. Las tiras son videos educativos, no señales del ESP32 ni pacientes reales.
- **Guía ECG** incluye una secuencia de lectura con ocho fundamentos: frecuencia, regularidad, onda P, PR, QRS, R–R, ST y QT, además de los pasos de conexión al ESP32/ProSim.

## Abrir y probar en computadora

Para abrir la interfaz y explorar el modo demo, puedes hacer doble clic en `index.html`; los datos educativos están incluidos también como un script local para que el navegador no dependa de `fetch` bajo `file://`.

Para usar el modo PWA y probar Bluetooth desde el mismo computador, sirve la carpeta por localhost:

```powershell
node server.mjs
```

Luego abre `http://localhost:8000`. El botón **Iniciar demo** dibuja una señal sintética. Desde **Aprender**, **Ritmos** y **Reto** puedes recorrer las fichas, videos y casos educativos.

En Windows también puedes abrir `Abrir CardioLab.bat`; iniciará el servidor y abrirá la página en el navegador. Deja abierta la ventana del servidor mientras usas la app.

## Instalar en celular

Publica esta carpeta en un hosting con HTTPS. En Android, abre el enlace en Chrome, abre el menú del navegador y selecciona **Instalar aplicación** o **Agregar a pantalla de inicio**. La app conserva su interfaz y el modo demo sin conexión después de cargar los recursos principales.

Para Bluetooth, usa Android + Chrome en HTTPS. El soporte de Web Bluetooth depende del sistema operativo y navegador; iOS no ofrece una ruta fiable de BLE para esta PWA. Esta limitación debe resolverse con un empaquetado nativo BLE antes de distribuir una app móvil multiplataforma.

## Publicar y actualizar con GitHub Pages

Sí conviene para este prototipo: Pages sirve los archivos estáticos por HTTPS y el workflow de GitHub Actions incluido vuelve a desplegar el sitio cuando se actualiza `main`. El sitio incluye aproximadamente 82 MB de recursos, sobre todo videos, por debajo del límite publicado de 1 GB para un sitio Pages. [Límites de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

1. Crea un repositorio en GitHub. Si usas GitHub Free, Pages requiere un repositorio público; no publiques datos personales, capturas reales de pacientes, credenciales ni archivos privados.
2. Desde esta carpeta, inicializa Git, agrega los archivos y publica la rama `main` en ese repositorio. El `.gitignore` excluye capturas CSV y carpetas locales de registros.
3. En GitHub, abre **Settings → Pages** y selecciona **GitHub Actions** como origen.
4. Al subir `main`, el workflow `.github/workflows/deploy.yml` publica automáticamente la app. GitHub Pages permite publicar mediante workflows personalizados y ofrece HTTPS para el sitio. [Workflows de Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) [HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
5. En **Settings → Pages** aparecerá una URL con formato `https://TU-USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/`. Ábrela en Chrome para Android y elige **Instalar aplicación** o **Agregar a pantalla de inicio**.

La app guarda sus preferencias e historial de resumen en el teléfono y descarga los CSV localmente; GitHub Pages solo aloja el sitio. No subas los CSV de señal a GitHub salvo que decidas compartirlos intencionalmente y cuentes con autorización para publicar esos datos. Después de cambios visuales o de lógica, incrementa la versión de caché en `sw.js`; el navegador renovará los recursos del PWA tras detectar el nuevo worker.

Para los comandos exactos de Git y los pasos de configuración, consulta [PUBLICAR_EN_GITHUB.md](PUBLICAR_EN_GITHUB.md).

## Conectar el ESP32

En **Ajustes**, configura lo que indique el firmware:

1. UUID del servicio BLE.
2. UUID de la característica que envía notificaciones.
3. UUID de escritura, solo si el firmware requiere comandos.
4. Nombre anunciado del ESP32, opcional.
5. Formato de cada muestra y frecuencia de muestreo.
6. Escala para convertir la lectura cruda a las unidades documentadas.

Formatos disponibles: `int16` firmado little-endian, `int16` firmado big-endian, `uint8` sin signo y números de texto separados por coma/espacio/salto de línea. No se asigna un UUID ni tasa de muestreo por defecto. Los campos de escala quedan vacíos: con escala 1 la curva conserva las unidades crudas del ADC.

### Información que debe entregar el firmware

- UUID del servicio, UUID de notificación y UUID opcional de escritura.
- Protocolo exacto de cada paquete BLE: tamaño, orden, signo y endianess de las muestras; separadores/encabezados si es texto.
- Frecuencia de muestreo real y si se envían marcas de tiempo o muestras perdidas.
- Conversión de cuentas ADC a voltaje/mV, resolución y rango del ADC, amplificación y polaridad.
- Confirmar que los paquetes no mezclan metadatos con valores de señal.

## Capturar una prueba ProSim

1. Conecta y comprueba la señal.
2. En **Monitor**, pulsa **Grabar captura**.
3. Detén la grabación.
4. En **Capturas**, etiqueta el ritmo que realmente configuraste en el ProSim y guarda.
5. La app exporta un CSV de muestras con metadatos (origen, etiqueta, fecha, frecuencia y nota); guarda localmente solo el resumen del registro.

Las capturas demo se marcan como simulación y no deben mezclarse con datos de hardware. No uses estas muestras para alegar validez clínica.

## Alcance y seguridad

- Solo se muestra frecuencia cardíaca estimada y calidad muy básica de recepción. El comparador preliminar usa rasgos manuales del ECG; no detecta automáticamente las arritmias y no hay modelo de IA entrenado.
- “Calidad recibida” indica actividad/amplitud de la serie, no verificación médica de electrodos.
- No se calculan ni inventan SpO₂ o presión arterial: el ECG de una derivación no los mide.
- El sistema es un prototipo educativo; no diagnostica, no descarta enfermedades ni reemplaza atención profesional.
- Antes de una prueba real, verifica el aislamiento y seguridad eléctrica del montaje. No conectes personas hasta validar el hardware y la seguridad con personal calificado.

## Recursos reutilizados

- Videos `assets/assets/videos/*.mp4` como biblioteca de simulaciones educativas.
- Personajes `doctor-01`, `doctor-02`, `doctor-03` y la mascota como guías visuales.
- Fichas y reglas seleccionadas de `assets/data/rhythm-guides.json`, derivadas del JSON compartido. El JSON local omite tratamiento y recomendaciones clínicas.
- Fondo `assets/assets/challenge-backgrounds/ward1.png` como póster del video.
- Paleta verde/turquesa de alto contraste y modo nocturno.
- Doctores y personajes de paciente reutilizados en lecciones y casos educativos.

