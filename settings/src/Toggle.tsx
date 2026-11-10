// an on/off switch: a button with role="switch", so a <label for> beside it
// works as you'd expect, and space and enter flip it
export function Toggle(props: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      id={props.id}
      type="button"
      role="switch"
      class="settings-switch"
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
    >
      <span class="settings-switch-thumb" />
    </button>
  );
}
