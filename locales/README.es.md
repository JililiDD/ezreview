<p align="center">
  <img src="../assets/favicon.svg" alt="EZREVIEW logo" width="112">
</p>

<h1 align="center">EZREVIEW</h1>

<p align="center">
  Úsalo con AIPilot o de forma independiente para revisar HTML generado por IA en tu navegador.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ezreview"><img src="https://img.shields.io/npm/v/ezreview" alt="npm version"></a>
  <a href="../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933" alt="Node.js 20 o posterior">
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a> | <a href="./README.ja.md">日本語</a> | <b>Español</b>
</p>

`ezreview` es un compañero de revisión en el navegador para el plugin de flujo de trabajo de desarrollo con IA [AIPilot](https://github.com/JililiDD/aipilot), aunque funciona con cualquier agente de IA. Te permite dejar comentarios contextuales directamente en páginas generadas por IA y envía comentarios estructurados para que los agentes puedan localizar y solucionar problemas exactos en el documento fuente.

También funciona como una interfaz de línea de comandos (CLI) independiente para cualquier archivo HTML local. El servidor de revisión se ejecuta en tu máquina y se conecta a `127.0.0.1:4400`.

## Demostración

https://github.com/user-attachments/assets/f0a7700b-70dd-41da-8b16-f2aa0bdc6f56

## Características principales

- **Señala el problema exacto**: haz clic en un elemento o selecciona un rango de texto en la página renderizada
- **Envía contexto ejecutable**: cada anotación incluye un ID estable, selector, HTML relevante o texto seleccionado con contexto circundante
- **Edita y responde en un solo ciclo**: los agentes pueden modificar el código fuente según las solicitudes y responder directamente a las preguntas
- **Continúa la discusión**: cada anotación admite múltiples rondas de respuestas
- **Reanudación segura**: las opiniones en cola y los ID de anotaciones persisten tras desbordamientos de tiempo (timeouts) o reinicios del servidor
- **Privacidad local de datos**: el servidor solo escucha en `127.0.0.1`

## Instalación de EZREVIEW

Instala [Node.js](https://nodejs.org/) 20 o posterior, y luego instala `ezreview` de forma global:

```bash
npm install --global ezreview
```

Confirma la instalación:

```bash
ezreview --help
```

También puedes ejecutar una versión específica sin instalación global:

```bash
npx -y ezreview@latest tu_archivo.html
```

## Prompt para ejecutar una revisión independiente con un agente

AIPilot gestiona el ciclo de revisión continua por ti. Cuando utilices `ezreview` **SIN** AIPilot, indica a tu agente que mantenga la sesión activa y espere después de cada lote de comentarios.

Copia este prompt y reemplaza `tu_archivo.html` con el archivo que deseas revisar:

```text
Open tu_archivo.html with ezreview. Use your managed background-task mechanism
to keep the review server running, and keep each ezreview wait attached to the
current execution. Continuously wait for submitted comments. For every comment,
decide whether it requests a change or asks a question. Apply the requested
change or answer the question, reply through ezreview for every annotation ID,
then continue waiting for more feedback. Do not treat a command timeout, empty
output, file reload, or completed feedback batch as review completion. Do not
exit until I click Approve in ezreview or explicitly confirm in chat that the
review is complete.
```

## Referencia de la CLI

### Abrir una sesión de revisión

```bash
ezreview tu_archivo.html
```

Inicia un servidor de revisión local, abre el artefacto HTML en tu navegador y permanece activo mientras la sesión esté ejecutándose. Si lo ejecutas nuevamente para el mismo archivo, devolverá la URL de la sesión existente en lugar de iniciar otro servidor.

### Esperar comentarios

```bash
ezreview wait tu_archivo.html
```

Se bloquea hasta que el revisor envía un lote de comentarios (o regresa inmediatamente si hay comentarios en cola). Cada lote contiene solicitudes de cambio estructuradas, preguntas o ambas. Si un tiempo de espera lo interrumpe, ejecútalo de nuevo: la cola duradera devolverá el siguiente lote no consumido sin duplicar respuestas.

### Responder a una anotación

```bash
ezreview reply tu_archivo.html --to a-1 "Se actualizó el tamaño del encabezado."
```

Envía una respuesta a un hilo de anotación específico utilizando el ID devuelto por `wait`. Para una solicitud de cambio, guarda el archivo fuente antes de responder; el navegador recargará el artefacto y mostrará tu respuesta dentro de la anotación correspondiente.

Para respuestas multilínea que contengan saltos de línea codificados (`\n`), añade `--decode-newlines`:

```bash
ezreview reply tu_archivo.html --to a-1 --decode-newlines "Primer párrafo\n\nSegundo párrafo"
```

El navegador conservará los saltos de línea y el espaciado de párrafos reales. La decodificación es opcional para que los ejemplos de código que contienen `\n` literal no se modifiquen de forma predeterminada.

## Ciclo de revisión del agente

Un agente de IA debe ejecutar `ezreview wait` como un comando estándar en primer plano/bloqueante en lugar de desacoplarlo con `&`, `nohup` o `disown`. Esto garantiza que el agente se bloquee hasta que lleguen los comentarios y consuma el resultado de inmediato.

Para cada lote de comentarios, el agente debe:

1. Leer cada anotación devuelta por `ezreview wait`
2. Editar el archivo fuente para las solicitudes de cambio
3. Responder preguntas sin modificar el archivo a menos que el comentario sugiera un arreglo
4. Ejecutar `ezreview reply` una vez por cada ID de anotación
5. Iniciar un nuevo `ezreview wait` bloqueante en primer plano
6. Continuar hasta que selecciones **Approve** o confirmes el fin de la revisión en el chat

## ¿Por qué usar EZREVIEW con AIPilot?

[AIPilot](https://github.com/JililiDD/aipilot) impulsa un flujo de trabajo de desarrollo con IA a través de documentos Markdown estructurados. `ezreview` proporciona el ciclo de retroalimentación interactivo en el navegador, lo que te permite revisar vistas previas de interfaz de usuario y documentos de diseño en tiempo real.

```text
AIPilot crea un documento o vista previa de diseño
                  ↓
EZREVIEW lo abre en el navegador
                  ↓
Anotas un elemento o seleccionas texto exacto
                  ↓
El agente recibe comentarios estructurados
                  ↓
El agente edita o responde, y EZREVIEW recarga el resultado
```

Ya no necesitas tomar capturas de pantalla ni describir manualmente dónde está un problema en el chat. `ezreview` fija tus comentarios directamente en las vistas previas de HTML renderizadas generadas por AIPilot, brindando al agente referencias exactas de elementos y texto sobre los cuales actuar.

## Proyectos relacionados

- [AIPilot](https://github.com/JililiDD/aipilot): el flujo de trabajo de desarrollo con IA basado en documentos que utiliza `ezreview` para la revisión en navegador
- [lavish-axi](https://github.com/kunchenguid/lavish-axi): el proyecto que inspiró `ezreview`
