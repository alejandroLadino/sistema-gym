import { useId } from "react";
import { EQUIPMENT, EQUIPMENT_UNSET_LABEL } from "@/lib/equipment";

type Props = {
  name?: string;
  error?: string;
} & (
  | { value: string; onChange: (value: string) => void; defaultValue?: never }
  | { defaultValue?: string | null; value?: never; onChange?: never }
);

/** Selector «Equipo» (opcional): Mancuernas, Barra, Máquina Smith… */
export function EquipmentSelect({ name = "equipment", error, ...rest }: Props) {
  const errorId = useId();
  const controlled = "value" in rest && rest.value !== undefined;
  return (
    <div className="field">
      <label className="field">
        <span>Equipo</span>
        <select
          className="input"
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...(controlled
            ? { value: rest.value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => rest.onChange?.(e.target.value) }
            : { defaultValue: rest.defaultValue ?? "" })}
        >
          <option value="">{EQUIPMENT_UNSET_LABEL}</option>
          {EQUIPMENT.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
      </label>
      {error ? <span id={errorId} className="field-error" role="alert">{error}</span> : null}
    </div>
  );
}
