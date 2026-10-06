import { FieldError } from '@/components/ui/form-message';
import { Label } from '@/components/ui/label';

const TEXTAREA_CLASSNAME =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export function ReasonField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        rows={3}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-error`}
        className={TEXTAREA_CLASSNAME}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
