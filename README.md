# LinkedIn Job Alerts

Pipeline automatizado de busqueda y evaluacion de ofertas de empleo que ejecuta busquedas en tableros agregados (LinkedIn, Indeed, Glassdoor, ZipRecruiter), las evalua con un modelo de IA, filtra las mejores y notifica por Telegram. Totalmente gratuito, ejecutado en Google Apps Script con un trigger diario.

---

## Descripcion del proyecto

LinkedIn Job Alerts resuelve un problema concreto en la busqueda laboral: el tiempo invertido scrolleando portales de empleo para encontrar ofertas alineadas con un perfil tecnico. El sistema ejecuta un pipeline que **busca** ofertas en multiples tableros via JSearch, las **evalua** contra un perfil profesional con Gemini, las **filtra** por relevancia y las **notifica** en tiempo real via Telegram. Todo funciona en la nube sin infraestructura propia y sin costo.

El pipeline opera cada dia intermedio (parity gate) para optimizar las cuotas gratuitas de las APIs involucradas. La configuracion es flexible: keywords, umbral de score, modelo de IA y exclusiones de seniority se ajustan desde un archivo de configuracion centralizado.

---



## Stack tecnologico


| Componente         | Herramienta                        | Rol                                                                   |
| ------------------ | ---------------------------------- | --------------------------------------------------------------------- |
| Runtime            | Google Apps Script                 | Ejecucion del pipeline (trigger diario, ~$0)                          |
| Busqueda de empleo | JSearch via RapidAPI               | Agrega LinkedIn, Indeed, Glassdoor, ZipRecruiter en JSON estructurado |
| Evaluacion IA      | Google Gemini (`gemini-3.6-flash`) | Score de relevancia 0-100 contra perfil profesional                   |
| Almacenamiento     | Notion API                         | Base de datos persistente de ofertas evaluadas                        |
| Notificaciones     | Telegram Bot API                   | Alertas en tiempo real por oferta y resumen diario                    |


**Costo total: $0** — Todos los componentes operan en tiers gratuitos.

---



## Arquitectura

El diagrama interactivo completo (con navegacion, temas oscuro/claro y exportacion a PNG/SVG) esta disponible en `[docs/diagrams/architecture.html](docs/diagrams/architecture.html)`.

