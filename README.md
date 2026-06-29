# Spade — Prototipo

Spade es una plataforma de gestión de producto asistida por inteligencia
artificial. Este repositorio contiene el **código fuente del prototipo** puesto
a disposición de la cátedra y de la Comisión Académica Evaluadora, junto con el
presente **instructivo de puesta en marcha**.

El prototipo implementa los **procesos centrales del núcleo del sistema**:

1. **Construcción del grafo de conocimiento** (*Product Brain*) — un grafo
   tipado de nodos (features, decisiones/ADRs, convenciones, feedback, bugs,
   métricas) y relaciones dirigidas que representa el conocimiento del producto.
2. **Generación de *issues* mediante inteligencia artificial** — a partir de una
   fuente en lenguaje natural, el sistema extrae y propone decisiones, features y
   un *backlog* de tareas, y detecta automáticamente vacíos del grafo
   (*Graph & Issues*).
3. **Orquestación de agentes de código** — un agente *orquestador*
   conversacional dirige una flota de agentes que ejecutan las tareas a través de
   un *pipeline* de cuatro etapas (Developer → Reviewer → Integrator →
   Documentor).

> 📹 **Video de demostración (4–5 min).** El repositorio incluye un video que
> muestra y explica el escenario de extremo a extremo descripto más abajo. Se
> encuentra en [`docs/demo/`](docs/demo/) (archivo de video o enlace indicado en
> la entrega).

---

## 1. Arquitectura (resumen)

Monorepo con dos aplicaciones:

| App | Tecnología | Rol |
|-----|------------|-----|
| **`apps/api`** | Python · FastAPI · SQLite | *Backend* y fuente de verdad. Expone la API HTTP en `:8765` y orquesta los agentes mediante **tmux** + el CLI `claude`. |
| **`apps/client`** | Next.js · React · TypeScript · Tailwind | Interfaz web en `:3000` (hace *proxy* de `/api/*` hacia el *backend*). |

Los datos (la base SQLite y los directorios de cuentas) se almacenan por defecto
en `~/spade-qa`.

> La referencia técnica detallada (decisiones de diseño, automatización de la TUI
> vía tmux, catálogo completo de *endpoints*) está en
> [`docs/README.tech.en.md`](docs/README.tech.en.md).

---

## 2. Requisitos previos

Antes de instalar, asegurarse de contar con:

- **Sistema operativo:** macOS o Linux.
- **Python 3.11 o superior** (se recomienda 3.12).
- **Node.js 20 o superior** y **npm**.
- **`tmux`** en el `PATH` (`brew install tmux` / `apt install tmux`).
- **El CLI `claude` (Claude Code)** instalado y **con sesión iniciada**. La
  orquestación de agentes se ejecuta sobre una cuenta de Claude autenticada; sin
  una cuenta con sesión válida, los agentes no pueden iniciarse.
- **`make`** y, opcionalmente, **`uv`** (acelera la creación del entorno; si no
  está, se usa `python -m venv`).

---

## 3. Instalación y configuración

### 3.1. Instalación de dependencias

Desde la raíz del repositorio, una única vez:

```bash
make setup
```

Esto crea el entorno virtual de Python, instala las dependencias del *backend*
(`apps/api/requirements.txt`) y ejecuta `npm install` en el *cliente*.

### 3.2. Puesta en marcha

```bash
make dev
```

Levanta **ambos** servidores con recarga en caliente y los detiene juntos con
`Ctrl-C`:

- API (FastAPI) en `http://127.0.0.1:8765`
- Interfaz web (Next.js) en **http://127.0.0.1:3000**

Abrir **http://127.0.0.1:3000** en el navegador.

> Para usar otra carpeta de datos o puerto:
> `make dev DATA_HOME=~/otra-carpeta PORT=9000`.
> Otros objetivos útiles: `make api` (sólo API), `make test`, `make fresh`
> (borra la carpeta de datos para empezar de cero), `make stop`.

### 3.3. Conectar una cuenta de Claude (paso obligatorio)

La generación de issues y la ejecución de agentes requieren una cuenta de Claude
autenticada:

1. En la barra lateral, ir a **Agent pool** (Ejecución → *Agent pool*).
2. Conectar/importar un directorio de configuración de Claude Code que tenga la
   **sesión iniciada** (por ejemplo `~/.claude`). Si la cuenta no tiene sesión
   activa, la interfaz lo indicará.

---

## 4. Escenario completo de extremo a extremo (reproducible)

El siguiente recorrido reproduce el flujo central del sistema: **ingesta de una
fuente → generación de issues con IA → ejecución de un issue por un agente →
verificación de la trazabilidad sobre el grafo**. Todo se realiza desde la
interfaz web; no requiere usar la terminal.

### Paso 1 — Crear un proyecto

En el selector de proyectos (arriba a la izquierda) elegir **Nuevo proyecto**,
indicar un nombre (por ejemplo *“Todo App”*) y crearlo. Un proyecto nuevo aparece
correctamente **vacío** (sin datos de ejemplo).

