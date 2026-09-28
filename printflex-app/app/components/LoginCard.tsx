import styles from "./login-card.module.css";

/**
 * The page shown at the app URL outside the Shopify admin: what PrintFlex
 * does and where to get it. There is deliberately no shop domain field;
 * installs start from the App Store and sessions from the Shopify admin.
 * Shared by the landing route and the login route so both look the same.
 */
export function LoginCard() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <img className={styles.mark} src="/logo.svg" alt="" width="34" height="34" />
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
        <p className={styles.install}>
          Install PrintFlex from the Shopify App Store. Already installed? Open it from <strong>Apps</strong> in your Shopify admin.
        </p>
        <p className={styles.foot}>Made by MPC Trades · Billed only through Shopify</p>
        <nav className={styles.links} aria-label="Legal and support">
          <a href="https://printflex.mpctrades.com/privacy">Privacy policy</a>
          <a href="https://printflex.mpctrades.com/terms">Terms</a>
          <a href="https://printflex.mpctrades.com/support">Support</a>
        </nav>
      </div>
    </div>
  );
}
