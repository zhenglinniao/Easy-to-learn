import katex from 'katex';

import styles from './TutorBoard.module.css';

export default function MathBlock({ latex, display }: { latex: string; display: boolean }) {
  const html = katex.renderToString(latex, {
    displayMode: display,
    throwOnError: false,
    strict: 'error',
    trust: false,
    output: 'htmlAndMathml',
    maxExpand: 100,
    maxSize: 10,
  });
  return <div className={styles.math} dangerouslySetInnerHTML={{ __html: html }} />;
}
