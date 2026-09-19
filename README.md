# Encargos para Venezuela 🇻🇪

Aplicación web para organizar las cosas que le vas a llevar a distintas personas en un viaje a Venezuela. La lista es **compartida y en tiempo real**: tú entras desde el celular a ver qué falta y tu familia entra desde otros dispositivos a marcar qué está listo, y todos ven los cambios al instante.

## ✨ Características

- **Organización por persona.** Cada persona tiene su propia lista de artículos.
- **Marcar como listo sin que desaparezca.** Al marcar un artículo con el check queda **tachado** pero sigue visible.
- **Secciones colapsables.** Puedes esconder y mostrar la lista de cada persona para ver de un vistazo, en el resumen, cuántos artículos tiene cada una y cuántos le faltan.
- **Barras de progreso por persona** (por ejemplo "3 de 5 listos") y un **contador general** con el total de artículos y cuántos ya están listos.
- **Agregar, editar y borrar** personas y artículos desde la misma web, sin tocar código.
- **Cantidad y notas** por artículo (por ejemplo "Zapatillas x2 talla 38").
- **Buscar y filtrar**, incluida la opción de ver solo lo pendiente.
- **Categorías / etiquetas** para los artículos (ropa, medicinas, comida, regalos, calzado, otros).
- **Tiempo real** entre dispositivos usando Supabase Realtime.
- **Diseño responsive**, moderno y minimalista, con acentos de los colores de Venezuela (amarillo, azul, rojo) y **modo oscuro** amigable para la vista.

## 🧱 Arquitectura

Es una app **estática "buildless"**: no necesita `npm install` ni ningún paso de compilación. Son archivos HTML, CSS y JavaScript servidos tal cual. El cliente de Supabase se carga desde un CDN como módulo ES, así que no hay dependencias que instalar.

```
.
├── public/                 # Todo lo que se publica (Vercel sirve esta carpeta)
│   ├── index.html
│   ├── styles.css
│   ├── app.js              # Lógica de la app (Supabase + realtime + UI)
│   ├── config.example.js   # Plantilla de credenciales (se versiona)
│   └── config.js           # Tus credenciales reales (NO se versiona)
├── supabase/
│   └── schema.sql          # Crea las tablas, activa Realtime y configura RLS
├── vercel.json             # Configuración de hosting estático en Vercel
└── README.md
```

La app lee `window.APP_CONFIG` (definido en `public/config.js`) para obtener `SUPABASE_URL` y `SUPABASE_ANON_KEY`, crea el cliente de Supabase, se suscribe a los cambios de Postgres en las tablas `people` e `items`, y vuelve a renderizar cuando algo cambia.

---

## 🚀 Puesta en marcha

### PASO 1 - Configurar Supabase