### Paso 2 — Ingesta de la fuente (conversación en lenguaje natural)

Abrir el asistente **Ask** (botón *Ask* o `⌘K`) y describir el producto en
lenguaje natural, como si se lo contara a un compañero. Por ejemplo:

> *«Quiero una app de tareas: la gente anota pendientes, los marca como hechos,
> los edita o elimina, y filtra los abiertos. Pensaba un front en React + Vite y
> un back en FastAPI + SQLite. ¿Podés armar el grafo de conocimiento y un backlog
> inicial?»*

A partir de esta **fuente**, Spade extrae el conocimiento y **propone** una
decisión de arquitectura (ADR), un conjunto de features y un *backlog* de tareas.

> La primera respuesta puede demorar entre 1 y 2 minutos: el orquestador realiza
> múltiples operaciones reales para construir el grafo y el backlog. Es esperable.

### Paso 3 — Aprobar → se construye el grafo de conocimiento

El asistente propone primero y **espera confirmación**. Al aprobar (por ejemplo
*«Aprobado, creá todo en Spade»*), el sistema **crea los registros reales**: los
nodos del grafo de conocimiento (la decisión propuesta y las features) y las
tareas del *backlog* (los *issues*). Cada registro creado aparece como un
**chip enlazable** en la conversación que lleva a su ficha.

Verificar el grafo en **Product brain** (Plan → *Product brain*): se ven los
nodos creados y sus relaciones, con la descripción de cada nodo renderizada en
*Markdown*.

### Paso 4 — Generación de *issues* por IA (detección de vacíos)

Ir a **Graph & Issues** (Plan → *Graph & Issues*). Sobre el grafo construido, la
IA detecta **vacíos** y los presenta como *issues* (por ejemplo: una decisión en
estado *propuesto* pendiente de promover, un nodo huérfano, o una feature sin
decisión asociada). Esta es la generación de issues asistida por IA sobre el
conocimiento del producto.

### Paso 5 — Orquestación: ejecutar un *issue* con un agente

Ir al **Backlog**, abrir una de las tareas creadas y pulsar **Resume pipeline**
(o, desde **Ask**, pedir *«ejecutá la tarea SPD-00X»*). Esto lanza el *pipeline*
de cuatro etapas **Developer → Reviewer → Integrator → Documentor**; un agente
`claude` real toma la tarea y comienza a ejecutarla. El estado de la ejecución se
sigue en vivo desde **Orchestrator** y desde la propia ficha de la tarea
(*Pipeline history*).

### Paso 6 — Verificar la trazabilidad sobre el grafo

Abrir la ficha de la tarea ejecutada (**Backlog → tarea**) y comprobar la
**trazabilidad de extremo a extremo**:

- la tarea enlaza a sus **nodos del grafo** (la decisión/ADR, las features y
  cualquier bug o métrica asociada), cada uno con vínculo a su ficha;
- el **origen** de la tarea (la cita o fuente que la motivó) queda registrado;
- el **historial del pipeline** muestra la ejecución del agente;
- en **Product brain** el grafo refleja los nodos creados y sus relaciones, y el
  grafo puede exportarse (formato MCP) para su verificación externa.

De este modo, todo *issue* ejecutado por un agente queda trazado hasta el
conocimiento del producto que lo originó.

---

## 5. Verificación de la instalación (pruebas)

```bash
# Pruebas del backend (Python):
make test

# Pruebas del cliente (unitarias + end-to-end):
cd apps/client && npm test && npm run e2e
```

Las pruebas del *backend* deterministas no requieren un `claude` en vivo; las
pruebas de integración que sí lo requieren están marcadas como opcionales
(`TUI_PILOT_LIVE=1`).

---

## 6. Resolución de problemas

- **“the orchestrator hit an error” / error 500 al enviar el primer mensaje.**
  Suele deberse a (a) no haber conectado una cuenta de Claude **con sesión
  iniciada** (ver paso 3.3), o (b) reiniciar el servidor en pleno envío si se
  ejecuta con recarga en caliente. La interfaz reintenta automáticamente los
  cortes transitorios.
- **La primera respuesta tarda.** Es normal: construir el grafo + el backlog
  implica muchas operaciones reales (~1–2 min). La interfaz muestra el estado
  *“pensando”* mientras tanto.
- **Empezar de cero.** `make fresh` borra la carpeta de datos (`~/spade-qa`).

---

## 7. Estructura del repositorio

```
.
├── apps/
│   ├── api/      Backend FastAPI + SQLite + orquestación de agentes (tmux)
│   └── client/   Interfaz web Next.js
├── docs/
│   ├── README.tech.en.md   Referencia técnica detallada (inglés)
│   ├── demo/               Video de demostración (4–5 min)
│   └── …                   Documentos de diseño y alineación de producto
├── Makefile     Objetivos de instalación y ejecución (setup / dev / test / …)
└── README.md    Este instructivo
```
