"""Canned meeting transcripts for the ingest demo.

These stand in for a real meeting-notes integration (Granola / Otter / Fireflies
/ Zoom). Each sample carries a realistic transcript whose action lines are tagged
with an arrow (``→``) — `meetings.extract_action_items` parses those into backlog
tasks. A leading ``!`` after the arrow (``→!``) marks a high-priority item.

Deterministic on purpose: no model call, no tokens, so the live demo always lands
the same way. Add a sample by appending to SAMPLES (pure data).
"""

from __future__ import annotations

# Each sample: a key → {title, date, source, attendees, summary, transcript}.
# `source` names the upstream tool the notes "came from" (for the UI badge).
SAMPLES: dict[str, dict] = {
    "todo-kickoff": {
        "title": "Todo App — kickoff",
        "date": "2026-06-26",
        "source": "Granola",
        "attendees": ["Tú", "Jose"],
        "summary": (
            "Definimos la primera tanda de la app de tareas: un front en React + Vite "
            "sobre un back pequeño en FastAPI + SQLite. Acordamos arrancar por la lista "
            "y el marcado como completado, persistir desde el día uno, y dejar las "
            "fechas de vencimiento para más adelante."
        ),
        "transcript": (
            "Tú: Bueno, arranquemos la app de tareas. ¿Qué es lo mínimo que vale la pena construir primero?\n"
            "Jose: La lista, sin duda. La gente necesita anotar tareas y marcarlas como hechas. → Construir la vista de lista de tareas con alta y marcado\n"
            "Tú: Y deberíamos persistir desde el día uno — perder tareas al refrescar se siente roto. → Montar el backend en FastAPI + SQLite con una tabla de tareas\n"
            "Jose: De acuerdo. Conectá el front directo a eso. → Agregar el endpoint de crear tarea y enganchar el formulario\n"
            "Tú: Editar y borrar salen todo el tiempo, no las saltemos. → Permitir editar y borrar una tarea\n"
            "Jose: Un filtro para ver solo las abiertas mantendría la lista usable. → Agregar un filtro para mostrar solo tareas abiertas\n"
            "Tú: Las fechas de vencimiento estarían buenas más adelante, pero no en esta tanda. → Explorar fechas de vencimiento opcionales como seguimiento\n"
            "Jose: Una última cosa — dejemos un estado vacío limpio para que el primer uso no sea una caja en blanco. →! Diseñar el estado vacío para una lista nueva\n"
        ),
    },
    "weekly-sync": {
        "title": "Weekly sync — polish & bugs",
        "date": "2026-06-29",
        "source": "Otter.ai",
        "attendees": ["You", "Maya", "Devin", "Priya"],
        "summary": (
            "Reviewed the first build with the team. The check-off loop works; the "
            "rough edges are around persistence races, mobile layout and keyboard "
            "flow. Priya flagged accessibility before we widen the beta."
        ),
        "transcript": (
            "Priya: The list looks great on desktop but it's cramped on my phone. → Fix the mobile layout for the todo list\n"
            "Devin: I saw a todo come back after I deleted it — looks like a save race. →! Fix the delete/save race on the todos endpoint\n"
            "Maya: Power users will want to add without reaching for the mouse. → Add a keyboard shortcut to add a todo\n"
            "Priya: And we should screen-reader test before the beta widens. →! Run an accessibility pass on the todo list\n"
            "You: Good. Let's also remember state when you reload mid-edit. → Persist in-progress edits across reload\n"
        ),
    },
}


def get(key: str) -> dict | None:
    return SAMPLES.get(key)


def listing() -> list[dict]:
    """Lightweight catalog for a picker — id/title/source/date, no transcript."""
    return [
        {"id": k, "title": s["title"], "source": s["source"],
         "date": s["date"], "attendees": s["attendees"]}
        for k, s in SAMPLES.items()
    ]
