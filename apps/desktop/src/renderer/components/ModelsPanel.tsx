import { useEffect, useRef, useState } from "react";
import type { ModelClassDto, ModelClassesDto } from "../../shared/ipc-contract";
import { api } from "../api";

/** Libellés des classes de rôle (ADR 0048), dans l'ordre du plus exigeant au plus léger. */
const CLASSES: { id: ModelClassDto; label: string; hint: string }[] = [
  { id: "strong", label: "Conception", hint: "Architectes : modélisation et décisions." },
  { id: "standard", label: "Production", hint: "Recherche, scénarios, tests, code, la plupart des revues." },
  { id: "light", label: "Tâches légères", hint: "Évaluer la difficulté, confronter les livrables aux faits mesurés." },
];

/**
 * Modèles des agents (ADR 0048) : chaque classe de rôle se règle sur un modèle de l'abonnement, ou
 * reste au modèle du projet. Les extensions ne déclarent qu'une classe ; le choix est ici.
 */
export function ModelsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<ModelClassesDto>({ models: [], classes: {} });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setError(null);
      void api.call("model-classes:list", {}).then(setData, (err: Error) => setError(err.message));
    }
    if (!open && d.open) d.close();
  }, [open]);

  function choose(modelClass: ModelClassDto, value: string) {
    const id = value === "" ? null : value;
    setData((d) => {
      const classes = { ...d.classes };
      if (id === null) delete classes[modelClass];
      else classes[modelClass] = id;
      return { ...d, classes };
    });
    api.call("model-class:set", { modelClass, id }).catch((err: Error) => setError(err.message));
  }

  return (
    <dialog ref={ref} className="extensions" onCancel={(e) => (e.preventDefault(), onClose())} aria-label="Modèles des agents">
      <h2>Modèles des agents</h2>
      <p className="hint">Pour ce projet. Une classe laissée par défaut utilise le modèle choisi en haut de l'écran.</p>
      {data.models.length === 0 && !error && <p className="hint">Aucun modèle disponible pour l'instant.</p>}
      {CLASSES.map((c) => (
        <label key={c.id} className="model-class">
          <span>
            {c.label} — <span className="hint">{c.hint}</span>
          </span>
          <select value={data.classes[c.id] ?? ""} onChange={(e) => choose(c.id, e.target.value)}>
            <option value="">Par défaut (modèle du projet)</option>
            {data.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.multiplier === undefined ? m.name : `${m.name} (×${m.multiplier})`}
              </option>
            ))}
          </select>
        </label>
      ))}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button onClick={onClose}>Fermer</button>
      </div>
    </dialog>
  );
}
