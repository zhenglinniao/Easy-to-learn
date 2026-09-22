import styles from './pages.module.css';

export function LearningCompanion() {
  return (
    <div className={styles.companion}>
      <span className={styles.companionMessage}>小易正在陪你拆解</span>
      <svg
        className={styles.companionCharacter}
        viewBox="0 0 120 120"
        role="img"
        aria-label="吉祥物小易，正在指向解题步骤"
      >
        <path className={styles.companionAntenna} d="M60 25V14m0 0 7-6m-7 6-7-6" />
        <rect className={styles.companionBody} x="19" y="24" width="82" height="76" rx="28" />
        <path className={styles.companionPage} d="M35 41h50v42H35z" />
        <g className={styles.companionEyes}>
          <circle cx="50" cy="58" r="3.5" />
          <circle cx="70" cy="58" r="3.5" />
        </g>
        <path className={styles.companionSmile} d="M51 70c5 5 13 5 18 0" />
        <g className={styles.companionArm}>
          <path d="M92 66c10-2 13-8 15-14" />
          <path className={styles.companionPencil} d="m105 53 6-12 3 2-6 12z" />
        </g>
        <path className={styles.companionFoot} d="M42 99v7m36-7v7" />
      </svg>
    </div>
  );
}
