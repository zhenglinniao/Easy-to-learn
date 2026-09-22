import styles from './pages.module.css';

export function ApplicationScenes() {
  return (
    <section className={`${styles.section} ${styles.sceneSection}`} aria-labelledby="scenes-title">
      <div className={styles.sceneHeading}>
        <div>
          <p className={styles.eyebrow}>应用场景</p>
          <h2 id="scenes-title">从一道题，到真正想明白。</h2>
        </div>
        <p>
          不论题目来自课本、草稿纸还是课堂笔记，Easy to learn
          都让问题、提示和思考过程留在同一个画布里。
        </p>
      </div>

      <div className={styles.sceneList}>
        <article className={styles.sceneRow}>
          <div className={styles.sceneCopy}>
            <span>01 · 作业卡住时</span>
            <h3>粘贴题图，先要一条提示。</h3>
            <p>
              把课本或练习册截图放进画布，只圈住正在卡住的部分。选择
              Hint，先获得方向，再决定是否展开完整步骤。
            </p>
            <small>适合数学计算、应用题、理化题图</small>
          </div>
          <figure
            className={`${styles.sceneVisual} ${styles.photoScene}`}
            aria-label="题图提示流程示意"
          >
            <div className={styles.miniWindowBar}>
              <i />
              <i />
              <i />
              <span>练习册截图</span>
            </div>
            <div className={styles.photoPaper}>
              <span>已知水池每分钟注水 12 L</span>
              <strong>多久可以注满 360 L？</strong>
              <i />
              <i />
            </div>
            <div className={styles.sceneSelection} aria-hidden="true" />
            <div className={styles.sceneAction}>✦ 提示 Hint</div>
            <div className={styles.sceneHint}>
              <span>先找关系</span>
              <strong>总量 ÷ 每分钟注水量</strong>
            </div>
          </figure>
        </article>

        <article className={styles.sceneRow}>
          <div className={styles.sceneCopy}>
            <span>02 · 课堂与自学</span>
            <h3>把图画出来，让推理贴着图走。</h3>
            <p>
              几何图、受力图和函数草图都可以直接绘制。辅导板锚定在原图旁，移动或缩放画布时，推理不会和题目走散。
            </p>
            <small>适合几何、物理、函数与流程分析</small>
          </div>
          <figure
            className={`${styles.sceneVisual} ${styles.geometryScene}`}
            aria-label="几何图分步推理示意"
          >
            <div className={styles.canvasTools} aria-hidden="true">
              <i>↖</i>
              <i>△</i>
              <i>↗</i>
              <i>A</i>
            </div>
            <svg className={styles.geometryDrawing} viewBox="0 0 300 220" aria-hidden="true">
              <path d="M54 176 144 40l102 136Z" />
              <path d="m54 176 142-66" />
              <text x="42" y="196">
                A
              </text>
              <text x="139" y="30">
                B
              </text>
              <text x="252" y="196">
                C
              </text>
              <circle className={styles.geometryPointOne} cx="54" cy="176" r="8" />
              <circle className={styles.geometryPointTwo} cx="196" cy="110" r="8" />
            </svg>
            <div className={styles.geometryTutor}>
              <span>步骤 2 / 3</span>
              <strong>先比较两个三角形</strong>
              <p>它们共享一条边，并且有一组已知角。</p>
            </div>
          </figure>
        </article>

        <article className={styles.sceneRow}>
          <div className={styles.sceneCopy}>
            <span>03 · 复习与持续学习</span>
            <h3>今天没做完，明天从原处继续。</h3>
            <p>
              登录后，画板、题图和辅导步骤一起保存。换一台设备打开，仍能看到上次的布局和学习进度。
            </p>
            <small>适合错题整理、长期课题和跨设备复习</small>
          </div>
          <figure
            className={`${styles.sceneVisual} ${styles.resumeScene}`}
            aria-label="跨设备恢复画板示意"
          >
            <div className={styles.desktopFrame}>
              <div className={styles.miniWindowBar}>
                <i />
                <i />
                <i />
                <span>我的画板</span>
              </div>
              <div className={styles.boardPreview}>
                <span>一次函数复习</span>
                <strong>y = 2x + 1</strong>
                <div>
                  <i />
                  <i />
                </div>
              </div>
              <div className={styles.savedStatus}>✓ 已自动保存</div>
            </div>
            <div className={styles.syncTrack} aria-hidden="true">
              <i />
            </div>
            <div className={styles.phoneFrame} aria-hidden="true">
              <span>继续学习</span>
              <strong>一次函数复习</strong>
              <i />
              <i />
              <i />
            </div>
          </figure>
        </article>
      </div>
    </section>
  );
}
