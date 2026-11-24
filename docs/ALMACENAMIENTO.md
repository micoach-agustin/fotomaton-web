# Conectar tu propio almacenamiento

El modo local no utiliza ningún backend. Esta guía describe cómo implementar **tu receptor**, que no viene desplegado con la app. Las cuentas y secretos de cada instalación pertenecen a su propietario.

## Contrato del receptor

Configura `VITE_STORAGE_MODE=endpoint` y `VITE_STORAGE_ENDPOINT=/api/photobooth` en `.env.local` y recompila. El receptor puede estar en otro dominio HTTPS si permite CORS para el origen de tu fotomatón. En ese caso debe aceptar `POST`, `OPTIONS` y el encabezado `Idempotency-Key`. No uses un comodín de orígenes para un receptor privado.

Cada captura genera un `POST multipart/form-data` con:

| Campo | Contenido |
| --- | --- |
| `file` | Archivo JPG, MP4/WebM o mensaje TXT |
| `metadata` | Cadena JSON con `captureId`, `eventId`, `eventName`, `kind`, `createdAt` y, para mensajes, `text` opcional |
| Encabezado `Idempotency-Key` | El mismo UUID que `metadata.captureId`; se conserva en los reintentos |

El receptor devuelve HTTP 200/201 con `{"ok":true}` **después** de guardar de forma duradera el archivo y sus metadatos. Cualquier otro resultado mantiene la captura en la cola del navegador. El tiempo máximo por intento es de 120 segundos. Las fotos del fotomatón se envían automáticamente cuando se crea su vista previa; los mensajes se envían al pulsar Enviar mensaje.

Implementa autenticación de invitados o acceso temporal del evento en tu servidor. El cliente incluye cookies únicamente para el mismo origen (`credentials: same-origin`), por lo que puedes proteger una ruta del propio website mediante su sesión. Para un backend de otro dominio, adapta la autenticación y CORS en `src/photobooth/storage.ts`. No incrustes un secreto del servidor en `VITE_` ni confíes en `Origin` como única autenticación.

En el servidor valida sesión, evento autorizado, tipo real, tamaño máximo, UUID y metadatos. Genera rutas a partir de valores validados; nunca uses directamente un nombre de archivo o `eventId` recibido como ruta. Añade límites de uso para tu evento. Guarda de forma atómica el estado de cada `captureId`: un reintento o dos pestañas pueden reenviar el mismo archivo. Devuelve `ok:true` también si ese UUID ya está guardado. Un ejemplo de código de proveedor no sustituye estas validaciones.

## AWS S3

1. Crea tu propio bucket privado y elige región y prefijo del evento.
2. Autoriza al rol del backend para `s3:PutObject` solo en ese prefijo; no hagas público el bucket para recibir subidas.
3. Instala `@aws-sdk/client-s3` **en tu backend**, no en el frontend. Usa un rol IAM del entorno; si usas claves, guárdalas solo como secretos del servidor.
4. El receptor procesa el multipart, valida sus campos y guarda el contenido con una clave estable derivada de `captureId`. Guarda también los metadatos del mensaje, por ejemplo en un JSON asociado.
5. Confirma al navegador cuando ambas operaciones hayan terminado.

Núcleo ilustrativo del adaptador, para colocar **dentro de un receptor autenticado y validado**:

```js
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: process.env.AWS_REGION });

async function storeCapture({ validatedKey, bytes, mime }) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: validatedKey,
    Body: bytes,
    ContentType: mime,
  }));
}
```

Variables **del servidor**: `AWS_REGION`, `S3_BUCKET` y las credenciales o rol propios. Los ejemplos completos de operaciones se encuentran en la [documentación oficial del SDK de AWS](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html).

Para vídeos grandes puedes adaptar el cliente a subidas directas con [URLs prefirmadas de S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html). El cliente incluido usa el contrato multipart anterior; no interpreta una URL prefirmada como receptor. Las credenciales que firman permanecen en el servidor.

## Google Drive

1. Crea tu proyecto de Google Cloud y habilita Drive API.
2. Configura OAuth 2.0 para tu backend y autoriza la cuenta de Drive que recibirá los archivos. Usa acceso offline si necesitas renovar la autorización del propietario sin que esté conectado durante el evento. Los invitados no necesitan tu contraseña.
3. Crea o selecciona una carpeta a la que esa autorización tenga acceso. Conserva su ID en `DRIVE_FOLDER_ID` como configuración del servidor. El alcance `drive.file` permite archivos/carpetas creados por tu app o elegidos explícitamente para ella; no presupongas acceso a cualquier carpeta existente.
4. Guarda `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` y `GOOGLE_REFRESH_TOKEN` únicamente en los secretos de tu backend. Instala allí `googleapis`.
5. Guarda la captura en esa carpeta con `files.create`. Para vídeos grandes o conexiones inestables, implementa la subida reanudable que describe Google. Registra `captureId` y los metadatos de forma duradera para evitar duplicados en los reintentos.

Núcleo ilustrativo, después de validar y autenticar la petición:

```js
import { Readable } from 'node:stream';
import { google } from 'googleapis';

const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);
auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth });

async function storeCapture({ validatedName, captureId, bytes, mime }) {
  const result = await drive.files.create({
    requestBody: {
      name: validatedName,
      parents: [process.env.DRIVE_FOLDER_ID],
      appProperties: { captureId },
    },
    media: { mimeType: mime, body: Readable.from([bytes]) },
    fields: 'id',
  });
  return result.data.id;
}
```

Es un ejemplo de la operación de guardado; no incluye el flujo de consentimiento OAuth, el receptor HTTP, las validaciones ni el registro de idempotencia. Consulta las guías oficiales de [OAuth para aplicaciones de servidor](https://developers.google.com/identity/protocols/oauth2/web-server), [subida de archivos a Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads) y [búsqueda de archivos](https://developers.google.com/workspace/drive/api/guides/search-files).

## Otros destinos

Puedes implementar el mismo receptor con almacenamiento local del servidor, Cloudflare R2, Backblaze B2, MinIO, Dropbox u otro servicio. Conserva el contrato multipart y la confirmación `ok:true`, y configura sus credenciales solo en el backend. Ningún proveedor está activado por defecto.

## Prueba antes del evento

Con una captura de prueba, comprueba que llega al destino y que un corte de conexión deja el envío pendiente. Al reintentar debe conservarse un único archivo por `captureId`. Verifica también una foto, un vídeo y un mensaje desde los móviles que se usarán. No se han probado cuentas de nube reales en esta extracción: cada instalación debe validar su propio receptor.
