import { Form } from "react-router";
import styles from "./login-card.module.css";

interface Props {
  /** Validation message for the shop field, if any. */
  error?: string;
  defaultShop?: string;
}

/**
 * The page a merchant sees before the app is installed or when no session
 * exists: what PrintFlex does, and the shop domain field that starts OAuth.
 * Shared by the landing route and the login route so both look the same.
 */
export function LoginCard({ error, defaultShop = "" }: Props) {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <i /><i /><i />
          </span>
          <span className={styles.name}>PrintFlex</span>
        </div>
        <h1 className={styles.heading}>Print, scan and pack every order from one place.</h1>
        <p className={styles.lead}>
          Bulk invoices, packing slips and pick lists as one PDF, with a QR code and barcode on every page so your warehouse can scan, check and pack.
        </p>
        <ul className={styles.points}>
          <li>One combined PDF for a whole batch of orders</li>
          <li>Scan the printed sheet to open, check off and mark packed</li>
          <li>Only orders you actually print count towards your plan</li>
        </ul>
        <Form className={styles.form} method="post" action="/auth/login">
          <label className={styles.label} htmlFor="shop">Your Shopify store</label>
          <div className={styles.row}>
            <div className={`${styles.field}${error ? ` ${styles.fieldError}` : ""}`}>
              <input id="shop" className={styles.input} type="text" name="shop" defaultValue={defaultShop} placeholder="my-store" autoComplete="on" autoCapitalize="off" spellCheck={false} />
              <span className={styles.suffix}>.myshopify.com</span>
            </div>
            <button className={styles.button} type="submit">Continue with Shopify</button>
          </div>
          {error ? <p className={styles.error} role="alert">{error}</p> : <p className={styles.hint}>Enter your store name or full domain. You will be asked to approve the app on Shopify.</p>}
        </Form>
        <p className={styles.foot}>Made by MPC Trades · Billed only through Shopify</p>
      </div>
    </div>
  );
}