### Diagrama del pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                     TRIGGER DIARIO (~8:00 AM)                       │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PASO 1: PARITY GATE                                               │
│  Calcula dia del anio % 2                                           │
│  ├─ Impar → EXIT inmediato (0 llamadas a API)                       │
│  └─ Par  → Continua                                                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PASO 2: FETCH JOBS (JSearch via RapidAPI)                         │
│  Itera 3 keywords:                                                  │
│  ├─ 'javascript developer junior'                                   │
│  ├─ 'react developer junior'                                        │
│  └─ 'node developer junior'                                         │
│  Estrategia: strict query primero → relaxed fallback si 0 resultados│
│  ~3 llamadas RapidAPI por ejecucion                                 │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PASO 3: NORMALIZE + DEDUP                                         │
│  ├─ Dedup dentro del batch (URLs normalizadas)                      │
│  └─ Dedup contra historial de Notion (URLs existentes)              │
│  Falla de Notion no fatal → procede con dedup del batch             │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PASO 3.5: PRE-FILTER                                              │
│  ├─ Excluir por seniority: senior, lead, manager, staff, principal, │
│  │  director, vp, head of, java (sin script)                        │
│  └─ Requerir >=1 tech keyword: javascript, typescript, react, node, │
│     express, firebase en titulo + descripcion                        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PASO 4: SCORE CON GEMINI (batch de 15)                            │
│  ├─ Lote: hasta 15 ofertas por llamada                              │
│  ├─ Fallback: score individual si falla el lote                     │
│  └─ Retry: hasta 3 intentos con backoff (2s, 4s, 6s)               │
│  Score: 0-100, entero, respuesta JSON forzada                      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PASO 5: FILTER (score >= 75)                                       │
│  ├─ Matches → Paso 6                                                │
│  └─ Sin matches → Resumen Telegram con todas las ofertas scoreadas  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PASO 6: STORE + NOTIFY                                            │
│  Para cada match:                                                   │
│  ├─ Crear pagina en Notion (con todas las propiedades)              │
│  └─ Enviar mensaje Telegram con titulo, empresa, link y score      │
└─────────────────────────────────────────────────────────────────────┘
```

---



## Flujo del pipeline

El pipeline se ejecuta como una funcion sincronica en Google Apps Script. Cada paso esta documentado en `src/pipeline.js` y delega interacciones externas a `src/services.js`.


| Paso                 | Descripcion                                                                                                                                  | Llamadas API                          | Comportamiento en error                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| 1. Parity gate       | Calcula `dayOfYear % 2`. Dias impares → exit inmediato con 0 llamadas API.                                                                   | 0                                     | N/A                                                      |
| 2. Fetch jobs        | Itera las 3 keywords configuradas. Para cada keyword: query strict primero; si 0 resultados, fallback a relaxed (mas permisivo).             | ~3 RapidAPI                           | Error por keyword es no-fatal; continua con las demas    |
| 3. Normalize + dedup | Normaliza URLs (elimina query string y trailing slash). Dedup dentro del batch Y contra historial de Notion.                                 | ~1 Notion (query)                     | Falta de Notion es no-fatal; procede con dedup del batch |
| 3.5. Pre-filter      | Excluye titulos con seniority prohibido. Requiere >=1 tech keyword en titulo+descripcion.                                                    | 0                                     | Config incompleta → no filtra                            |
| 4. Score             | Lotes de 15 ofertas. Gemini retorna JSON con `score` (0-100). Retry hasta 3 veces con backoff. Fallback a score individual si falla el lote. | 1 Gemini por lote                     | Score fallido → 0                                        |
| 5. Filter            | Filtra ofertas con `score >= 75`.                                                                                                            | 0                                     | N/A                                                      |
| 6. Store + notify    | Crea pagina en Notion + envia Telegram por cada match. Si 0 matches → envia resumen con todas las ofertas scoreadas.                         | 1 Notion write + 1 Telegram por match | Error por oferta es no-fatal                             |


---



## Configuracion

Todas las constantes estan definidas en `src/config.js`. Los valores mostrados son los defaults del sistema.

### Busqueda


| Constante              | Valor                                                                                | Descripcion                                              |
| ---------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `KEYWORDS`             | `['javascript developer junior', 'react developer junior', 'node developer junior']` | Términos de busqueda en JSearch                          |
| `LOCATION`             | `'Colombia'`                                                                         | Pais/filtro de ubicacion                                 |
| `REMOTE_ONLY`          | `true`                                                                               | Solo ofertas remotas                                     |
| `JSEARCH_STRICT_FIRST` | `true`                                                                               | Query estricto primero; fallback relaxed si 0 resultados |




### Pre-filtro (Paso 3.5)


| Constante             | Valor                                                                                   | Descripcion                                                                |
| --------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `SENIORITY_EXCLUDE`   | `/\b(senior|lead|manager|staff|principal|director|vp|head\s+of)\b|\bjava\b(?!script)/i` | Regex que excluye titulos con seniority prohibido y Java puro (sin script) |
| `TECH_STACK_KEYWORDS` | `['javascript', 'typescript', 'react', 'node', 'express', 'firebase']`                  | Requiere >=1 coincidencia en titulo + descripcion                          |




### Scoring


| Constante               | Valor                | Descripcion                                      |
| ----------------------- | -------------------- | ------------------------------------------------ |
| `SCORE_THRESHOLD`       | `75`                 | Umbral minimo de score para considerar match     |
| `GEMINI_MODEL`          | `'gemini-3.6-flash'` | Modelo de Gemini para scoring (free-tier flash)  |
| `GEMINI_MAX_RETRIES`    | `3`                  | Maximo de reintentos por llamada a Gemini        |
| `GEMINI_RETRY_DELAY_MS` | `2000`               | Delay base para backoff exponencial (2s, 4s, 6s) |
| `BATCH_SIZE`            | `15`                 | Ofertas por lote en scoring batch                |




### Pipeline


| Constante               | Valor          | Descripcion                                        |
| ----------------------- | -------------- | -------------------------------------------------- |
| `DESCRIPTION_MAX_CHARS` | `1999`         | Limite de caracteres para Notion rich_text (~2000) |
| `NOTION_API_VERSION`    | `'2022-06-28'` | Version de la API de Notion                        |


---



## Variables de entorno

Las credenciales se almacenan en **Apps Script Script Properties** (nunca en el codigo fuente). Se configuran desde: `Archivo → Propiedades del proyecto → Propiedades del script`.


| Propiedad            | Servicio         | Descripcion                                |
| -------------------- | ---------------- | ------------------------------------------ |
| `RAPIDAPI_KEY`       | RapidAPI         | Clave de acceso a JSearch                  |
| `GEMINI_API_KEY`     | Google AI Studio | Clave de Gemini para scoring               |
| `NOTION_TOKEN`       | Notion           | Token de integracion interna de Notion     |
| `NOTION_DB_ID`       | Notion           | ID de la base de datos "Trabajos"          |
| `TELEGRAM_BOT_TOKEN` | Telegram         | Token del bot (via @BotFather)             |
| `TELEGRAM_CHAT_ID`   | Telegram         | ID del chat donde se envian notificaciones |


> Para pruebas locales, se puede usar un archivo `.env` (excluido de `.gitignore`). En produccion, las propiedades se gestionan exclusivamente desde el servicio de Script Properties de Apps Script.

---



## Schema de Notion

La base de datos "Trabajos" en Notion debe tener las siguientes propiedades:


| Propiedad           | Tipo      | Descripcion                                              |
| ------------------- | --------- | -------------------------------------------------------- |
| `Nombre`            | title     | Titulo de la oferta                                      |
| `Empresa`           | rich_text | Nombre de la empresa                                     |
| `Link`              | url       | URL de aplicacion (fuente de dedup)                      |
| `Score`             | number    | Score 0-100 de Gemini                                    |
| `Fuente`            | select    | Publicador / tablero (LinkedIn, Indeed, Glassdoor...)    |
| `Descripción`       | rich_text | Descripcion truncada a ~1999 caracteres                  |
| `Estado`            | select    | Nueva / Aplicada / Descartada (se actualiza manualmente) |
| `Keyword`           | rich_text | Keyword que encontro la oferta                           |
| `Fecha publicación` | date      | Fecha de publicacion de la oferta (opcional)             |


> La integracion de Notion **debe** estar conectada a la base de datos via `...` → Connections. Sin esta conexion, todas las llamadas API retornan "access denied".

---



## Deploy paso a paso



### 1. Crear proyecto en Apps Script

1. Abrir [script.google.com](https://script.google.com)
2. Hacer clic en "Nuevo proyecto"
3. Renombrar el proyecto (ej: "LinkedIn Job Alerts")



### 2. Pegar los modulos

Copiar el contenido de los archivos del repositorio `src/` en el editor de Apps Script, respetando la estructura:


| Archivo del repositorio | Nombre en Apps Script               |
| ----------------------- | ----------------------------------- |
| `src/config.js`         | `config.gs` (o crear nuevo archivo) |
| `src/services.js`       | `services.gs`                       |
| `src/pipeline.js`       | `pipeline.gs`                       |
| `src/main.js`           | `main.gs`                           |


> En Apps Script, todos los archivos comparten el mismo scope global. No es necesario importar modulos.



### 3. Configurar Script Properties

1. En el editor de Apps Script: `Archivo → Propiedades del proyecto → Propiedades del script`
2. Agregar las 6 propiedades listadas en la seccion "Variables de entorno"
3. **Nunca** pegar credenciales directamente en el codigo fuente



### 4. Crear trigger diario

1. En el editor: `Triggers` (icono de reloj en el panel izquierdo)
2. Hacer clic en "+ Agregar trigger"
3. Configurar:
  - Funcion a ejecutar: `main`
  - Tipo de evento: "Basado en tiempo"
  - Tipo de trigger: "Al dia" (diario)
  - Hora del dia: ~8:00 AM
4. Guardar



### 5. Verificar parity gate

1. Forzar una ejecucion manual desde el editor (boton "Ejecutar")
2. En dias impares del año, el log debe mostrar: `Odd day — exiting early (zero API calls)`
3. En dias pares, el pipeline debe ejecutar el flujo completo



### 6. Verificar integraciones

1. Ejecutar `main()` en un dia par
2. Verificar en los logs de Apps Script que los 6 pasos se ejecutan secuencialmente
3. Confirmar que al menos una pagina se crea en Notion
4. Confirmar que se recibe un mensaje en Telegram

---



## Cuotas free tier


| Recurso                     | Limite gratuito     | Uso estimado                             | Headroom   |
| --------------------------- | ------------------- | ---------------------------------------- | ---------- |
| UrlFetchApp (Apps Script)   | 20,000 llamadas/dia | ~25 llamadas por ejecucion               | Masivo     |
| Apps Script trigger runtime | ~90 min/dia total   | ~2 min por ejecucion                     | Masivo     |
| JSearch via RapidAPI        | ~200 requests/mes   | ~45-60/mes (15 ejecuciones x 3 keywords) | ~3x        |
| Gemini (flash)              | Tier gratuito       | ~1 lote de 15 ofertas por ejecucion      | Suficiente |
| Notion API                  | Tier gratuito       | 1 query + N writes por ejecucion         | Suficiente |
| Telegram Bot API            | Sin limite conocido | 1-2 mensajes por ejecucion               | Suficiente |


> **Atencion:** La cuota de RapidAPI es el recurso mas limitado. Con 3 keywords y un trigger diario (ejecutando cada dia intermedio por parity gate), se usan ~45-60 requests/mes de un total de ~200. Monitorear el dashboard de RapidAPI mensualmente.

---



## Roadmap e historial

El archivo `[ROADMAP.md](ROADMAP.md)` documenta las fases de construccion, decisiones de arquitectura, contratos de datos y el historial completo del proyecto. Es la referencia para entender el contexto de diseno y las decisiones tomadas.

---



## Autor

Desarrollado por **Eric Reyes**.