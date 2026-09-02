# Resumen técnico

Fase 4 añade automatización y analítica sin cambiar el contrato público del módulo. La fachada `mantenimiento.js` carga `mantenimiento-analytics-ui.js`, que envuelve la capa trazable de Fase 3 y consulta un único RPC tenant-safe para indicadores. Las alertas se producen en PostgreSQL mediante Supabase Cron y no dependen de que el navegador esté abierto.
