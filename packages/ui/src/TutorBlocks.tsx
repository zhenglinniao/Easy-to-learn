import type { DiagramColor, DiagramV1, TutorBlock } from '@easy-to-learn/domain';
import katex from 'katex';

import styles from './TutorBoard.module.css';

const colors: Record<DiagramColor, string> = {
  neutral: '#6f675e',
  blue: '#3478c8',
  green: '#27835b',
  amber: '#b66b16',
  red: '#c94f4f',
  purple: '#7654b8',
};

const point = (
  value: readonly [number, number],
  viewport: { xMin: number; xMax: number; yMin: number; yMax: number },
) => ({
  x: ((value[0] - viewport.xMin) / (viewport.xMax - viewport.xMin)) * 280 + 20,
  y: 180 - ((value[1] - viewport.yMin) / (viewport.yMax - viewport.yMin)) * 160,
});

function GeometryDiagram({ diagram }: { diagram: Extract<DiagramV1, { type: 'geometry' }> }) {
  return (
    <svg className={styles.diagram} viewBox="0 0 320 200" role="img" aria-label="几何图">
      {diagram.primitives.map((item, index) => {
        if (item.kind === 'point') {
          const at = point(item.at, diagram.viewport);
          return (
            <circle
              key={`${item.id}-${index}`}
              cx={at.x}
              cy={at.y}
              r="4"
              fill={colors[item.color]}
            />
          );
        }
        if (item.kind === 'circle') {
          const center = point(item.center, diagram.viewport);
          const edge = point([item.center[0] + item.radius, item.center[1]], diagram.viewport);
          return (
            <circle
              key={index}
              cx={center.x}
              cy={center.y}
              r={Math.abs(edge.x - center.x)}
              fill="none"
              stroke={colors[item.color]}
              strokeWidth="2"
            />
          );
        }
        const values = item.kind === 'polygon' ? item.points : [item.from, item.to];
        const mapped = values.map((value) => point(value, diagram.viewport));
        if (item.kind === 'polygon') {
          return (
            <polygon
              key={index}
              points={mapped.map(({ x, y }) => `${x},${y}`).join(' ')}
              fill={item.filled ? `${colors[item.color]}22` : 'none'}
              stroke={colors[item.color]}
              strokeWidth="2"
            />
          );
        }
        return (
          <line
            key={index}
            x1={mapped[0]?.x}
            y1={mapped[0]?.y}
            x2={mapped[1]?.x}
            y2={mapped[1]?.y}
            stroke={colors[item.color]}
            strokeWidth="2"
          />
        );
      })}
    </svg>
  );
}

function CoordinateDiagram({
  diagram,
}: {
  diagram: Extract<DiagramV1, { type: 'coordinate-plane' }>;
}) {
  const viewport = {
    xMin: diagram.xRange[0],
    xMax: diagram.xRange[1],
    yMin: diagram.yRange[0],
    yMax: diagram.yRange[1],
  };
  const origin = point([0, 0], viewport);
  return (
    <svg className={styles.diagram} viewBox="0 0 320 200" role="img" aria-label="坐标图">
      {diagram.showAxes && (
        <>
          <line x1="20" y1={origin.y} x2="300" y2={origin.y} stroke="#aaa198" />
          <line x1={origin.x} y1="20" x2={origin.x} y2="180" stroke="#aaa198" />
        </>
      )}
      {diagram.segments.map((segment, index) => {
        const from = point(segment.from, viewport);
        const to = point(segment.to, viewport);
        return (
          <line
            key={index}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={colors[segment.color]}
            strokeWidth="2"
          />
        );
      })}
      {diagram.points.map((item) => {
        const at = point([item.x, item.y], viewport);
        return (
          <g key={item.id}>
            <circle cx={at.x} cy={at.y} r="4" fill={colors[item.color]} />
            {item.label && (
              <text x={at.x + 7} y={at.y - 7}>
                {item.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function FlowDiagram({ diagram }: { diagram: Extract<DiagramV1, { type: 'flow' }> }) {
  return (
    <div className={styles.flow} role="img" aria-label="流程图">
      {diagram.nodes.map((node, index) => (
        <div key={node.id} className={styles.flowNode} style={{ borderColor: colors[node.color] }}>
          <span>{node.label}</span>
          {index < diagram.nodes.length - 1 && (
            <b aria-hidden="true">{diagram.direction === 'TB' ? '↓' : '→'}</b>
          )}
        </div>
      ))}
    </div>
  );
}

function SafeDiagram({ diagram }: { diagram: DiagramV1 }) {
  if (diagram.type === 'coordinate-plane') return <CoordinateDiagram diagram={diagram} />;
  if (diagram.type === 'geometry') return <GeometryDiagram diagram={diagram} />;
  return <FlowDiagram diagram={diagram} />;
}

export function TutorBlocks({ blocks }: { blocks: readonly TutorBlock[] }) {
  return (
    <div className={styles.blocks}>
      {blocks.map((block, index) => {
        if (block.type === 'paragraph') return <p key={index}>{block.text}</p>;
        if (block.type === 'math') {
          const html = katex.renderToString(block.latex, {
            displayMode: block.display,
            throwOnError: false,
            strict: 'error',
            trust: false,
            output: 'htmlAndMathml',
            maxExpand: 100,
            maxSize: 10,
          });
          return (
            <div key={index} className={styles.math} dangerouslySetInnerHTML={{ __html: html }} />
          );
        }
        if (block.type === 'list') {
          const Tag = block.style === 'ordered' ? 'ol' : 'ul';
          return (
            <Tag key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </Tag>
          );
        }
        if (block.type === 'callout')
          return (
            <aside key={index} className={styles.callout} data-tone={block.tone}>
              {block.text}
            </aside>
          );
        return <SafeDiagram key={index} diagram={block.diagram} />;
      })}
    </div>
  );
}
