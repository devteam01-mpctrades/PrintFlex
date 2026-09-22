import { Form } from "react-router";

interface Props {
  shopLabel: string;
  error?: string | null;
  /** Where to go after signing in (the same page by default). */
  action?: string;
}

export function SignInForm({ shopLabel, error, action }: Props) {
  return (
    <section className="card">
      <h1>Sign in to pack</h1>
      <p className="muted">Store: {shopLabel}. Enter the store PIN and give this device a name. It stays signed in until the PIN changes or the device is removed.</p>
      {error ? <p className="notice bad">{error}</p> : null}
      <Form method="post" action={action}>
        <input type="hidden" name="intent" value="signin" />
        <label htmlFor="pin">Store PIN</label>
        <input id="pin" className="pin" name="pin" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" required minLength={4} maxLength={8} />
        <label htmlFor="deviceName">Device name</label>
        <input id="deviceName" name="deviceName" type="text" placeholder="Bench 2 · Dara" autoComplete="off" required maxLength={40} />
        <button className="btn" type="submit">Sign in</button>
      </Form>
    </section>
  );
}
