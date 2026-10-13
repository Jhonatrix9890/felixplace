# FelixPlace en Netlify: propuesta de arquitectura

Este documento sustituye el borrador anterior de Supabase. No se ha ejecutado ninguna migración ni se ha conectado el panel al sitio.

## Decisiones base

- **Alojamiento y despliegue:** Netlify conectado al repositorio GitHub de la rama de trabajo.
- **Base:** Netlify Database (PostgreSQL). Consultas y escrituras solo desde el servidor, nunca desde JavaScript público.
- **Sitio:** migración gradual a Astro con el adaptador de Netlify. Mantener como estático lo que no cambia y renderizar las publicaciones por slug bajo demanda para que una publicación nueva no requiera un despliegue.
- **Acceso editorial:** Netlify Identity, invitaciones únicamente; sin formulario público para crear cuentas. Jonathan conserva `admin`; su novia y futuros autores invitados tendrán `editor` y podrán publicar directamente. Los roles se verifican en cada función del servidor.
- **Imágenes:** conservar Postimages y guardar sus URLs en la base.
- **Contenido:** una tabla `posts` para noticias y tutoriales, separadas por `kind`; las rutas serán `/noticias/{slug}` y `/tutoriales/{slug}`.
- **Comentarios:** el nombre público es suficiente; comentarios nuevos quedan `pending` hasta moderación. Envíos pasan por una función con validación, límite de frecuencia y anti-spam.
- **Amazon:** conservar el catálogo de productos y asociar artículos relacionados; mantener visible la divulgación de afiliación.
- **Cursos:** primera etapa para catálogo, temario y lecciones de muestra. Matrículas, contenido privado y cobros se agregan después de elegir el medio de pago.

## Datos que el esquema ya contempla

La migración `netlify/database/migrations/0001_create_felixplace_core.sql` prepara perfiles editoriales sin contraseñas, publicaciones nuevas, comentarios moderables, productos afiliados, cursos, módulos, lecciones y una bitácora editorial. No contempla importar las publicaciones antiguas.

## Flujo para llevarlo a Netlify

1. Confirmar la rama correcta en VS Code y crear un respaldo antes de tocar la versión publicada.
2. Ejecutar `netlify database init` en la copia local para instalar el paquete oficial, configurar el proyecto, y validar la base local con `netlify dev`.
3. Integrar la migración y revisar la estructura que genere la CLI para esta cuenta/proyecto antes de crear una base remota.
4. Crear la primera base para la rama de trabajo y probar el deploy preview; no importar todavía los datos reales.
5. Crear las funciones para consultas públicas y operaciones editoriales, validando sesión y rol en el servidor.
6. Preparar el panel para crear contenido nuevo y probar slug duplicado, comentarios y productos afiliados.
7. Publicar gradualmente las secciones nuevas y validar SEO, enlaces, formularios y experiencia móvil.

## Límites que deben quedar claros

- Este SQL es el borrador inicial del modelo, no incluye la interfaz, las funciones, el login ni la importación de datos.
- No guardar contraseñas, tokens ni claves privadas en tablas, HTML, `netlify.toml` ni Git. Los secretos van en variables privadas de Netlify.
- Las lecciones `enrolled` no deben entregarse al público hasta tener autorización de matrículas probada. La base lista el campo, pero aún no existe control de acceso de estudiantes.
- El esquema incluye cursos, pero no cobra. No definir precios ni pasarela hasta confirmar país, moneda y cómo se entregará el curso.
- Revisar en el panel de Netlify el plan y límites del proyecto antes de encender la base. Los créditos dependen de uso de cómputo y ancho de banda, además del costo de despliegues.
