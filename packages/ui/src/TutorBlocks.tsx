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

const labelAt = (label: string | undefined, x: number, y: number, key: string) =>
  label ? (
    <text key={key} x={x + 7} y={y - 7} className={styles.diagramLabel}>
      {label}
    </text>
  ) : null;

const ticks = (start: number, end: number): number[] => {
  const span = end - start;
  const roughStep = span / 8;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const first = Math.ceil(start / step) * step;
  const values: number[] = [];
  for (let value = first; value <= end && values.length < 12; value += step) {
    values.push(Number(value.toPrecision(10)));
  }
  return values;
};

function GeometryDiagram({ diagram }: { diagram: Extract<DiagramV1, { type: 'geometry' }> }) {
  return (
    <svg className={styles.diagram} viewBox="0 0 320 200" role="img" aria-label="几何图">
      {diagram.primitives.map((item, index) => {
        if (item.kind === 'point') {
          const at = point(item.at, diagram.viewport);
          return (
            <g key={`${item.id}-${index}`}>
              <circle cx={at.x} cy={at.y} r="4" fill={colors[item.color]} />
              {labelAt(item.label, at.x, at.y, `${item.id}-label`)}
            </g>
          );
        }
        if (item.kind === 'circle') {
          const center = point(item.center, diagram.viewport);
          const edge = point([item.center[0] + item.radius, item.center[1]], diagram.viewport);
          return (
            <g key={index}>
              <circle
                className={styles.sketchStroke}
                cx={center.x}
                cy={center.y}
                r={Math.abs(edge.x - center.x)}
                fill="none"
                stroke={colors[item.color]}
                strokeWidth="2"
              />
              {labelAt(item.label, edge.x, center.y, `circle-${index}-label`)}
            </g>
          );
        }
        if (item.kind === 'angle') {
          const vertex = point(item.vertex, diagram.viewport);
          const from = point(item.from, diagram.viewport);
          const to = point(item.to, diagram.viewport);
          return (
            <g key={index}>
              <path
                className={styles.sketchStroke}
                d={`M ${from.x} ${from.y} L ${vertex.x} ${vertex.y} L ${to.x} ${to.y}`}
                fill="none"
                stroke={colors[item.color]}
                strokeWidth="2"
              />
              {labelAt(item.label, vertex.x, vertex.y, `angle-${index}-label`)}
            </g>
          );
        }
        const values = item.kind === 'polygon' ? item.points : [item.from, item.to];
        const mapped = values.map((value) => point(value, diagram.viewport));
        if (item.kind === 'polygon') {
          const center = mapped.reduce(
            (sum, current) => ({
              x: sum.x + current.x / mapped.length,
              y: sum.y + current.y / mapped.length,
            }),
            { x: 0, y: 0 },
          );
          return (
            <g key={index}>
              <polygon
                className={styles.sketchStroke}
                points={mapped.map(({ x, y }) => `${x},${y}`).join(' ')}
                fill={item.filled ? `${colors[item.color]}22` : 'none'}
                stroke={colors[item.color]}
                strokeWidth="2"
              />
              {labelAt(item.label, center.x, center.y, `polygon-${index}-label`)}
            </g>
          );
        }
        return (
          <g key={index}>
            <line
              className={styles.sketchStroke}
              x1={mapped[0]?.x}
              y1={mapped[0]?.y}
              x2={mapped[1]?.x}
              y2={mapped[1]?.y}
              stroke={colors[item.color]}
              strokeWidth="2"
            />
            {labelAt(
              item.label,
              ((mapped[0]?.x ?? 0) + (mapped[1]?.x ?? 0)) / 2,
              ((mapped[0]?.y ?? 0) + (mapped[1]?.y ?? 0)) / 2,
              `segment-${index}-label`,
            )}
          </g>
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
  const xTicks = ticks(viewport.xMin, viewport.xMax);
  const yTicks = ticks(viewport.yMin, viewport.yMax);
  return (
    <svg className={styles.diagram} viewBox="0 0 320 200" role="img" aria-label="坐标图">
      {diagram.showGrid && (
        <g className={styles.diagramGrid} aria-hidden="true">
          {xTicks.map((value) => {
            const at = point([value, 0], viewport);
            return <line key={`gx-${value}`} x1={at.x} y1="20" x2={at.x} y2="180" />;
          })}
          {yTicks.map((value) => {
            const at = point([0, value], viewport);
            return <line key={`gy-${value}`} x1="20" y1={at.y} x2="300" y2={at.y} />;
          })}
        </g>
      )}
      {diagram.showAxes && (
        <>
          {viewport.yMin <= 0 && viewport.yMax >= 0 ? (
            <line x1="20" y1={origin.y} x2="300" y2={origin.y} className={styles.diagramAxis} />
          ) : null}
          {viewport.xMin <= 0 && viewport.xMax >= 0 ? (
            <line x1={origin.x} y1="20" x2={origin.x} y2="180" className={styles.diagramAxis} />
          ) : null}
          {xTicks.map((value) => {
            const at = point([value, 0], viewport);
            return (
              <text key={`xt-${value}`} x={at.x} y="196" textAnchor="middle">
                {value}
              </text>
            );
          })}
          {yTicks.map((value) => {
            const at = point([0, value], viewport);
            return (
              <text key={`yt-${value}`} x="16" y={at.y + 4} textAnchor="end">
                {value}
              </text>
            );
          })}
        </>
      )}
      {diagram.segments.map((segment, index) => {
        const from = point(segment.from, viewport);
        const to = point(segment.to, viewport);
        return (
          <g key={index}>
            <line
              className={styles.sketchStroke}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={colors[segment.color]}
              strokeWidth="2"
            />
            {labelAt(
              segment.label,
              (from.x + to.x) / 2,
              (from.y + to.y) / 2,
              `coordinate-segment-${index}-label`,
            )}
          </g>
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
  const labels = new Map(diagram.nodes.map((node) => [node.id, node.label]));
  return (
    <div className={styles.flow} data-direction={diagram.direction} role="img" aria-label="流程图">
      <div className={styles.flowNodes}>
        {diagram.nodes.map((node) => (
          <div
            key={node.id}
            className={styles.flowNode}
            data-shape={node.shape}
            style={{ borderColor: colors[node.color] }}
          >
            {node.label}
          </div>
        ))}
      </div>
      {diagram.edges.length ? (
        <div className={styles.flowEdges} aria-label="流程关系">
          {diagram.edges.map((edge) => (
            <div key={edge.id} className={styles.flowEdge} data-style={edge.style}>
              <span>{labels.get(edge.from)}</span>
              <b aria-hidden="true">→</b>
              {edge.label ? <em>{edge.label}</em> : null}
              <span>{labels.get(edge.to)}</span>
            </div>
          ))}
        </div>
      ) : null}
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
