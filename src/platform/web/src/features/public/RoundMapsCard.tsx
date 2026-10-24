import { useEffect, useMemo, useState } from 'react';
import { Card } from '../../ui/index.ts';
import type { PublicSnapshot } from './snapshot.ts';

export interface PublicMapItem {
  readonly mapId: string;
  readonly version?: number;
  readonly checksum?: string;
  readonly definition?: any;
  readonly error?: string;
}

function BoardPreview({ definition, mapId }: { definition?: any; mapId: string }) {
  if (!definition || !definition.width || !definition.height) return null;
  const width: number = definition.width;
  const height: number = definition.height;
  const spawns: Array<{ owner: string; type: string; position: { col: number; row: number } }> = definition.spawns ?? [];
  const obstacles: Array<{ col: number; row: number }> = definition.obstacles ?? [];
  const goals: { X?: { col: number; row: number }; O?: { col: number; row: number } } = definition.goals ?? {};

  const rows = [];
  for (let r = 0; r < height; r++) {
    const cells = [];
    for (let c = 0; c < width; c++) {
      const spawn = spawns.find((s) => s.position.row === r && s.position.col === c);
      const isObstacle = obstacles.some((o) => o.row === r && o.col === c);
      const isGoalX = goals.X?.row === r && goals.X?.col === c;
      const isGoalO = goals.O?.row === r && goals.O?.col === c;

      let cellText = '·';
      let cellClass = 'pub-board-cell';
      if (spawn) {
        cellText = `${spawn.owner}${spawn.type[0]}`;
        cellClass += ` pub-board-cell--spawn pub-board-cell--${spawn.owner.toLowerCase()}`;
      } else if (isObstacle) {
        cellText = '#';
        cellClass += ' pub-board-cell--obstacle';
      } else if (isGoalX) {
        cellText = 'GX';
        cellClass += ' pub-board-cell--goal pub-board-cell--x';
      } else if (isGoalO) {
        cellText = 'GO';
        cellClass += ' pub-board-cell--goal pub-board-cell--o';
      }
      cells.push(
        <td key={c} className={cellClass} title={`(${r}, ${c}): ${cellText}`}>
          {cellText}
        </td>,
      );
    }
    rows.push(<tr key={r}>{cells}</tr>);
  }

  return (
    <div className="pub-board-preview" role="region" aria-label={`Bàn cờ ${mapId}`}>
      <table className="pub-board-grid" aria-label={`Lưới bản đồ ${mapId} ${width}x${height}`}>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

export function RoundMapsCard({ rules }: { rules?: PublicSnapshot['rules'] }) {
  const fallbackMaps = useMemo(() => {
    if (!rules?.sections) return [];
    const lockedSection = rules.sections.find((s) => s.title === 'Bàn cờ đã khóa');
    if (lockedSection) {
      try {
        const parsed = JSON.parse(lockedSection.body);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item) => ({
            mapId: item.mapId ?? 'default',
            version: item.version ?? 1,
            checksum: item.checksum ?? '',
            definition: item.error ? undefined : (item.definition ?? (item.width ? item : undefined)),
            error: item.error,
          }));
        }
      } catch {}
    }
    return [];
  }, [rules]);

  const [maps, setMaps] = useState<readonly PublicMapItem[]>(fallbackMaps);

  useEffect(() => {
    let cancelled = false;
    async function loadMaps() {
      try {
        const res = await fetch('/api/v1/public/rounds/current/maps', { credentials: 'omit' });
        if (res.ok) {
          const json = (await res.json()) as { maps?: PublicMapItem[] };
          if (!cancelled && Array.isArray(json.maps)) {
            setMaps(json.maps);
            return;
          }
        }
      } catch {
        // Fallback to snapshot rules
      }
      if (!cancelled) {
        setMaps(fallbackMaps);
      }
    }
    void loadMaps();
    return () => {
      cancelled = true;
    };
  }, [fallbackMaps]);

  return (
    <section aria-label="Bản đồ của vòng">
      <Card as="div" title="Bản đồ của vòng" className="pub-maps-card">
        {maps.length === 0 ? (
          <p className="pub-muted">Chưa công bố bản đồ.</p>
        ) : (
          <div className="pub-maps-list">
            {maps.map((map) => {
              const def = map.definition;
              const hasDef = Boolean(def && def.width && def.height);
              const downloadUrl = `/api/v1/public/maps/${encodeURIComponent(map.mapId)}?checksum=${encodeURIComponent(map.checksum ?? '')}`;
              return (
                <article key={`${map.mapId}-${map.checksum ?? ''}`} className="pub-map-entry">
                  <div className="pub-map-header">
                    <div>
                      <h3 className="pub-map-title">{def?.name ?? map.mapId}</h3>
                      <p className="pub-muted pub-map-meta">Phiên bản {map.version ?? def?.version ?? 1}</p>
                    </div>
                  </div>

                  {hasDef ? (
                    <>
                      <BoardPreview definition={def} mapId={map.mapId} />
                      <div className="pub-map-actions">
                        <a
                          className="ui-button ui-button--secondary"
                          href={downloadUrl}
                          download={`${map.mapId}.json`}
                        >
                          Tải bản đồ (.json)
                        </a>
                      </div>
                    </>
                  ) : (
                    <p className="pub-muted pub-map-error">không có định nghĩa trong danh mục</p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Card>
    </section>
  );
}
