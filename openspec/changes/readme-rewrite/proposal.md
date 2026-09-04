# Proposal: README Rewrite for LinkedIn Job Alerts v2

## Intent

Reescribir completamente el README.md para documentar la v2 real del sistema: pipeline Google Apps Script + JSearch + Gemini + Notion + Telegram. El README actual documenta el sistema legacy n8n (obsoleto desde 2026-08-25) y contiene 10+ secciones incorrectas o irrelevantes. El nuevo README será el documento principal de referencia pública del proyecto.

## Scope

### Secciones del README nuevo

| Sección | Contenido |
|---------|-----------|
| Título | Nombre del proyecto + una-línea de qué hace |
| Descripción del proyecto | Párrafo inicial que explica el propósito: qué problema resuelve, qué detecta (ofertas de empleo con IA), a quién sirve (búsqueda laboral automatizada), cómo funciona en una frase (busca → scorea → filtra → notifica) |
| Stack tecnológico | Apps Script, JSearch/RapidAPI, Gemini, Notion, Telegram — con costo $0 |
| Arquitectura | Diagrama de flujo del pipeline de 6 pasos (embebido ASCII + referencia al diagrama HTML separado) |
| Flujo del pipeline | Descripción de cada paso: parity gate → fetch → dedup → pre-filter → score → filter → notify |
| Configuración | Constantes de `src/config.js`: keywords, threshold, modelo, ubicación, perfil, exclusiones |
| Variables de entorno | Script Properties: las 6 claves necesarias (RAPIDAPI_KEY, GEMINI_API_KEY, NOTION_TOKEN, NOTION_DB_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) |
| Schema de Notion | Tabla con las propiedades de la database (Nombre, Empresa, Link, Score, Fuente, Descripción, Estado, Keyword, Fecha publicación) |
| Deploy paso a paso | Crear proyecto Apps Script → pegar módulos → configurar Script Properties → crear trigger diario ~8am → verificar parity gate |
| Cuotas free tier | Tabla de capacidad: UrlFetchApp 20k/día, JSearch ~200 req/mes (~45-60 usados), Apps Script trigger ~90min/día |
| Licencia | MIT — preservar tono cálido "usalo, adaptalo, rómpelo y arreglalo" |

### Out of Scope
- NO se documenta el sistema legacy n8n (quedaba en el README actual)
- NO se incluye historia personal del autor (directo al grano)
- NO se modifica ningún archivo en `src/`
- NO se genera el diagrama HTML (fase de apply separada con archify)
- NO se agrega deploy automático con clasp (es manual, futuro)
- NO se documenta ROADMAP.md como fuente de verdad (el README lo referencia pero no lo reemplaza)

## Capabilities

### New Capabilities
- `readme-v2-documentation`: Reescritura completa del README.md como documento de referencia pública del sistema v2

### Modified Capabilities
None — no hay specs existentes que cambien; esto es documentación pura.

## Approach

**Reescritura completa desde cero** (Approach 1 del exploration). Razones:
1. El 95% del README actual es n8n-legacy → cirugía por secciones tendría más riesgo de contaminación
2. Un documento coherente nuevo es más limpio y mantenible
3. El exploration identificó 10+ items obsoletos y 9 items faltantes

### Diagrama de arquitectura

- **Archivo externo**: `docs/diagrams/architecture.html` — generado con la skill archify en fase de apply (NO en esta fase)
- **Referencia en README**: Sección "Arquitectura" con link al diagrama HTML + diagrama ASCII inline que muestre:
  1. Trigger diario ~8am
  2. Parity gate (day % 2 → odd = exit, even = continue)
  3. JSearch fetch × 3 keywords (con strict→relaxed fallback)
  4. Dedup (batch + Notion history)
  5. Pre-filter (seniority exclude + tech-stack require)
  6. Gemini scoring (batch 15 + fallback individual + retry 3)
  7. Filter score ≥ 75
  8. Notion create + Telegram notify (o no-match summary)

### Orden de ejecución
1. Reescribir README.md completo en español neutro profesional
2. En fase de apply separada: generar `docs/diagrams/architecture.html` con archify
3. Actualizar link en README apuntando al diagrama generado

## Affected Areas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `README.md` | Reescritura completa | Reemplazar 100% del contenido actual (n8n-legacy) con v2 real |
| `docs/diagrams/` | Nuevo directorio | Contendrá `architecture.html` generado en apply con archify |
| `src/` | Sin cambios | Solo lectura — fuente de verdad para el contenido |
| `ROADMAP.md` | Sin cambios | Referenciado desde README como historial de construcción |

## Risks

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| Drift de config: el README copia valores incorrectos de config.js | Media | Verificar cada constante contra `src/config.js` antes de publicar (threshold=75, modelo=gemini-3.6-flash, keywords junior, etc.) |
| Pérdida de voz del autor: reescritura completa puede sonar fría/dérmica | Baja | Preservar tono cálido en licencia y disclaimer; el exploration recomienda mantener "usalo, adaptalo, rómpelo y arreglalo" |
| Nombre de modelo stale: GEMINI_MODEL es "update as needed" | Media | Documentar que el modelo es una constante configurable, no hardcodear claim que se vaya a romper |
| Cuota RapidAPI agotada: usuario no espera el límite ~200/mes | Baja | Sección dedicada de "Cuotas free tier" con tabla explícita |
| Diagrama HTML no generado: phase apply puede fallar o diferirse | Baja | README funciona sin el diagrama externo (tiene ASCII inline); el HTML es complemento |

## Rollback Plan

Cambio de un solo archivo (`README.md`). Rollback: `git checkout HEAD -- README.md`. No hay dependencias ni migraciones.

## Dependencies

- Fase de apply para generar `docs/diagrams/architecture.html` con skill archify
- `src/config.js` como fuente de verdad para valores de configuración
- `src/pipeline.js` y `src/services.js` como fuente de verdad para lógica del pipeline

## Success Criteria

- [ ] README.md contiene 0 referencias a n8n (verificar con grep)
- [ ] Todas las secciones listadas en Scope están presentes
- [ ] Valores de config (threshold, modelo, keywords) coinciden exactamente con `src/config.js`
- [ ] Pasos de deploy son reproducibles paso a paso
- [ ] Documento en español neutro profesional
- [ ] Licencia MIT preservada con tono cálido
