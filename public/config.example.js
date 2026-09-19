// -----------------------------------------------------------------------------
// Configuracion de Supabase (PLANTILLA DE EJEMPLO)
// -----------------------------------------------------------------------------
// 1. Copia este archivo y renombralo a "config.js" dentro de la carpeta public/:
//        cp public/config.example.js public/config.js
// 2. Reemplaza los valores de abajo por los de TU proyecto de Supabase.
//    Los encuentras en: Supabase -> Project Settings -> API
//       - SUPABASE_URL      = "Project URL"
//       - SUPABASE_ANON_KEY = "Project API keys" -> "anon" / "public"
//
// NOTA: la clave "anon" esta pensada para usarse en el navegador y es segura
// de exponer siempre que tengas activado RLS (Row Level Security) en Supabase.
// Aun asi, config.js esta en .gitignore para que no subas credenciales por error.
// -----------------------------------------------------------------------------

window.APP_CONFIG = {
  SUPABASE_URL: 'https://kktkrajfmgwtrtppbzlm.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_fT2-WyQONeQgp6z5etL0qg_OqkDB3QM',
};
