# LinkedIn Job Alerts — búsqueda de trabajo automatizada con n8n + IA

Un workflow de [n8n](https://n8n.io) que scrapea LinkedIn todos los días, scorea cada oferta contra mi CV usando un LLM, genera un CV adaptado por oferta y me avisa por Telegram cuando encuentra un match fuerte — guardando todo organizado en Notion.

## Por qué existe esto

En febrero de 2026 me quedé sin trabajo. En vez de pasar el día entero scrolleando LinkedIn a mano, decidí aprovechar el tiempo para meterme de lleno en algo que venía posponiendo: construir automatizaciones reales con n8n, no solo tutoriales.

Este repo es el resultado — con toda la complejidad real que tuvo, no la versión idealizada. Tuve que resolver rate limiting de LinkedIn, sincronización de loops que perdían datos entre pasos, respuestas 503 de la API de Gemini a mitad de una corrida, y varios bugs sutiles de cómo n8n maneja índices dentro de loops. Todo eso está reflejado en el diseño final.

## Qué hace

1. **Busca** ofertas en LinkedIn todos los días a las 8am, con varios keywords en paralelo (con rate limiting para no gatillar el bloqueo anti-scraping de LinkedIn)
2. **Deduplica** ofertas que aparecen en más de una búsqueda, y contra las que ya existen en la base de Notion
3. **Trae el detalle completo** de cada oferta nueva (la descripción completa del puesto)
4. **Scorea** cada oferta contra mi perfil usando un LLM (Gemini), que devuelve un score 0-100, una justificación y un CV adaptado a esa oferta específica
5. **Guarda** todo en una base de Notion (título, empresa, score, justificación, CV adaptado, URL)
6. **Avisa por Telegram** cuando el score supera un umbral configurable

## Arquitectura

```
Schedule Trigger (8am)
    │
    ├──→ job titles (lista de keywords)
    │        │
    │        ▼
    │    Loop Over Items ──┐
    │        │              │
    │        ▼              │
    │    HTTP Request        │  (con Wait entre cada
    │    (LinkedIn guest API)│   búsqueda, rate limiting)
    │        │              │
    │        ▼              │
    │    HTML (extraer      │
    │    listado)           │
    │        │              │
    │        └──────────────┘
    │        ▼
    │    Code (aplanar resultados)
    │        │
    │        ▼
    │    Code1 (dedup dentro del batch)
    │        │
    │        ├──→ Get many database pages (Notion) → ExistingIds
    │        │
    │        ▼
    │    Merge (sincroniza ambas ramas)
    │        │
    │        ▼
    │    Code2 (marca existe: true/false)
    │        │
    │        ▼
    │    If (existe == false)
    │        │
    │        ▼
    │    Loop Detalle Ofertas ──┐
    │        │                   │
    │        ▼                   │
    │    Guardar original         │
    │        │                   │
    │        ▼                   │
    │    HTTP Request (detalle)   │  (con Wait, rate limiting)
    │        │                   │
    │        ▼                   │
    │    HTML (extraer descripción)│
    │        │                   │
    │        ▼                   │
    │    Code (combinar con original)
    │        │                   │
    │        └───────────────────┘
    │        ▼
    ├──→ Merge1 (junta con "Mi Perfil")
    │        │
    │        ▼
    │    Loop Gemini ──┐
    │        │          │
    │        ▼          │
    │    Guardar antes   │
    │    de Gemini        │
    │        │          │
    │        ▼          │
    │    GEMINI (scoring) │  (con retry en caso de error 503)
    │        │          │
    │        ▼          │
    │    parser           │
    │        │          │
    │        └──────────┘
    │        ▼
    │    If1 (score >= umbral)
    │        │
    │        ▼
    │    Create a database page (Notion)
    │        │
    │        ▼
    │    Send a text message (Telegram)
    │
    └──→ Mi Perfil (CV en texto, para el prompt de Gemini)
```

## Lecciones aprendidas (la parte interesante)

- **Rate limiting real**: el endpoint no oficial de búsqueda de LinkedIn banea la IP si le pegás muchas veces seguidas. Solución: un `Loop Over Items` con batch size 1 + un nodo `Wait` entre cada iteración, tanto para las búsquedas como para el detalle de cada oferta y las llamadas a Gemini.

- **`$itemIndex` no significa lo que uno espera dentro de un loop de a 1 item**: cuando un `Split In Batches` tiene batch size 1, `$itemIndex` dentro de esa iteración siempre vale 0 — no representa la posición global dentro del batch total. Usar `.all()[$itemIndex]` para recuperar datos de otro nodo casi siempre trae el ítem equivocado. La solución que terminé usando: un nodo "Guardar original" justo antes de cualquier paso que sobrescriba el `json` (como un HTTP Request), y después recuperarlo con `.first()` en vez de por índice — porque con batch size 1, solo hay un ítem viajando por esa rama en cada vuelta.

- **Los nodos HTTP Request reemplazan todo el `json` de entrada con la respuesta**: si necesitás conservar datos que traías antes de la llamada, hay que guardarlos explícitamente en un campo separado (`_original`) antes de que el HTTP Request los pise.

- **Merge en modo "Choose Branch" como semáforo**: cuando dos ramas necesitan terminar antes de que el flujo continúe (por ejemplo, traer los IDs existentes de Notion antes de comparar), un nodo `Merge` en modo `chooseBranch` obliga a n8n a esperar ambas ramas, aunque solo te quedes con los datos de una.

- **Reintentos ante errores transitorios de LLM APIs**: la API de Gemini devuelve ocasionalmente `503 - model overloaded`. En vez de perder esa oferta silenciosamente, la rama de error del nodo vuelve a meter el ítem en el loop (con un contador de intentos para no reintentar infinito).

## Setup

### Requisitos

- Una instancia de [n8n](https://n8n.io) (self-hosted o cloud)
- Una cuenta de [Notion](https://notion.so) con una integración creada y una database compartida con ella
- Una API key de [Google AI Studio](https://aistudio.google.com/apikey) (tier gratuito de Gemini)
- Un bot de [Telegram](https://core.telegram.org/bots#how-do-i-create-a-bot) (vía @BotFather) y tu Chat ID

### Pasos

1. Importá `linkedin-job-alerts.json` en tu instancia de n8n
2. Creá una database en Notion con estas columnas: `Titulo` (Title), `Empresa` (Text), `URL` (URL), `id_externo` (Text), `Score` (Number), `Justificación` (Text), `CV Adaptado` (Text), `Fecha detección` (Date)
3. Compartí la database con tu integración de Notion (`•••` → Connections)
4. En el nodo **`Get many database pages`** y **`Create a database page`**: seleccioná tu database y tu credential de Notion
5. En el nodo **`GEMINI`**: reemplazá `YOUR_GEMINI_API_KEY` en la URL por tu API key real
6. En el nodo **`Mi Perfil`**: pegá tu propio CV/perfil en texto plano
7. En el nodo **`Send a text message`**: reemplazá `YOUR_TELEGRAM_CHAT_ID` y configurá tu credential de Telegram
8. En el nodo **`job titles`**: ajustá los keywords de búsqueda a tu perfil
9. En el nodo **`HTTP Request`** (búsqueda de LinkedIn): ajustá `YOUR_LOCATION` a tu ubicación
10. Ajustá el umbral de score en el nodo **`If1`** (por defecto: 85)
11. Activá el workflow

### Variables de entorno (recomendado, en vez de hardcodear la key)

Si tu instancia de n8n soporta variables de entorno, es más seguro usar `{{ $env.GEMINI_API_KEY }}` en vez de pegar la key directamente en el nodo.

## Stack

- **n8n** — orquestación del flujo
- **LinkedIn guest API** (no oficial) — scraping de ofertas
- **Google Gemini** (`gemini-3.5-flash-lite`) — scoring y generación de CV adaptado
- **Notion API** — almacenamiento
- **Telegram Bot API** — alertas

## Disclaimer

Este flujo usa el endpoint no oficial de búsqueda de LinkedIn (`jobs-guest/jobs/api`), que no es una API pública soportada. Puede cambiar o dejar de funcionar sin aviso, y un uso agresivo puede resultar en bloqueos temporales de IP. Usalo con criterio y respetando los términos de servicio de LinkedIn.

## Licencia

MIT — usalo, adaptalo, rómpelo y arreglalo como quieras.
