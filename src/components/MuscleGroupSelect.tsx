import { useId } from "react";
import { groupByRegion } from "@/lib/muscle-group-utils";
import type { MuscleGroup } from "@/lib/types";

type Props = {
  groups: MuscleGroup[];
  name?: string;
  label?: string;
  /** Texto de la opción vacía («Todos los grupos», «Selecciona un grupo»…). */
  emptyLabel?: string;
  /** Obligatorio: marca el campo como requerido para lectores de pantalla. */
  required?: boolean;
  /** Mensaje junto al campo (p. ej. «Selecciona un grupo muscular»). */
  error?: string;
  /** Opciones extra al final (p. ej. el filtro «Sin clasificar»). */
  extraOptions?: { value: string; label: string }[];
} & (
  | { value: string; onChange: (value: string) => void; defaultValue?: never }
  | { defaultValue?: string | null; value?: never; onChange?: never }
);

/** Lista desplegable del catálogo de grupos musculares, agrupada por región. */
export function MuscleGroupSelect({
  groups,
  name = "muscle_group_id",
  label = "Grupo muscular",
  emptyLabel = "Selecciona un grupo",
  required,
  error,
  extraOptions,
  ...rest
}: Props) {
  const errorId = useId();
  const controlled = "value" in rest && rest.value !== undefined;
  return (
    <div className="field">
      <label className="field">
        <span>{label}</span>
        <select
          className="input"
          name={name}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...(controlled
            ? { value: rest.value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => rest.onChange?.(e.target.value) }
            : { defaultValue: rest.defaultValue ?? "" })}
        >
          <option value="">{emptyLabel}</option>
          {groupByRegion(groups).map(({ region, groups: items }) => (
            <optgroup key={region} label={region}>
              {items.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </optgroup>
          ))}
          {extraOptions?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      {error ? (
        <span id={errorId} className="field-error" role="alert">{error}</span>
      ) : null}
    </div>
  );
}