1. Entra a tu proyecto en [Supabase](https://supabase.com/).
2. Abre el **SQL Editor** (Editor SQL).
3. Copia el contenido de [`supabase/schema.sql`](supabase/schema.sql), pégalo y ejecútalo ("Run"). Esto crea las tablas `people` e `items`, agrega el índice, activa Realtime y configura las políticas de acceso (RLS).
4. Confirma que **Realtime está activado** para ambas tablas: ve a **Database → Replication** (o **Publications**) y verifica que `people` e `items` estén dentro de la publicación `supabase_realtime`. El script ya lo hace, esto es solo para comprobarlo.

### PASO 2 - Configurar las credenciales

1. Copia la plantilla a un archivo real de configuración:

   ```bash
   cp public/config.example.js public/config.js
   ```

2. Abre `public/config.js` y rellena tus valores. Los encuentras en Supabase en **Project Settings → API**:
   - `SUPABASE_URL` → el campo **Project URL**.
   - `SUPABASE_ANON_KEY` → la clave **anon** / **public** dentro de **Project API keys**.

   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
     SUPABASE_ANON_KEY: 'TU-ANON-KEY',
   };
   ```

3. `public/config.js` está en `.gitignore` para que no subas credenciales por error. En su lugar se versiona `public/config.example.js`.

> **La clave `anon` es segura de exponer en el navegador** siempre que tengas RLS (Row Level Security) activado en Supabase, como lo deja configurado `schema.sql`. Está diseñada precisamente para usarse desde el cliente.

### PASO 3 - Desplegar en Vercel

1. Sube este repositorio a GitHub (o al proveedor que uses).
2. En [Vercel](https://vercel.com/) haz clic en **Add New → Project** e importa el repositorio.
3. Configuración del proyecto:
   - **Framework Preset:** `Other` (es un sitio estático, sin framework).
   - **Output Directory:** `public`.
   - **Build Command:** configúralo según la siguiente sección ("Generar `config.js` en Vercel sin subir credenciales"). Ese comando genera `public/config.js` con tus credenciales en cada despliegue. Si prefieres crear `config.js` a mano (ver la alternativa manual más abajo), puedes dejar el Build Command vacío.
4. Haz clic en **Deploy**. El archivo [`vercel.json`](vercel.json) ya define `outputDirectory: "public"`, así que Vercel servirá la carpeta correcta.

#### Generar `config.js` en Vercel sin subir credenciales

Para que la app funcione en producción tiene que existir `public/config.js` con tus credenciales reales. La forma recomendada es **generarlo en el despliegue a partir de variables de entorno de Vercel**, de modo que la clave nunca quede guardada en el historial de git:

1. En Vercel, ve a **Project Settings → Environment Variables** y crea dos variables:
   - `SUPABASE_URL` → el **Project URL** de Supabase.
   - `SUPABASE_ANON_KEY` → la clave **anon** / **public**.
2. En el mismo proyecto de Vercel, define el **Build Command** para escribir `public/config.js` a partir de esas variables antes de publicar:

   ```bash
   node -e "require('fs').writeFileSync('public/config.js', 'window.APP_CONFIG = ' + JSON.stringify({SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY}) + ';')"
   ```

   Deja el **Output Directory** en `public`. Con esto Vercel crea `config.js` en cada despliegue leyendo las variables de entorno, y el archivo nunca se versiona.

> **¿Por qué no simplemente subir `config.js` al repo?** La clave `anon` está pensada para usarse en el navegador y es de bajo riesgo con RLS activado, pero aun así conviene **no dejarla en el historial de git**: si más adelante endureces las políticas RLS o reutilizas la clave, el historial quedaría como una fuga difícil de borrar. Por eso `config.js` sigue en `.gitignore` y se genera en el despliegue.
>
> Si prefieres la vía más simple para una lista familiar puntual, puedes crear `public/config.js` a mano en tu copia local antes de subir. En ese caso ten presente el compromiso anterior y evita reutilizar esa clave en otros proyectos.

### Vista previa local (opcional)

No hace falta instalar nada. Desde la raíz del proyecto puedes levantar un servidor estático:

```bash
python3 -m http.server 5173 --directory public
```

Luego abre [http://localhost:5173](http://localhost:5173) en el navegador. Necesitas tener `public/config.js` creado (PASO 2) para que cargue los datos.

---

## 🔒 Nota de seguridad (modelo compartido y abiertamente editable)

Esta app **no tiene login**. Es intencional: es una lista familiar pensada para compartirse. Cualquiera que tenga el enlace puede leer y editar la lista, porque las políticas de RLS de `schema.sql` permiten lectura y escritura al rol `anon`. Es un modelo adecuado para uso familiar de bajo riesgo, pero conviene tenerlo claro.

Si más adelante quieres restringir el acceso **sin montar un sistema de login completo**, tienes opciones ligeras:

- **Passphrase compartida:** poner la app detrás de una contraseña compartida validada por una [Edge Function de Supabase](https://supabase.com/docs/guides/functions), de modo que el cliente hable con esa función en vez de con las tablas directamente.
- **Auth completo:** activar [Supabase Auth](https://supabase.com/docs/guides/auth) y cambiar las políticas de RLS para exigir usuarios autenticados (por ejemplo `auth.role() = 'authenticated'`).

Mientras uses la clave `anon` con RLS activado, no se exponen tablas ni operaciones fuera de las que las políticas permiten.

---

## 🛠️ Si editas el código

Como no hay paso de compilación, un buen chequeo rápido tras editar `public/app.js` es validar la sintaxis de JavaScript:

```bash
node --check public/app.js
```

Si no reporta nada, la sintaxis está bien.
