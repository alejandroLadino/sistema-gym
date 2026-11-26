import { groupByRegion } from "@/lib/muscle-group-utils";
import type { MuscleGroup } from "@/lib/types";

type Props = {
  groups: MuscleGroup[];
  name?: string;
  label?: string;
  emptyLabel?: string;
} & (
  | { value: string; onChange: (value: string) => void; defaultValue?: never }
  | { defaultValue?: string | null; value?: never; onChange?: never }
);

/** Lista desplegable del catálogo de grupos musculares, agrupada por región. */
export function MuscleGroupSelect({
  groups,
  name = "muscle_group_id",
  label = "Grupo muscular",
  emptyLabel = "Sin grupo muscular",
  ...rest
}: Props) {
  const controlled = "value" in rest && rest.value !== undefined;
  return (
    <label className="field">
      <span>{label}</span>
      <select
        className="input"
        name={name}
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
      </select>
    </label>
  );
}
